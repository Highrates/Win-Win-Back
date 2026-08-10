import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ProductQaAuthorRole, ProductQaMessageStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ObjectStorageService } from '../storage/object-storage.service';
import { ProductQaCaptchaService } from '../product-qa/product-qa-captcha.service';
import { ProductQaCoreService } from '../product-qa/product-qa-core.service';
import { ProductQaNotifyService } from '../product-qa/product-qa-notify.service';
import { productQaAuthorRoleFromJwt } from '../product-qa/product-qa-auth.util';
import {
  PRODUCT_QA_ATTACHMENT_REFS_PAYLOAD_MAX_CHARS,
  PRODUCT_QA_ATTACHMENTS_MAX,
  PRODUCT_QA_BODY_MAX_CHARS,
  PRODUCT_QA_POST_COOLDOWN_MS,
} from '../product-qa/product-qa.constants';
import { attachmentKindFromMime, mapQaMessage, qaMessageInclude } from '../product-qa/product-qa.mapper';
import { isProductQaPreModerationEnabled } from '../product-qa/product-qa-premod.util';
import { ProductQaBroadcastService } from '../product-qa/product-qa-broadcast.service';
import { ProductQaGateway } from '../product-qa/product-qa.gateway';
import { ProductQaSearchSyncService } from '../product-qa/product-qa-search-sync.service';
import { ConfigService } from '@nestjs/config';
import type { PostProductQaMessageDto } from '../product-qa/dto/product-qa.dto';
import type { ProductQaAttachmentRef } from '../product-qa/product-qa.types';
import { ProductCorrespondenceCoreService } from './product-correspondence-core.service';
import {
  correspondenceMessageInclude,
  mapCorrespondenceMessage,
} from './product-correspondence.mapper';
import type { ProductCorrespondenceMessageOut } from './product-correspondence.types';
import type { PostProductCorrespondenceMessageDto } from './dto/product-correspondence.dto';

