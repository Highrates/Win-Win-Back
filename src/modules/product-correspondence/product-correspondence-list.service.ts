import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, ProductQaAuthorRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  correspondenceMessageInclude,
  mapCorrespondenceMessage,
  previewCorrespondenceBody,
} from './product-correspondence.mapper';
import { ProductCorrespondenceCoreService } from './product-correspondence-core.service';
import type {
  ProductCorrespondenceMessagesListOut,
  ProductCorrespondenceMyProductsListOut,
  ProductCorrespondenceThreadsListOut,
} from './product-correspondence.types';

@Injectable()
export class ProductCorrespondenceListService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly core: ProductCorrespondenceCoreService,
  ) {}

  async listMessagesBySlug(
    slug: string,
    customerUserId: string,
    opts?: { limit?: number; beforeMessageId?: string },
  ): Promise<ProductCorrespondenceMessagesListOut> {
    const product = await this.core.resolveActiveProductBySlug(slug);
    const correspondence = await this.core.resolveOrCreateCorrespondence(
      product.id,
      customerUserId,
    );
    return this.listMessages(correspondence.id, opts);
  }

  async listMessagesForProduct(
    productId: string,
    customerUserId: string,
    opts?: { limit?: number; beforeMessageId?: string },
  ): Promise<ProductCorrespondenceMessagesListOut> {
    const correspondence = await this.core.getCorrespondenceForCustomer(productId, customerUserId);
    return this.listMessages(correspondence.id, opts);
  }

  private async listMessages(
    correspondenceId: string,
    opts?: { limit?: number; beforeMessageId?: string },
  ): Promise<ProductCorrespondenceMessagesListOut> {
    const limit = this.core.normalizePageLimit(opts?.limit);
    const correspondence = await this.prisma.productCorrespondence.findUniqueOrThrow({
      where: { id: correspondenceId },
      select: { id: true, productId: true, customerUserId: true },
    });

    let messageWhere: Prisma.ProductCorrespondenceMessageWhereInput = {
      correspondenceId: correspondence.id,
    };
    const beforeId = opts?.beforeMessageId?.trim();
    if (beforeId) {
      const anchor = await this.prisma.productCorrespondenceMessage.findFirst({
        where: { id: beforeId, correspondenceId: correspondence.id },
        select: { id: true, createdAt: true },
      });
      if (!anchor) throw new BadRequestException('Неизвестная граница истории сообщений');
      messageWhere = {
        AND: [
          messageWhere,
          {
            OR: [
              { createdAt: { lt: anchor.createdAt } },
              { AND: [{ createdAt: anchor.createdAt }, { id: { lt: anchor.id } }] },
            ],
          },
        ],
      };
    }

    const rowsDesc = await this.prisma.productCorrespondenceMessage.findMany({
      where: messageWhere,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      include: correspondenceMessageInclude(),
    });
    const hasOlder = rowsDesc.length > limit;
    const chronological = rowsDesc.slice(0, limit).reverse();

    return {
      correspondenceId: correspondence.id,
      productId: correspondence.productId,
      customerUserId: correspondence.customerUserId,
      messages: chronological.map(mapCorrespondenceMessage),
      hasOlder,
    };
  }

  async listMyProducts(userId: string): Promise<ProductCorrespondenceMyProductsListOut> {
    const uid = userId.trim();
    const rows = await this.prisma.productCorrespondence.findMany({
      where: { customerUserId: uid },
      orderBy: { lastMessageAt: 'desc' },
      select: {
        id: true,
        lastMessageAt: true,
        product: {
          select: {
            id: true,
            slug: true,
            name: true,
            isActive: true,
            images: { orderBy: { sortOrder: 'asc' }, take: 1, select: { url: true } },
          },
        },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { body: true, authorRole: true },
        },
      },
    });

    const correspondenceIds = rows.map((row) => row.id);
    const staffReplyRows =
      correspondenceIds.length === 0
        ? []
        : await this.prisma.productCorrespondenceMessage.findMany({
            where: {
              correspondenceId: { in: correspondenceIds },
              authorRole: ProductQaAuthorRole.STAFF,
            },
            select: { correspondenceId: true },
            distinct: ['correspondenceId'],
          });
    const hasStaffReplyIds = new Set(staffReplyRows.map((row) => row.correspondenceId));

    const items = rows.map((row) => {
      const last = row.messages[0];
      return {
        productId: row.product.id,
        productSlug: row.product.slug,
        productName: row.product.name,
        productImageUrl: row.product.images[0]?.url ?? null,
        isProductActive: row.product.isActive,
        lastMessageAt: row.lastMessageAt.toISOString(),
        lastMessagePreview: last ? previewCorrespondenceBody(last.body) : '',
        hasStaffReply: hasStaffReplyIds.has(row.id),
        awaitingStaffReply: last?.authorRole === ProductQaAuthorRole.USER,
      };
    });

    return { items };
  }

  async listThreadsForProduct(productId: string): Promise<ProductCorrespondenceThreadsListOut> {
    await this.core.resolveProductById(productId);
    const rows = await this.prisma.productCorrespondence.findMany({
      where: { productId },
      orderBy: { lastMessageAt: 'desc' },
      select: {
        id: true,
        customerUserId: true,
        lastMessageAt: true,
        customer: {
          select: {
            profile: { select: { firstName: true, lastName: true } },
          },
        },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { body: true },
        },
      },
    });

    const correspondenceIds = rows.map((row) => row.id);
    const unpublishedGrouped =
      correspondenceIds.length === 0
        ? []
        : await this.prisma.productCorrespondenceMessage.groupBy({
            by: ['correspondenceId'],
            where: {
              correspondenceId: { in: correspondenceIds },
              authorRole: ProductQaAuthorRole.USER,
              publishedQaMessageId: null,
            },
            _count: { _all: true },
          });
    const unpublishedByCorr = new Map(
      unpublishedGrouped.map((row) => [row.correspondenceId, row._count._all]),
    );

    const items = rows.map((row) => {
      const name = [row.customer.profile?.firstName, row.customer.profile?.lastName]
        .filter(Boolean)
        .join(' ')
        .trim();
      return {
        correspondenceId: row.id,
        customerUserId: row.customerUserId,
        customerLabel: name || 'Покупатель',
        lastMessageAt: row.lastMessageAt.toISOString(),
        lastMessagePreview: row.messages[0]
          ? previewCorrespondenceBody(row.messages[0].body)
          : '',
        unpublishedCount: unpublishedByCorr.get(row.id) ?? 0,
      };
    });

    return { items };
  }
}
