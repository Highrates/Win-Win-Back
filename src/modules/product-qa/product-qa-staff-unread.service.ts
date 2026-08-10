import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, ProductQaAuthorRole, ProductQaMessageStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { productQaPreModerationEnabled } from './product-qa.constants';
import { ProductQaCoreService } from './product-qa-core.service';

@Injectable()
export class ProductQaStaffUnreadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly core: ProductQaCoreService,
  ) {}

  /** Статусы USER-сообщений, которые считаются «новыми» для staff. */
  staffUnreadMessageStatuses(): ProductQaMessageStatus[] {
    const preMod = productQaPreModerationEnabled(
      this.config.get<string>('PRODUCT_QA_PREMODERATION'),
    );
    return preMod ? [ProductQaMessageStatus.PENDING] : [ProductQaMessageStatus.VISIBLE];
  }

  async countUnreadForStaff(staffUserId: string): Promise<number> {
    const statuses = this.staffUnreadMessageStatuses();
    const baseline = await this.staffUnreadBaseline(staffUserId);
    return this.countUnreadViaSql(staffUserId, statuses, baseline);
  }

  private async staffUnreadBaseline(staffUserId: string): Promise<Date> {
    const staff = await this.prisma.user.findUnique({
      where: { id: staffUserId },
      select: { lastAdminLoginAt: true, createdAt: true },
    });
    return staff?.lastAdminLoginAt ?? staff?.createdAt ?? new Date(0);
  }

  /** SQL COUNT — без загрузки сообщений в память. */
  private async countUnreadViaSql(
    staffUserId: string,
    statuses: ProductQaMessageStatus[],
    baseline: Date,
  ): Promise<number> {
    const qaRows = await this.prisma.$queryRaw<Array<{ count: bigint }>>(
      Prisma.sql`
        SELECT COUNT(*)::bigint AS count
        FROM "ProductQaMessage" m
        INNER JOIN "ProductQaThread" t ON t.id = m."threadId"
        LEFT JOIN "ProductQaStaffReadState" rs
          ON rs."productId" = t."productId" AND rs."staffUserId" = ${staffUserId}
        WHERE m."authorRole" = ${ProductQaAuthorRole.USER}::"ProductQaAuthorRole"
          AND m.status IN (${Prisma.join(statuses.map((s) => Prisma.sql`${s}::"ProductQaMessageStatus"`))})
          AND m."createdAt" > COALESCE(rs."lastSeenAt", ${baseline})
      `,
    );
    const corrRows = await this.prisma.$queryRaw<Array<{ count: bigint }>>(
      Prisma.sql`
        SELECT COUNT(*)::bigint AS count
        FROM "ProductCorrespondenceMessage" cm
        INNER JOIN "ProductCorrespondence" c ON c.id = cm."correspondenceId"
        LEFT JOIN "ProductQaStaffReadState" rs
          ON rs."productId" = c."productId" AND rs."staffUserId" = ${staffUserId}
        WHERE cm."authorRole" = ${ProductQaAuthorRole.USER}::"ProductQaAuthorRole"
          AND cm."publishedQaMessageId" IS NULL
          AND cm."createdAt" > COALESCE(rs."lastSeenAt", ${baseline})
      `,
    );
    return Number(qaRows[0]?.count ?? 0n) + Number(corrRows[0]?.count ?? 0n);
  }

  async markProductSeen(
    staffUserId: string,
    staffRole: string,
    productId: string,
  ): Promise<{ ok: true }> {
    await this.core.assertStaffCatalogAccess(staffUserId, staffRole);
    await this.core.resolveProductById(productId);
    const now = new Date();
    await this.prisma.productQaStaffReadState.upsert({
      where: {
        staffUserId_productId: { staffUserId, productId },
      },
      create: { staffUserId, productId, lastSeenAt: now },
      update: { lastSeenAt: now },
    });
    return { ok: true };
  }

  async getUnreadSummary(
    staffUserId: string,
    staffRole: string,
  ): Promise<{ total: number }> {
    await this.core.assertStaffCatalogAccess(staffUserId, staffRole);
    const total = await this.countUnreadForStaff(staffUserId);
    return { total };
  }
}
