import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { enrichProductsWithLikedByMe } from '../../common/utils/enrich-products-liked-by-me';
import { collectCategoryAndDescendantIds } from '../catalog/category-scope';
import { CatalogService } from '../catalog/catalog.service';
import {
  buildCasePublicDto,
  buildProductSummaryMapForCases,
} from '../designers/case-public-dto.builder';

@Injectable()
export class BrandsService {
  constructor(
    private prisma: PrismaService,
    private catalog: CatalogService,
  ) {}

  private async categoryScopeIds(categoryId: string): Promise<string[]> {
    const trimmed = categoryId.trim();
    if (!trimmed) return [];
    const rows = await this.prisma.category.findMany({
      where: { isActive: true },
      select: { id: true, parentId: true },
    });
    return collectCategoryAndDescendantIds(trimmed, rows);
  }

  async findAll(categoryId?: string) {
    const where: Prisma.BrandWhereInput = { isActive: true };
    const scope = categoryId?.trim() ? await this.categoryScopeIds(categoryId) : [];
    if (scope.length) {
      where.products = {
        some: {
          isActive: true,
          OR: [
            { categoryId: { in: scope } },
            { productCategories: { some: { categoryId: { in: scope } } } },
          ],
        },
      };
    }
    return this.prisma.brand.findMany({
      where,
      orderBy: { sortOrder: 'asc' },
      include: { _count: { select: { products: true } } },
    });
  }

  async findBySlug(slug: string, userId?: string, categoryId?: string) {
    const scope = categoryId?.trim() ? await this.categoryScopeIds(categoryId) : [];
    const productWhere: Prisma.ProductWhereInput = { isActive: true };
    if (scope.length) {
      productWhere.OR = [
        { categoryId: { in: scope } },
        { productCategories: { some: { categoryId: { in: scope } } } },
      ];
    }

    const row = await this.prisma.brand.findUnique({
      where: { slug, isActive: true },
      include: {
        products: {
          where: productWhere,
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
          include: {
            catalogTags: { select: { tag: { select: { slug: true, name: true } } } },
            images: { orderBy: { sortOrder: 'asc' } },
            variants: {
              where: { isActive: true },
              orderBy: [{ isDefault: 'desc' }, { sortOrder: 'asc' }],
              select: {
                id: true,
                variantLabel: true,
                price: true,
                currency: true,
                widthMm: true,
                heightMm: true,
                model3dUrl: true,
                drawingUrl: true,
              },
            },
            elements: {
              select: {
                availabilities: {
                  select: {
                    brandMaterialColor: {
                      select: {
                        brandMaterial: { select: { id: true, name: true } },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!row) throw new NotFoundException('Brand not found');

    const { products: rawProducts, ...brandRest } = row;
    const products = rawProducts.map((p) => {
      const dv = p.variants[0];
      /** Как в каталоге (Meilisearch): общая галерея товара, не снимки варианта. */
      const images = p.images.map((im, i) => ({ url: im.url, sortOrder: i }));
      const materialById = new Map<string, string>();
      for (const el of p.elements) {
        for (const av of el.availabilities) {
          const m = av.brandMaterialColor?.brandMaterial;
          if (m?.id && m.name) materialById.set(m.id, m.name);
        }
      }
      const widths = p.variants.map((v) => v.widthMm).filter((n): n is number => n != null);
      const heights = p.variants.map((v) => v.heightMm).filter((n): n is number => n != null);
      return {
        id: p.id,
        slug: p.slug,
        name: p.name,
        displayName: dv?.variantLabel?.trim() || p.name,
        variantId: dv?.id ?? null,
        price: dv?.price ?? null,
        currency: dv?.currency ?? 'RUB',
        images,
        categoryId: p.categoryId,
        brandId: p.brandId ?? row.id,
        brandName: row.name,
        tagSlugs: p.catalogTags.map((t) => t.tag.slug).filter(Boolean),
        materials: Array.from(materialById.entries()).map(([id, name]) => ({ id, name })),
        widthMm: widths.length ? Math.min(...widths) : null,
        heightMm: heights.length ? Math.min(...heights) : null,
        hasCase: p.casesLinkedCount > 0,
        has3d: p.variants.some((v) => Boolean(v.model3dUrl?.trim())),
        hasDrawing: p.variants.some((v) => Boolean(v.drawingUrl?.trim())),
        casesLinkedCount: p.casesLinkedCount,
        qaMessageCountPublic: p.qaMessageCountPublic,
        likesDisplayCount: Math.max(0, p.likesUserCount + p.likesAdminBoost),
      };
    });

    const productsWithLikes = await enrichProductsWithLikedByMe(this.prisma, products, userId);
    const casesCount = await this.prisma.case.count({
      where: { brandId: row.id, isPublished: true },
    });
    return { ...brandRest, products: productsWithLikes, casesCount };
  }

  /** Публичные проекты брендов для `/projects` (source=brands). */
  async listPublicCases(opts?: {
    brandSlug?: string;
    productId?: string;
    page?: number;
    limit?: number;
  }) {
    const brandSlug = opts?.brandSlug?.trim() || '';
    const productId = opts?.productId?.trim() || '';
    const page = Number.isFinite(opts?.page) && (opts?.page ?? 0) > 0 ? Math.floor(opts!.page!) : 1;
    const limit = Math.min(
      60,
      Math.max(1, Number.isFinite(opts?.limit) ? Math.floor(opts!.limit!) : 48),
    );

    let brandId: string | undefined;
    if (brandSlug) {
      const b = await this.prisma.brand.findFirst({
        where: { slug: brandSlug, isActive: true },
        select: { id: true },
      });
      if (!b) return { items: [], total: 0, page, limit };
      brandId = b.id;
    }

    const where: Prisma.CaseWhereInput = {
      brandId: brandId ? brandId : { not: null },
      isPublished: true,
      brand: { is: { isActive: true } },
      ...(productId ? { caseProducts: { some: { productId } } } : {}),
    };

    const total = await this.prisma.case.count({ where });
    const caseRows = await this.prisma.case.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
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
        brand: {
          select: { slug: true, name: true, logoUrl: true },
        },
      },
    });

    const productById = await buildProductSummaryMapForCases(this.catalog, caseRows);
    const items = caseRows
      .filter((c) => c.brand != null)
      .map((c) =>
        buildCasePublicDto(c, productById, null, {
          slug: c.brand!.slug,
          displayName: c.brand!.name,
          logoUrl: c.brand!.logoUrl,
        }),
      );

    return { items, total, page, limit };
  }
}
