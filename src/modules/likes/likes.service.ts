import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CatalogService } from '../catalog/catalog.service';
import { ProductSearchIndexService } from '../../meilisearch/product-search-index.service';
import {
  buildCasePublicDto,
  buildProductSummaryMapForCases,
  displayLikes,
} from '../designers/case-public-dto.builder';

export type LikesCollectionQuery = {
  productsLimit: number;
  productsOffset: number;
  casesLimit: number;
  casesOffset: number;
};

@Injectable()
export class LikesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: CatalogService,
    private readonly productSearchIndex: ProductSearchIndexService,
  ) {}

  /** Актуальное состояние лайка и публичный счётчик после POST/DELETE. */
  async productLikeState(userId: string, productId: string): Promise<{ liked: boolean; likesDisplayCount: number }> {
    const [row, like] = await Promise.all([
      this.prisma.product.findUnique({
        where: { id: productId },
        select: { likesUserCount: true, likesAdminBoost: true },
      }),
      this.prisma.productLike.findUnique({
        where: { userId_productId: { userId, productId } },
        select: { id: true },
      }),
    ]);
    if (!row) return { liked: !!like, likesDisplayCount: 0 };
    return {
      liked: !!like,
      likesDisplayCount: displayLikes(row.likesUserCount, row.likesAdminBoost),
    };
  }

  async caseLikeState(userId: string, caseId: string): Promise<{ liked: boolean; likesDisplayCount: number }> {
    const [row, like] = await Promise.all([
      this.prisma.case.findUnique({
        where: { id: caseId },
        select: { likesUserCount: true, likesAdminBoost: true },
      }),
      this.prisma.caseLike.findUnique({
        where: { userId_caseId: { userId, caseId } },
        select: { id: true },
      }),
    ]);
    if (!row) return { liked: !!like, likesDisplayCount: 0 };
    return {
      liked: !!like,
      likesDisplayCount: displayLikes(row.likesUserCount, row.likesAdminBoost),
    };
  }

  async isProductLiked(userId: string, productId: string): Promise<{ liked: boolean }> {
    const row = await this.prisma.productLike.findUnique({
      where: { userId_productId: { userId, productId } },
      select: { id: true },
    });
    return { liked: !!row };
  }

  async isCaseLiked(userId: string, caseId: string): Promise<{ liked: boolean }> {
    const row = await this.prisma.caseLike.findUnique({
      where: { userId_caseId: { userId, caseId } },
      select: { id: true },
    });
    return { liked: !!row };
  }

  async likeProduct(userId: string, productId: string) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, isActive: true },
    });
    if (!product || !product.isActive) throw new NotFoundException('Товар не найден');
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.productLike.create({ data: { userId, productId } });
        await tx.product.update({
          where: { id: productId },
          data: { likesUserCount: { increment: 1 } },
        });
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        return { ok: true as const, ...(await this.productLikeState(userId, productId)) };
      }
      throw e;
    }
    void this.productSearchIndex.syncProduct(productId);
    return { ok: true as const, ...(await this.productLikeState(userId, productId)) };
  }

  async unlikeProduct(userId: string, productId: string) {
    const del = await this.prisma.$transaction(async (tx) => {
      const removed = await tx.productLike.deleteMany({ where: { userId, productId } });
      if (removed.count > 0) {
        await tx.$executeRaw(
          Prisma.sql`
            UPDATE "Product"
            SET "likesUserCount" = GREATEST(0, "likesUserCount" - 1)
            WHERE "id" = ${productId}
          `,
        );
      }
      return removed.count;
    });
    if (del > 0) void this.productSearchIndex.syncProduct(productId);
    return { ok: true as const, ...(await this.productLikeState(userId, productId)) };
  }

  async likeCase(userId: string, caseId: string) {
    const c = await this.prisma.case.findUnique({ where: { id: caseId }, select: { id: true } });
    if (!c) throw new NotFoundException('Кейс не найден');
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.caseLike.create({ data: { userId, caseId } });
        await tx.case.update({
          where: { id: caseId },
          data: { likesUserCount: { increment: 1 } },
        });
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        return { ok: true as const, ...(await this.caseLikeState(userId, caseId)) };
      }
      throw e;
    }
    return { ok: true as const, ...(await this.caseLikeState(userId, caseId)) };
  }

  async unlikeCase(userId: string, caseId: string) {
    await this.prisma.$transaction(async (tx) => {
      const removed = await tx.caseLike.deleteMany({ where: { userId, caseId } });
      if (removed.count > 0) {
        await tx.$executeRaw(
          Prisma.sql`
            UPDATE "Case"
            SET "likesUserCount" = GREATEST(0, "likesUserCount" - 1)
            WHERE "id" = ${caseId}
          `,
        );
      }
    });
    return { ok: true as const, ...(await this.caseLikeState(userId, caseId)) };
  }

  async getCollection(userId: string, q: LikesCollectionQuery) {
    const { productsLimit, productsOffset, casesLimit, casesOffset } = q;

    const caseLikeSelect = {
      case: {
        select: {
          id: true,
          title: true,
          shortDescription: true,
          descriptionHtml: true,
          coverLayout: true,
          coverImageUrls: true,
          roomTypes: true,
          productIds: true,
          likesUserCount: true,
          likesAdminBoost: true,
          user: {
            select: {
              designer: { select: { slug: true, displayName: true, photoUrl: true } },
              profile: { select: { avatarUrl: true } },
            },
          },
        },
      },
    } as const;

    const [productsTotal, casesTotal, productLikeRows, caseLikeRows] = await Promise.all([
      this.prisma.productLike.count({ where: { userId } }),
      this.prisma.caseLike.count({ where: { userId } }),
      this.prisma.productLike.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip: productsLimit > 0 ? productsOffset : 0,
        take: productsLimit > 0 ? productsLimit : 0,
        select: { productId: true },
      }),
      this.prisma.caseLike.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip: casesLimit > 0 ? casesOffset : 0,
        take: casesLimit > 0 ? casesLimit : 0,
        select: caseLikeSelect,
      }),
    ]);

    const productIds = productLikeRows.map((r) => r.productId);
    const { items: summaries } = await this.catalog.resolveProductSummariesByIds(productIds);
    const summaryById = new Map(summaries.map((s) => [s.id, s]));
    const products = productIds.map((id) => {
      const s = summaryById.get(id);
      if (!s)
        return {
          id,
          slug: '',
          name: 'Товар',
          price: 0,
          imageUrl: null as string | null,
          imageUrls: [] as string[],
          casesLinkedCount: 0,
          likesDisplayCount: 0,
        };
      return {
        id: s.id,
        slug: s.slug,
        name: s.name,
        price: s.price,
        imageUrl: s.imageUrl,
        imageUrls: s.imageUrls ?? [],
        casesLinkedCount: s.casesLinkedCount,
        likesDisplayCount: s.likesDisplayCount,
      };
    });

    const caseRowsOnly = caseLikeRows.map((r) => r.case);
    const caseProductById = await buildProductSummaryMapForCases(this.catalog, caseRowsOnly);
    const cases = caseLikeRows.map(({ case: c }) => {
      const des = c.user.designer;
      const prof = c.user.profile;
      const designerPhoto = des?.photoUrl?.trim() || prof?.avatarUrl?.trim() || null;
      return buildCasePublicDto(c, caseProductById, {
        slug: des?.slug?.trim() ?? '',
        displayName: des?.displayName?.trim() ?? '',
        photoUrl: designerPhoto,
      });
    });

    return {
      products,
      cases,
      productsTotal,
      casesTotal,
      productsLimit,
      productsOffset,
      casesLimit,
      casesOffset,
    };
  }
}
