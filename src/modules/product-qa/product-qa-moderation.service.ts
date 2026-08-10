import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ProductQaMessageStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ObjectStorageService } from '../storage/object-storage.service';
import { PRODUCT_QA_MODERATION_PURGE_S3_ON_DELETED } from './product-qa.constants';
import { ProductQaBroadcastService } from './product-qa-broadcast.service';
import { ProductQaCoreService } from './product-qa-core.service';
import { ProductQaGateway } from './product-qa.gateway';
import { ProductQaNotifyService } from './product-qa-notify.service';
import { ProductQaSearchSyncService } from './product-qa-search-sync.service';
import { mapQaMessage, qaMessageInclude } from './product-qa.mapper';
import type { ProductQaMessageOut } from './product-qa.types';

@Injectable()
export class ProductQaModerationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly core: ProductQaCoreService,
    private readonly searchSync: ProductQaSearchSyncService,
    private readonly gateway: ProductQaGateway,
    private readonly broadcast: ProductQaBroadcastService,
    private readonly notify: ProductQaNotifyService,
    private readonly storage: ObjectStorageService,
  ) {}

  async setMessageStatus(
    productId: string,
    messageId: string,
    staffUserId: string,
    staffRole: string,
    status: ProductQaMessageStatus,
  ): Promise<ProductQaMessageOut> {
    await this.core.assertStaffCatalogAccess(staffUserId, staffRole);
    if (
      status !== ProductQaMessageStatus.VISIBLE &&
      status !== ProductQaMessageStatus.HIDDEN &&
      status !== ProductQaMessageStatus.DELETED
    ) {
      throw new BadRequestException('Недопустимый статус');
    }

    const existing = await this.prisma.productQaMessage.findFirst({
      where: { id: messageId, thread: { productId } },
      select: {
        id: true,
        status: true,
        threadId: true,
        attachments: { select: { url: true } },
      },
    });
    if (!existing) throw new NotFoundException('Сообщение не найдено');
    if (existing.status === ProductQaMessageStatus.PENDING) {
      throw new BadRequestException(
        'Сообщение на модерации — используйте approve или reject',
      );
    }

    const wasPublic = existing.status === ProductQaMessageStatus.VISIBLE;
    const willBePublic = status === ProductQaMessageStatus.VISIBLE;
    const visibilityChanged = wasPublic !== willBePublic;

    const updated = await this.prisma.$transaction(async (tx) => {
      await this.core.lockProductForUpdate(tx, productId);

      const patchResult = await tx.productQaMessage.updateMany({
        where: { id: messageId, status: existing.status, thread: { productId } },
        data: {
          status,
          hiddenAt:
            status === ProductQaMessageStatus.HIDDEN ? new Date() : null,
          hiddenByUserId:
            status === ProductQaMessageStatus.HIDDEN ? staffUserId : null,
          deletedAt:
            status === ProductQaMessageStatus.DELETED ? new Date() : null,
        },
      });

      if (patchResult.count === 0) {
        const current = await tx.productQaMessage.findFirst({
          where: { id: messageId, thread: { productId } },
          include: qaMessageInclude(),
        });
        if (!current) throw new NotFoundException('Сообщение не найдено');
        if (current.status === status) return current;
        throw new ConflictException('Статус сообщения уже изменён');
      }

      if (visibilityChanged) {
        await this.core.recalculatePublicCounts(tx, productId);
      }

      if (status === ProductQaMessageStatus.DELETED) {
        await this.clearCorrespondencePublishLinks(tx, messageId);
      }

      return tx.productQaMessage.findFirstOrThrow({
        where: { id: messageId },
        include: qaMessageInclude(),
      });
    });

    if (visibilityChanged) this.searchSync.scheduleProductReindex(productId);
    const out = mapQaMessage(updated);
    if (wasPublic && !willBePublic) {
      this.gateway.broadcastMessageHidden(productId, { id: messageId });
    } else if (!wasPublic && willBePublic) {
      this.gateway.broadcastMessageCreated(productId, out);
    }
    if (visibilityChanged) void this.broadcast.broadcastMeta(productId);

    if (
      PRODUCT_QA_MODERATION_PURGE_S3_ON_DELETED &&
      status === ProductQaMessageStatus.DELETED &&
      existing.status !== ProductQaMessageStatus.DELETED
    ) {
      void this.purgeAttachmentObjects(existing.attachments.map((a) => a.url));
    }

    return out;
  }

  async approvePendingMessage(
    productId: string,
    messageId: string,
    staffUserId: string,
    staffRole: string,
  ): Promise<ProductQaMessageOut> {
    return this.transitionPendingMessage(
      productId,
      messageId,
      staffUserId,
      staffRole,
      ProductQaMessageStatus.VISIBLE,
    );
  }

  async rejectPendingMessage(
    productId: string,
    messageId: string,
    staffUserId: string,
    staffRole: string,
  ): Promise<ProductQaMessageOut> {
    return this.transitionPendingMessage(
      productId,
      messageId,
      staffUserId,
      staffRole,
      ProductQaMessageStatus.REJECTED,
    );
  }

  private async transitionPendingMessage(
    productId: string,
    messageId: string,
    staffUserId: string,
    staffRole: string,
    targetStatus: ProductQaMessageStatus,
    opts?: { purgeAttachments?: boolean },
  ): Promise<ProductQaMessageOut> {
    if (
      targetStatus !== ProductQaMessageStatus.VISIBLE &&
      targetStatus !== ProductQaMessageStatus.REJECTED &&
      targetStatus !== ProductQaMessageStatus.DELETED
    ) {
      throw new BadRequestException('Недопустимый целевой статус');
    }
    await this.core.assertStaffCatalogAccess(staffUserId, staffRole);

    const existing = await this.prisma.productQaMessage.findFirst({
      where: { id: messageId, thread: { productId } },
      select: {
        id: true,
        status: true,
        attachments: { select: { url: true } },
      },
    });
    if (!existing) throw new NotFoundException('Сообщение не найдено');
    if (existing.status !== ProductQaMessageStatus.PENDING) {
      throw new BadRequestException('Сообщение не на модерации');
    }

    const willBePublic = targetStatus === ProductQaMessageStatus.VISIBLE;

    const updated = await this.prisma.$transaction(async (tx) => {
      await this.core.lockProductForUpdate(tx, productId);

      const patchResult = await tx.productQaMessage.updateMany({
        where: {
          id: messageId,
          status: ProductQaMessageStatus.PENDING,
          thread: { productId },
        },
        data: {
          status: targetStatus,
          deletedAt:
            targetStatus === ProductQaMessageStatus.DELETED ? new Date() : null,
        },
      });

      if (patchResult.count === 0) {
        throw new ConflictException('Статус сообщения уже изменён');
      }

      if (willBePublic) {
        await this.core.recalculatePublicCounts(tx, productId);
      }

      if (targetStatus === ProductQaMessageStatus.DELETED) {
        await this.clearCorrespondencePublishLinks(tx, messageId);
      }
      if (targetStatus === ProductQaMessageStatus.REJECTED) {
        await this.clearCorrespondencePublishLinks(tx, messageId);
      }

      return tx.productQaMessage.findFirstOrThrow({
        where: { id: messageId },
        include: qaMessageInclude(),
      });
    });

    if (willBePublic) {
      this.searchSync.scheduleProductReindex(productId);
      const out = mapQaMessage(updated);
      this.gateway.broadcastMessageCreated(productId, out);
      void this.broadcast.broadcastMeta(productId);
      return out;
    }

    const out = mapQaMessage(updated);
    this.gateway.broadcastMessageUpdated(productId, out);

    if (targetStatus === ProductQaMessageStatus.REJECTED) {
      this.notify.scheduleCustomerNotifyForQaReject(productId, out);
    }

    if (
      opts?.purgeAttachments &&
      targetStatus === ProductQaMessageStatus.DELETED &&
      PRODUCT_QA_MODERATION_PURGE_S3_ON_DELETED
    ) {
      void this.purgeAttachmentObjects(existing.attachments.map((a) => a.url));
    }

    return out;
  }

  /** Удаляет объекты S3 вложений (best-effort). HIDDEN не вызывает этот путь. */
  private async purgeAttachmentObjects(urls: string[]): Promise<void> {
    for (const url of urls) {
      const key = this.storage.tryPublicUrlToKey(url);
      if (!key) continue;
      try {
        await this.storage.removeObjectKey(key);
      } catch {
        /* orphan GC подберёт позже */
      }
    }
  }

  private async clearCorrespondencePublishLinks(
    tx: Prisma.TransactionClient,
    qaMessageId: string,
  ): Promise<void> {
    await tx.productCorrespondenceMessage.updateMany({
      where: { publishedQaMessageId: qaMessageId },
      data: { publishedQaMessageId: null },
    });
  }
}