@Injectable()
export class ProductCorrespondencePostService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly core: ProductCorrespondenceCoreService,
    private readonly qaCore: ProductQaCoreService,
    private readonly storage: ObjectStorageService,
    private readonly captcha: ProductQaCaptchaService,
    private readonly notify: ProductQaNotifyService,
    private readonly gateway: ProductQaGateway,
    private readonly broadcast: ProductQaBroadcastService,
    private readonly searchSync: ProductQaSearchSyncService,
    private readonly config: ConfigService,
  ) {}

  private parseAttachmentUrls(attachments: PostProductQaMessageDto['attachments']): string[] {
    if (!attachments?.length) return [];
    if (attachments.length > PRODUCT_QA_ATTACHMENTS_MAX) {
      throw new BadRequestException('Слишком много вложений');
    }
    let payloadLen = 0;
    const urls: string[] = [];
    for (const a of attachments) {
      const url = a.url?.trim() ?? '';
      if (!url) throw new BadRequestException('Некорректное вложение');
      payloadLen += url.length;
      if (payloadLen > PRODUCT_QA_ATTACHMENT_REFS_PAYLOAD_MAX_CHARS) {
        throw new BadRequestException('Слишком большой объём вложений');
      }
      urls.push(url);
    }
    return urls;
  }

  private validateAttachmentKeys(productId: string, urls: string[]): void {
    const prefix = `objects/product-qa/${productId}/`;
    for (const url of urls) {
      const key = this.storage.tryPublicUrlToKey(url);
      if (!key || !key.startsWith(prefix)) {
        throw new BadRequestException('Недопустимый URL вложения');
      }
    }
  }

  private async materializeAttachments(
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
      if (!row) throw new BadRequestException('Недопустимый URL вложения');
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

  async postBySlug(
    slug: string,
    jwtUserId: string,
    jwtRole: string,
    dto: PostProductQaMessageDto,
  ): Promise<ProductCorrespondenceMessageOut> {
    const product = await this.core.resolveActiveProductBySlug(slug);
    return this.postForProduct(product.id, jwtUserId, jwtRole, dto);
  }

  async postForProduct(
    productId: string,
    jwtUserId: string,
    jwtRole: string,
    dto: PostProductCorrespondenceMessageDto,
    opts?: { customerUserId?: string },
  ): Promise<ProductCorrespondenceMessageOut> {
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

    const customerUserId =
      authorRole === ProductQaAuthorRole.USER
        ? jwtUserId
        : opts?.customerUserId?.trim();
    if (!customerUserId) {
      throw new BadRequestException('customerUserId обязателен для ответа staff');
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

    const variantId = dto.productVariantId?.trim() || null;
    if (variantId) {
      const variant = await this.prisma.productVariant.findFirst({
        where: { id: variantId, productId, isActive: true },
        select: { id: true },
      });
      if (!variant) throw new BadRequestException('Недопустимый вариант товара');
    }

    const created = await this.prisma.$transaction(async (tx) => {
      await this.qaCore.lockProductForUpdate(tx, productId);
      const correspondence = await this.core.resolveOrCreateCorrespondence(
        productId,
        customerUserId,
        tx,
      );
      if (authorRole === ProductQaAuthorRole.USER) {
        const last = await tx.productCorrespondenceMessage.findFirst({
          where: { correspondenceId: correspondence.id, authorUserId: jwtUserId },
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true },
        });
        if (last) {
          const elapsed = Date.now() - last.createdAt.getTime();
          if (elapsed < PRODUCT_QA_POST_COOLDOWN_MS) {
            throw new BadRequestException('Подождите перед следующим сообщением');
          }
        }
      }
      const attachmentRefs = await this.materializeAttachments(
        tx,
        productId,
        jwtUserId,
        attachmentUrls,
      );
      const message = await tx.productCorrespondenceMessage.create({
        data: {
          correspondenceId: correspondence.id,
          authorUserId: jwtUserId,
          authorRole,
          body,
          productVariantId: variantId,
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
        include: correspondenceMessageInclude(),
      });
      await tx.productCorrespondence.update({
        where: { id: correspondence.id },
        data: { lastMessageAt: message.createdAt },
      });
      await this.qaCore.touchProductChatActivity(tx, productId, message.createdAt);
      return message;
    });

    const out = mapCorrespondenceMessage(created);

    this.gateway.broadcastCorrespondenceMessageCreated(created.correspondenceId, out);

    if (authorRole === ProductQaAuthorRole.USER) {
      this.notify.scheduleStaffNotifyForCorrespondenceQuestion(productId, out);
    } else {
      this.notify.scheduleCustomerNotifyForCorrespondenceReply(
        productId,
        customerUserId,
        out,
      );
    }

    return out;
  }

  async publishPairToQa(
    productId: string,
    questionMessageId: string,
    answerMessageId: string,
    staffUserId: string,
    staffRole: string,
    topicSlug?: string,
  ): Promise<{ question: ProductCorrespondenceMessageOut; answer: ProductCorrespondenceMessageOut }> {
    await this.core.assertStaffCatalogAccess(staffUserId, staffRole);
    const [question, answer] = await Promise.all([
      this.prisma.productCorrespondenceMessage.findFirst({
        where: { id: questionMessageId, correspondence: { productId } },
        include: correspondenceMessageInclude(),
      }),
      this.prisma.productCorrespondenceMessage.findFirst({
        where: { id: answerMessageId, correspondence: { productId } },
        include: correspondenceMessageInclude(),
      }),
    ]);
    if (!question || !answer) throw new NotFoundException('Сообщение не найдено');
    if (question.correspondenceId !== answer.correspondenceId) {
      throw new BadRequestException('Вопрос и ответ должны быть из одной переписки');
    }
    if (question.authorRole !== ProductQaAuthorRole.USER) {
      throw new BadRequestException('Первое сообщение пары должно быть от покупателя');
    }
    if (answer.authorRole !== ProductQaAuthorRole.STAFF) {
      throw new BadRequestException('Второе сообщение пары должно быть от staff');
    }
    if (question.publishedQaMessageId || answer.publishedQaMessageId) {
      throw new BadRequestException('Одно из сообщений уже опубликовано на витрине');
    }
    if (answer.createdAt < question.createdAt) {
      throw new BadRequestException('Ответ должен быть позже вопроса');
    }

    const thread = await this.qaCore.resolveThread(productId, topicSlug);

    const result = await this.prisma.$transaction(async (tx) => {
      await this.qaCore.lockProductForUpdate(tx, productId);
      const qaQuestion = await this.createQaFromCorrespondence(tx, thread.id, question, {
        forceVisible: true,
      });
      const qaAnswer = await this.createQaFromCorrespondence(tx, thread.id, answer, {
        forceVisible: true,
        replyToMessageId: qaQuestion.id,
      });
      const updatedQuestion = await tx.productCorrespondenceMessage.update({
        where: { id: question.id },
        data: { publishedQaMessageId: qaQuestion.id },
        include: correspondenceMessageInclude(),
      });
      const updatedAnswer = await tx.productCorrespondenceMessage.update({
        where: { id: answer.id },
        data: { publishedQaMessageId: qaAnswer.id },
        include: correspondenceMessageInclude(),
      });
      await this.qaCore.recalculatePublicCounts(tx, productId);
      await this.qaCore.touchProductChatActivity(tx, productId, qaAnswer.createdAt);
      return { updatedQuestion, updatedAnswer, qaQuestion, qaAnswer };
    });

    this.searchSync.scheduleProductReindex(productId);
    this.gateway.broadcastMessageCreated(productId, mapQaMessage(result.qaQuestion));
    this.gateway.broadcastMessageCreated(productId, mapQaMessage(result.qaAnswer));
    void this.broadcast.broadcastMeta(productId);

    return {
      question: mapCorrespondenceMessage(result.updatedQuestion),
      answer: mapCorrespondenceMessage(result.updatedAnswer),
    };
  }

  async publishMessageToQa(
    productId: string,
    messageId: string,
    staffUserId: string,
    staffRole: string,
    topicSlug?: string,
  ): Promise<ProductCorrespondenceMessageOut> {
    await this.core.assertStaffCatalogAccess(staffUserId, staffRole);
    const source = await this.prisma.productCorrespondenceMessage.findFirst({
      where: { id: messageId, correspondence: { productId } },
      include: {
        ...correspondenceMessageInclude(),
        correspondence: { select: { customerUserId: true } },
      },
    });
    if (!source) throw new NotFoundException('Сообщение не найдено');
    if (source.publishedQaMessageId) {
      throw new BadRequestException('Сообщение уже опубликовано на витрине');
    }
    if (source.authorRole !== ProductQaAuthorRole.USER) {
      throw new BadRequestException(
        'На витрину одним сообщением можно опубликовать только вопрос покупателя; ответ staff — через curated-пару Q→A',
      );
    }

    const thread = await this.qaCore.resolveThread(productId, topicSlug);
    const preMod = isProductQaPreModerationEnabled(this.config);
    const initialStatus =
      source.authorRole === ProductQaAuthorRole.USER && preMod
        ? ProductQaMessageStatus.PENDING
        : ProductQaMessageStatus.VISIBLE;

    const updated = await this.prisma.$transaction(async (tx) => {
      await this.qaCore.lockProductForUpdate(tx, productId);
      const qaMessage = await this.createQaFromCorrespondence(tx, thread.id, source, {
        forceVisible: initialStatus === ProductQaMessageStatus.VISIBLE,
      });
      const corr = await tx.productCorrespondenceMessage.update({
        where: { id: source.id },
        data: { publishedQaMessageId: qaMessage.id },
        include: correspondenceMessageInclude(),
      });
      await this.qaCore.recalculatePublicCounts(tx, productId);
      await this.qaCore.touchProductChatActivity(tx, productId, qaMessage.createdAt);
      return { corr, qaMessage };
    });

    this.searchSync.scheduleProductReindex(productId);
    const qaOut = mapQaMessage(updated.qaMessage);
    this.gateway.broadcastMessageCreated(productId, qaOut);
    if (updated.qaMessage.status === ProductQaMessageStatus.VISIBLE) {
      void this.broadcast.broadcastMeta(productId);
    }

    return mapCorrespondenceMessage(updated.corr);
  }

  private async createQaFromCorrespondence(
    tx: Prisma.TransactionClient,
    threadId: string,
    source: {
      authorUserId: string;
      authorRole: ProductQaAuthorRole;
      body: string;
      productVariantId: string | null;
      attachments: Array<{
        url: string;
        filename: string;
        mimeType: string;
        kind: import('@prisma/client').ProductQaAttachmentKind;
      }>;
    },
    opts?: { forceVisible?: boolean; replyToMessageId?: string },
  ) {
    const preMod = isProductQaPreModerationEnabled(this.config);
    const initialStatus = opts?.forceVisible
      ? ProductQaMessageStatus.VISIBLE
      : source.authorRole === ProductQaAuthorRole.USER && preMod
        ? ProductQaMessageStatus.PENDING
        : ProductQaMessageStatus.VISIBLE;

    return tx.productQaMessage.create({
      data: {
        threadId,
        authorUserId: source.authorUserId,
        authorRole: source.authorRole,
        body: source.body,
        productVariantId: source.productVariantId,
        status: initialStatus,
        replyToMessageId: opts?.replyToMessageId ?? null,
        attachments: source.attachments.length
          ? {
              create: source.attachments.map((a, i) => ({
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
  }
}
