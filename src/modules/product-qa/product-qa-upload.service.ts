import { BadRequestException, ForbiddenException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ProductQaAuthorRole } from '@prisma/client';
import { productQaAuthorRoleFromJwt } from './product-qa-auth.util';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { ObjectStorageService } from '../storage/object-storage.service';
import { ProductQaCoreService } from './product-qa-core.service';
import {
  PRODUCT_QA_PENDING_UPLOAD_TTL_MS,
  PRODUCT_QA_UPLOAD_QUOTA_MAX,
  PRODUCT_QA_UPLOAD_QUOTA_WINDOW_MS,
} from './product-qa.constants';
import { attachmentKindFromMime, decodeQaUploadOriginalName } from './product-qa.mapper';

@Injectable()
export class ProductQaUploadService implements OnModuleInit {
  private readonly logger = new Logger(ProductQaUploadService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly core: ProductQaCoreService,
    private readonly storage: ObjectStorageService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    const raw = this.config.get<string>('PRODUCT_QA_PENDING_UPLOAD_SWEEP_MS') ?? '3600000';
    const ms = parseInt(raw, 10);
    if (!Number.isFinite(ms) || ms <= 0) return;
    this.logger.log(`GC pending product-qa uploads каждые ${ms} ms`);
    const tick = () => {
      this.sweepExpiredPendingUploads().catch((e) => this.logger.error(e));
    };
    const h = setInterval(tick, ms);
    if (typeof (h as NodeJS.Timeout).unref === 'function') {
      (h as NodeJS.Timeout).unref();
    }
  }

  private async assertUploadQuota(productId: string, userId: string): Promise<void> {
    const since = new Date(Date.now() - PRODUCT_QA_UPLOAD_QUOTA_WINDOW_MS);
    const [attachedCount, pendingCount] = await Promise.all([
      this.prisma.productQaAttachment.count({
        where: {
          message: {
            authorUserId: userId,
            thread: { productId },
            createdAt: { gte: since },
          },
        },
      }),
      this.prisma.productQaPendingUpload.count({
        where: { productId, userId, createdAt: { gte: since } },
      }),
    ]);
    if (attachedCount + pendingCount >= PRODUCT_QA_UPLOAD_QUOTA_MAX) {
      throw new BadRequestException('Превышена квота загрузок для этого товара');
    }
  }

  async uploadAttachment(
    productId: string,
    jwtUserId: string,
    jwtRole: string,
    file: Express.Multer.File,
  ): Promise<{ url: string; filename: string; mimeType: string; kind: ReturnType<typeof attachmentKindFromMime> }> {
    await this.core.resolveActiveProductById(productId);
    const authorRole = productQaAuthorRoleFromJwt(jwtRole);
    if (authorRole === ProductQaAuthorRole.USER) {
      const user = await this.prisma.user.findUnique({
        where: { id: jwtUserId },
        select: { isActive: true },
      });
      if (!user?.isActive) throw new ForbiddenException('Аккаунт недоступен');
    } else {
      await this.core.assertStaffCatalogAccess(jwtUserId, jwtRole);
    }
    await this.assertUploadQuota(productId, jwtUserId);

    const safeName = decodeQaUploadOriginalName(file.originalname);
    this.storage.assertLibraryFile({
      size: file.size,
      mimetype: file.mimetype,
      originalname: safeName,
    });

    const ext = this.storage.libraryFileExtension(file.mimetype, safeName || 'file');
    const objectKey = `objects/product-qa/${productId}/${randomBytes(16).toString('hex')}${ext}`;
    const { url } = await this.storage.uploadMediaLibraryObject(
      file.buffer,
      file.mimetype,
      objectKey,
      safeName,
    );

    await this.prisma.productQaPendingUpload.create({
      data: {
        productId,
        userId: jwtUserId,
        url,
        objectKey,
        filename: safeName.slice(0, 512),
        mimeType: file.mimetype,
      },
    });

    return {
      url,
      filename: safeName.slice(0, 512),
      mimeType: file.mimetype,
      kind: attachmentKindFromMime(file.mimetype),
    };
  }

  async revokePendingUpload(productId: string, jwtUserId: string, url: string): Promise<void> {
    const trimmed = url.trim();
    if (!trimmed) throw new BadRequestException('URL не указан');
    const row = await this.prisma.productQaPendingUpload.findFirst({
      where: { productId, userId: jwtUserId, url: trimmed },
    });
    if (!row) return;
    await this.storage.removeObjectKey(row.objectKey);
    await this.prisma.productQaPendingUpload.delete({ where: { id: row.id } });
  }

  async sweepExpiredPendingUploads(): Promise<{ deleted: number }> {
    const cutoff = new Date(Date.now() - PRODUCT_QA_PENDING_UPLOAD_TTL_MS);
    const stale = await this.prisma.productQaPendingUpload.findMany({
      where: { createdAt: { lt: cutoff } },
      select: { id: true, objectKey: true },
      take: 200,
    });
    let deleted = 0;
    for (const row of stale) {
      try {
        await this.storage.removeObjectKey(row.objectKey);
      } catch (e) {
        this.logger.warn(`Не удалось удалить ${row.objectKey}: ${e}`);
      }
      await this.prisma.productQaPendingUpload.delete({ where: { id: row.id } });
      deleted += 1;
    }
    if (deleted > 0) {
      this.logger.log(`GC product-qa pending uploads: удалено ${deleted}`);
    }
    return { deleted };
  }
}
