import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CatalogService } from '../catalog/catalog.service';
import { sanitizeProfileAboutHtml } from '../blog/blog-html.util';
import { ProductSearchIndexService } from '../../meilisearch/product-search-index.service';

function parseStringIds(raw: Prisma.JsonValue | null | undefined, max: number): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x): x is string => typeof x === 'string')
    .map((x) => x.trim())
    .filter((x) => x.length > 0)
    .slice(0, max);
}

function parseCoverUrls(raw: Prisma.JsonValue): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x): x is string => typeof x === 'string')
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
}

function servicesLineFromJson(raw: Prisma.JsonValue): string | null {
  if (Array.isArray(raw)) {
    const parts = raw
      .filter((x): x is string => typeof x === 'string')
      .map((x) => x.trim())
      .filter((x) => x.length > 0);
    return parts.length ? parts.join(', ') : null;
  }
  return null;
}

function roomTypesLabelsFromJson(raw: Prisma.JsonValue | null | undefined): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of raw) {
    if (typeof x !== 'string') continue;
    const t = x.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

function displayLikes(user: number, admin: number): number {
  return Math.max(0, user + admin);
}

@Injectable()
export class LikesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: CatalogService,
    private readonly productSearchIndex: ProductSearchIndexService,
  ) {}

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
        return { ok: true as const };
      }
      throw e;
    }
    void this.productSearchIndex.syncProduct(productId);
    return { ok: true as const };
  }

  async unlikeProduct(userId: string, productId: string) {
    const del = await this.prisma.$transaction(async (tx) => {
      const removed = await tx.productLike.deleteMany({ where: { userId, productId } });
      if (removed.count > 0) {
        await tx.product.update({
          where: { id: productId },
          data: { likesUserCount: { decrement: 1 } },
        });
      }
      return removed.count;
    });
    if (del > 0) void this.productSearchIndex.syncProduct(productId);
    return { ok: true as const };
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
        return { ok: true as const };
      }
      throw e;
    }
    return { ok: true as const };
  }

  async unlikeCase(userId: string, caseId: string) {
    await this.prisma.$transaction(async (tx) => {
      const removed = await tx.caseLike.deleteMany({ where: { userId, caseId } });
      if (removed.count > 0) {
        await tx.case.update({
          where: { id: caseId },
          data: { likesUserCount: { decrement: 1 } },
        });
      }
    });
    return { ok: true as const };
  }

  async getCollection(userId: string) {
    const [productLikeRows, caseLikeRows] = await Promise.all([
      this.prisma.productLike.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        select: { productId: true },
      }),
      this.prisma.caseLike.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        select: {
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
        },
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

    const cases = caseLikeRows.map(({ case: c }) => {
      const pids = parseStringIds(c.productIds, 80);
      const coverUrls = parseCoverUrls(c.coverImageUrls ?? null);
      const layoutCase = c.coverLayout === '16:9' ? ('16:9' as const) : ('4:3' as const);
      const rawDesc = c.descriptionHtml?.trim() ? c.descriptionHtml.trim() : '';
      const descriptionHtml = rawDesc ? sanitizeProfileAboutHtml(rawDesc) : null;
      const des = c.user.designer;
      const prof = c.user.profile;
      const designerPhoto = des?.photoUrl?.trim() || prof?.avatarUrl?.trim() || null;
      return {
        id: c.id,
        title: c.title,
        shortDescription: c.shortDescription?.trim() || null,
        placesLine: servicesLineFromJson(c.roomTypes ?? null),
        roomTypes: roomTypesLabelsFromJson(c.roomTypes ?? null),
        descriptionHtml,
        coverLayout: layoutCase,
        coverImageUrls: coverUrls,
        likesDisplayCount: displayLikes(c.likesUserCount, c.likesAdminBoost),
        designerSlug: des?.slug?.trim() ?? '',
        designerDisplayName: des?.displayName?.trim() ?? '',
        designerPhotoUrl: designerPhoto,
        products: pids.map((pid) => ({
          id: pid,
          slug: '',
          name: 'Товар',
          price: 0,
          imageUrl: null as string | null,
          imageUrls: [] as string[],
          casesLinkedCount: 0,
          likesDisplayCount: 0,
        })),
      };
    });

    const allCaseProductIds = [...new Set(cases.flatMap((row) => row.products.map((p) => p.id)))];
    if (allCaseProductIds.length) {
      const { items: caseProducts } = await this.catalog.resolveProductSummariesByIds(allCaseProductIds);
      const pm = new Map(caseProducts.map((p) => [p.id, p]));
      for (const row of cases) {
        row.products = row.products.map((slot) => {
          const p = pm.get(slot.id);
          if (!p)
            return {
              id: slot.id,
              slug: '',
              name: 'Товар',
              price: 0,
              imageUrl: null,
              imageUrls: [] as string[],
              casesLinkedCount: 0,
              likesDisplayCount: 0,
            };
          return {
            id: p.id,
            slug: p.slug,
            name: p.name,
            price: p.price,
            imageUrl: p.imageUrl,
            imageUrls: p.imageUrls ?? [],
            casesLinkedCount: p.casesLinkedCount,
            likesDisplayCount: p.likesDisplayCount,
          };
        });
      }
    }

    return { products, cases };
  }
}
