import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, ProductQaAuthorRole, ProductQaMessageStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ObjectStorageService } from '../storage/object-storage.service';
import { ProductQaCaptchaService } from './product-qa-captcha.service';
import { ProductQaNotifyService } from './product-qa-notify.service';
import { productQaAuthorRoleFromJwt } from './product-qa-auth.util';
import { ProductQaBroadcastService } from './product-qa-broadcast.service';
import { ProductQaCoreService } from './product-qa-core.service';
import { ProductQaGateway } from './product-qa.gateway';
import { ProductQaSearchSyncService } from './product-qa-search-sync.service';
import type { PostProductQaMessageDto } from './dto/product-qa.dto';
import {
  PRODUCT_QA_ATTACHMENT_REFS_PAYLOAD_MAX_CHARS,
  PRODUCT_QA_ATTACHMENTS_MAX,
  PRODUCT_QA_BODY_MAX_CHARS,
  PRODUCT_QA_POST_COOLDOWN_MS,
} from './product-qa.constants';
import { mapQaMessage, qaMessageInclude, attachmentKindFromMime } from './product-qa.mapper';
import { isProductQaPreModerationEnabled } from './product-qa-premod.util';
import type { ProductQaAttachmentRef, ProductQaAttachmentRefInput, ProductQaMessageOut } from './product-qa.types';

@Injectable()
export class ProductQaPostService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly core: ProductQaCoreService,
    private readonly storage: ObjectStorageService,
    private readonly captcha: ProductQaCaptchaService,
    private readonly searchSync: ProductQaSearchSyncService,
    private readonly gateway: ProductQaGateway,
    private readonly broadcast: ProductQaBroadcastService,
    private readonly notify: ProductQaNotifyService,
    private readonly config: ConfigService,
  ) {}

  private validateAttachmentKeys(productId: string, urls: string[]): void {
    const prefix = `objects/product-qa/${productId}/`;
    for (const url of urls) {
      const key = this.storage.tryPublicUrlToKey(url);
      if (!key || !key.startsWith(prefix)) {
        throw new BadRequestException('Недопустимый URL вложения');
      }
    }
  }

  private parseAttachmentUrls(attachments: ProductQaAttachmentRefInput[] | undefined): string[] {
    if (!attachments?.length) return [];
    if (attachments.length > PRODUCT_QA_ATTACHMENTS_MAX) {
      throw new BadRequestException('Слишком много вложений');
    }
    let payloadLen = 0;
    const urls: string[] = [];
    for (const a of attachments) {
      const url = a.url?.trim() ?? '';
      if (!url) {
        throw new BadRequestException('Некорректное вложение');
      }
      payloadLen += url.length;
      if (payloadLen > PRODUCT_QA_ATTACHMENT_REFS_PAYLOAD_MAX_CHARS) {
        throw new BadRequestException('Слишком большой объём вложений');
      }
      urls.push(url);
    }
    return urls;
  }

  private async materializeAndConsumePendingUploads(
    tx: Prisma.TransactionClient,
    productId: string,
    userId: string,
    urls: string[],
  ): Promise<ProductQaAttachmentRef[]> {
    if (!urls.length) return [];

    const pending = await tx.productQaPendingUpload.findMany({
      where: { productId, userId, url: { in: urls } },
      select: { url: true, filename: true, mimeType: true },
    });
    const byUrl = new Map(pending.map((row) => [row.url, row]));

    const refs: ProductQaAttachmentRef[] = [];
    for (const url of urls) {
      const row = byUrl.get(url);
      if (!row) {
        throw new BadRequestException('Недопустимый URL вложения');
      }
      refs.push({
        url: row.url,
        filename: row.filename,
        mimeType: row.mimeType,
        kind: attachmentKindFromMime(row.mimeType),
      });
    }

    const deleted = await tx.productQaPendingUpload.deleteMany({
      where: { productId, userId, url: { in: urls } },
    });
    if (deleted.count !== urls.length) {
      throw new BadRequestException('Недопустимый URL вложения');
    }
    return refs;
  }

  private async assertPostCooldownInTx(
    tx: Prisma.TransactionClient,
    productId: string,
    userId: string,
  ): Promise<void> {
    const last = await tx.productQaMessage.findFirst({
      where: { authorUserId: userId, thread: { productId } },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    if (!last) return;
    const elapsed = Date.now() - last.createdAt.getTime();
    if (elapsed < PRODUCT_QA_POST_COOLDOWN_MS) {
      throw new BadRequestException('Подождите перед следующим сообщением');
    }
  }

  private async assertVariantBelongsToProduct(
    productId: string,
    productVariantId: string | undefined,
  ): Promise<void> {
    const variantId = productVariantId?.trim();
    if (!variantId) return;
    const variant = await this.prisma.productVariant.findFirst({
      where: { id: variantId, productId, isActive: true },
      select: { id: true },
    });
    if (!variant) {
      throw new BadRequestException('Недопустимый вариант товара');
    }
  }

  async postMessageBySlug(
    slug: string,
    jwtUserId: string,
    jwtRole: string,
    dto: PostProductQaMessageDto,
  ): Promise<ProductQaMessageOut> {
    const product = await this.core.resolveActiveProductBySlug(slug);
    return this.postMessageForProduct(product.id, jwtUserId, jwtRole, dto);
  }

  async postMessageForProduct(
    productId: string,
    jwtUserId: string,
    jwtRole: string,
    dto: PostProductQaMessageDto,
  ): Promise<ProductQaMessageOut> {
    const authorRole = productQaAuthorRoleFromJwt(jwtRole);
    if (authorRole === ProductQaAuthorRole.STAFF) {
      await this.core.assertStaffCatalogAccess(jwtUserId, jwtRole);
    } else {
      const user = await this.prisma.user.findUnique({
        where: { id: jwtUserId },
        select: { id: true, isActive: true },
      });
      if (!user?.isActive) throw new ForbiddenException('Аккаунт недоступен');
      await this.captcha.assertValidUserToken(dto.turnstileToken);
    }

    const body = dto.body?.trim() ?? '';
    const attachmentUrls = this.parseAttachmentUrls(dto.attachments);
    this.validateAttachmentKeys(productId, attachmentUrls);
    if (!body && attachmentUrls.length === 0) {
      throw new BadRequestException('Пустое сообщение');
    }
    if (body.length > PRODUCT_QA_BODY_MAX_CHARS) {
      throw new BadRequestException('Слишком длинное сообщение');
    }

    await this.assertVariantBelongsToProduct(productId, dto.productVariantId);

    const thread = await this.core.resolveThread(productId, dto.topicSlug);

    const variantId = dto.productVariantId?.trim() || null;
    const preMod =
      authorRole === ProductQaAuthorRole.USER && isProductQaPreModerationEnabled(this.config);
    const initialStatus = preMod
      ? ProductQaMessageStatus.PENDING
      : ProductQaMessageStatus.VISIBLE;

    const created = await this.prisma.$transaction(async (tx) => {
      await this.core.lockProductForUpdate(tx, productId);
      if (authorRole === ProductQaAuthorRole.USER) {
        await this.assertPostCooldownInTx(tx, productId, jwtUserId);
      }
      const attachmentRefs = await this.materializeAndConsumePendingUploads(
        tx,
        productId,
        jwtUserId,
        attachmentUrls,
      );
      const message = await tx.productQaMessage.create({
        data: {
          threadId: thread.id,
          authorUserId: jwtUserId,
          authorRole,
          body,
          productVariantId: variantId,
          status: initialStatus,
          attachments: attachmentRefs.length
            ? {
                create: attachmentRefs.map((a, i) => ({
                  url: a.url,
                  filename: a.filename,
                  mimeType: a.mimeType,
                  kind: a.kind,
                  sortOrder: i,
                })),
              }
            : undefined,
        },
        include: qaMessageInclude(),
      });
      await this.core.recalculatePublicCounts(tx, productId);
      await this.core.touchProductChatActivity(tx, productId, message.createdAt);
      return message;
    });

    this.searchSync.scheduleProductReindex(productId);
    const out = mapQaMessage(created);
    if (initialStatus === ProductQaMessageStatus.VISIBLE) {
      this.gateway.broadcastMessageCreated(productId, out);
      void this.broadcast.broadcastMeta(productId);
    } else if (initialStatus === ProductQaMessageStatus.PENDING) {
      this.gateway.broadcastMessageCreated(productId, out);
    }
    if (authorRole === ProductQaAuthorRole.USER) {
      this.notify.scheduleStaffNotifyForUserQuestion(productId, out);
    }
    return out;
  }
}
