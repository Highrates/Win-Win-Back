import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { CuratedCollectionKind, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MeilisearchService, PRODUCTS_INDEX } from '../../meilisearch/meilisearch.service';
import {
  buildProductSearchDocument,
  collectProductCategoryIds,
} from '../../meilisearch/product-search-doc';

/**
 * Убирает повторы одного товара в выдаче (например, при склейке «свои + по доп. категории» или сбое индекса).
 * Сохраняется первое вхождение по порядку массива.
 */
function dedupeProductHitsById<T extends Record<string, unknown>>(hits: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const h of hits) {
    const id = h.id;
    if (typeof id !== 'string' || !id || seen.has(id)) continue;
    seen.add(id);
    out.push(h);
  }
  return out;
}

/** Публичное дерево каталога: только корни и их прямые дети (без дублирования плоского списка). */
export type PublicCategoryTreeChild = {
  id: string;
  slug: string;
  name: string;
  sortOrder: number;
  backgroundImageUrl: string | null;
};

export type PublicCategoryTreeRoot = PublicCategoryTreeChild & {
  children: PublicCategoryTreeChild[];
};

@Injectable()
export class CatalogService {
  private readonly log = new Logger(CatalogService.name);

  constructor(
    private prisma: PrismaService,
    private meilisearch: MeilisearchService,
  ) {}

  async getCategories() {
    const rows = await this.prisma.category.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
      include: {
        _count: { select: { primaryProducts: true, productCategories: true, children: true } },
        children: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } },
      },
    });
    return rows.map(({ _count, ...rest }) => ({
      ...rest,
      _count: {
        products: _count.primaryProducts + _count.productCategories,
        children: _count.children,
      },
    }));
  }

  /** Корни для меню: только slug, name, sortOrder. */
  async getCategoryRootsNav() {
    const rows = await this.prisma.category.findMany({
      where: { isActive: true, parentId: null },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { slug: true, name: true, sortOrder: true },
    });
    return { items: rows };
  }

  /**
   * Дерево для витрины: активные корни и их активные дети (один объект на узел, без плоского дублирования).
   */
  async getCategoryTree(): Promise<{ roots: PublicCategoryTreeRoot[] }> {
    const rows = await this.prisma.category.findMany({
      where: { isActive: true, parentId: null },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: {
        children: {
          where: { isActive: true },
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
          select: {
            id: true,
            slug: true,
            name: true,
            sortOrder: true,
            backgroundImageUrl: true,
          },
        },
      },
    });
    const roots: PublicCategoryTreeRoot[] = rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      name: r.name,
      sortOrder: r.sortOrder,
      backgroundImageUrl: r.backgroundImageUrl,
      children: r.children.map((c) => ({
        id: c.id,
        slug: c.slug,
        name: c.name,
        sortOrder: c.sortOrder,
        backgroundImageUrl: c.backgroundImageUrl,
      })),
    }));
    return { roots };
  }

  /** Дети активного корня по slug родителя (для ленивой подгрузки / API). */
  async getCategoryChildrenByParentSlug(parentSlug: string) {
    const parentRow = await this.prisma.category.findFirst({
      where: { slug: parentSlug, isActive: true, parentId: null },
      select: { id: true, slug: true, name: true },
    });
    if (!parentRow) throw new NotFoundException('Parent category not found');
    const children = await this.prisma.category.findMany({
      where: { isActive: true, parentId: parentRow.id },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        slug: true,
        name: true,
        sortOrder: true,
        backgroundImageUrl: true,
      },
    });
    return {
      parent: { slug: parentRow.slug, name: parentRow.name },
      children,
    };
  }

  async getCategoryBySlug(slug: string) {
    const row = await this.prisma.category.findUnique({
      where: { slug, isActive: true },
      include: {
        parent: true,
        children: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } },
        _count: { select: { primaryProducts: true, productCategories: true } },
      },
    });
    if (!row) return null;
    const { _count, ...rest } = row;
    return {
      ...rest,
      _count: {
        products: _count.primaryProducts + _count.productCategories,
      },
    };
  }

  async getProductBySlug(slug: string) {
    return this.prisma.product.findUnique({
      where: { slug, isActive: true },
      include: {
        category: { include: { parent: { select: { id: true, slug: true, name: true } } } },
        productCategories: { include: { category: true } },
        brand: true,
        images: { orderBy: { sortOrder: 'asc' } },
      },
    });
  }

  async searchProducts(params: {
    q?: string;
    categoryId?: string;
    brandId?: string;
    page?: number;
    limit?: number;
  }) {
    const page = params.page ?? 1;
    const limit = Math.min(params.limit ?? 20, 100);

    if (!this.meilisearch.isEnabled()) {
      return this.searchProductsViaPrisma(params, page, limit);
    }

    try {
      const index = this.meilisearch.getIndex(PRODUCTS_INDEX);
      const filters: string[] = ['isActive = true'];
      if (params.categoryId) filters.push(`categoryIds = "${params.categoryId}"`);
      if (params.brandId) filters.push(`brandId = "${params.brandId}"`);
      const filter = filters.join(' AND ');
      const result = await index.search(params.q ?? '', {
        filter,
        limit,
        offset: (page - 1) * limit,
      });
      const rawHits = result.hits as Record<string, unknown>[];
      const hits = dedupeProductHitsById(rawHits);
      return {
        hits,
        total: result.estimatedTotalHits ?? hits.length,
        page,
        limit,
      };
    } catch (e) {
      this.log.warn(
        `Meilisearch недоступен, поиск через БД: ${e instanceof Error ? e.message : String(e)}`,
      );
      return this.searchProductsViaPrisma(params, page, limit);
    }
  }

  private async searchProductsViaPrisma(
    params: {
      q?: string;
      categoryId?: string;
      brandId?: string;
    },
    page: number,
    limit: number,
  ) {
    const and: Prisma.ProductWhereInput[] = [{ isActive: true }];
    if (params.categoryId) {
      and.push({
        OR: [
          { categoryId: params.categoryId },
          { productCategories: { some: { categoryId: params.categoryId } } },
        ],
      });
    }
    if (params.brandId) and.push({ brandId: params.brandId });
    const q = params.q?.trim();
    if (q) {
      and.push({
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { slug: { contains: q, mode: 'insensitive' } },
          { shortDescription: { contains: q, mode: 'insensitive' } },
        ],
      });
    }
    const where: Prisma.ProductWhereInput = { AND: and };
    const skip = (page - 1) * limit;
    const [rows, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        skip,
        take: limit,
        orderBy: { updatedAt: 'desc' },
        select: {
          id: true,
          slug: true,
          name: true,
          shortDescription: true,
          categoryId: true,
          brandId: true,
          isActive: true,
          updatedAt: true,
          price: true,
          category: { select: { name: true } },
          productCategories: { select: { categoryId: true } },
          brand: { select: { name: true } },
          images: {
            take: 6,
            orderBy: { sortOrder: 'asc' },
            select: { url: true },
          },
        },
      }),
      this.prisma.product.count({ where }),
    ]);
    const hits = dedupeProductHitsById(
      rows.map((r) =>
        buildProductSearchDocument({
          ...r,
          categoryIds: collectProductCategoryIds(r.categoryId, r.productCategories),
        }) as Record<string, unknown>,
      ),
    );
    return { hits, total, page, limit };
  }

  /** Парсинг `Brand.galleryImageUrls` (JSON-массив строк, до 3). */
  private parseBrandGalleryUrls(raw: unknown): string[] {
    const out: string[] = [];
    if (Array.isArray(raw)) {
      for (const x of raw) {
        if (typeof x === 'string' && x.trim()) out.push(x.trim());
        if (out.length >= 3) break;
      }
    }
    return out;
  }

  /**
   * Три URL для блока галереи на главной: только доп. изображения из `galleryImageUrls`
   * (без обложки `coverImageUrl`); недостающие — из картинок активных товаров бренда.
   */
  private async buildBrandHomeGalleryTriples(
    brands: Array<{ id: string; galleryImageUrls: unknown; coverImageUrl: string | null }>,
  ): Promise<Map<string, [string, string, string]>> {
    const brandIds = brands.map((b) => b.id);
    if (!brandIds.length) return new Map();

    const products = await this.prisma.product.findMany({
      where: { brandId: { in: brandIds }, isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { updatedAt: 'desc' }],
      select: {
        brandId: true,
        images: {
          orderBy: { sortOrder: 'asc' },
          take: 12,
          select: { url: true },
        },
      },
    });

    const poolByBrand = new Map<string, string[]>();
    for (const p of products) {
      if (!p.brandId) continue;
      const arr = poolByBrand.get(p.brandId) ?? [];
      for (const im of p.images) {
        const u = im.url?.trim();
        if (u) arr.push(u);
      }
      poolByBrand.set(p.brandId, arr);
    }

    const out = new Map<string, [string, string, string]>();
    for (const b of brands) {
      const cover = b.coverImageUrl?.trim() || null;
      const rawExtras = this.parseBrandGalleryUrls(b.galleryImageUrls);
      const extras: string[] = [];
      const seen = new Set<string>();
      for (const u of rawExtras) {
        const t = u.trim();
        if (!t || t === cover || seen.has(t)) continue;
        seen.add(t);
        extras.push(t);
        if (extras.length >= 3) break;
      }

      const urls: string[] = [...extras];
      const pool = poolByBrand.get(b.id) ?? [];
      for (const u of pool) {
        if (urls.length >= 3) break;
        const t = u.trim();
        if (!t || t === cover || seen.has(t)) continue;
        seen.add(t);
        urls.push(t);
      }

      while (urls.length < 3 && urls.length > 0) {
        urls.push(urls[urls.length - 1]!);
      }
      while (urls.length < 3) {
        urls.push('');
      }

      out.set(b.id, [urls[0]!, urls[1]!, urls[2]!]);
    }
    return out;
  }

  /**
   * Публичная коллекция брендов по slug (только `kind: BRAND`, активная).
   * Для главной «лучшие бренды» и т.п.
   */
  async getCuratedBrandCollectionBySlug(slug: string) {
    const col = await this.prisma.curatedCollection.findFirst({
      where: { slug, isActive: true, kind: CuratedCollectionKind.BRAND },
      include: {
        brandItems: {
          orderBy: { sortOrder: 'asc' },
          include: { brand: true },
        },
      },
    });
    if (!col) return null;

    const active = col.brandItems.filter((bi) => bi.brand.isActive).map((bi) => bi.brand);
    const triples = await this.buildBrandHomeGalleryTriples(
      active.map((b) => ({
        id: b.id,
        galleryImageUrls: b.galleryImageUrls,
        coverImageUrl: b.coverImageUrl,
      })),
    );

    const brands = active.map((b) => {
      const logo = b.logoUrl?.trim() || null;
      const t = triples.get(b.id) ?? ['', '', ''];
      return {
        slug: b.slug,
        name: b.name,
        logoUrl: logo,
        shortDescription: b.shortDescription?.trim() || null,
        galleryMain: t[0] || null,
        gallerySide1: t[1] || null,
        gallerySide2: t[2] || null,
      };
    });

    return {
      slug: col.slug,
      name: col.name,
      kind: 'BRAND' as const,
      brands,
    };
  }

  /**
   * Товары из тех же кураторских наборов, что и данный товар (без самого товара), без дублей.
   */
  async getProductSiblingsFromCuratedSets(productSlug: string) {
    const p = await this.prisma.product.findUnique({
      where: { slug: productSlug, isActive: true },
      select: { id: true },
    });
    if (!p) return { items: [] as PublicSetSiblingProduct[] };

    const memberships = await this.prisma.curatedProductSetItem.findMany({
      where: { productId: p.id, set: { isActive: true } },
      select: { setId: true },
    });
    const setIds = [...new Set(memberships.map((m) => m.setId))];
    if (!setIds.length) return { items: [] as PublicSetSiblingProduct[] };

    const rows = await this.prisma.curatedProductSetItem.findMany({
      where: {
        setId: { in: setIds },
        productId: { not: p.id },
        product: { isActive: true },
      },
      orderBy: [{ sortOrder: 'asc' }],
      include: {
        product: {
          select: {
            id: true,
            slug: true,
            name: true,
            price: true,
            images: {
              take: 6,
              orderBy: { sortOrder: 'asc' },
              select: { url: true },
            },
          },
        },
      },
    });

    const seen = new Set<string>();
    const items: PublicSetSiblingProduct[] = [];
    for (const r of rows) {
      const pr = r.product;
      if (seen.has(pr.id)) continue;
      seen.add(pr.id);
      const imageUrls = pr.images.map((im) => im.url.trim()).filter(Boolean);
      items.push({
        id: pr.id,
        slug: pr.slug,
        name: pr.name,
        price: pr.price,
        thumbUrl: imageUrls[0] ?? null,
        imageUrls,
      });
    }
    return { items };
  }
}

export type PublicSetSiblingProduct = {
  id: string;
  slug: string;
  name: string;
  price: unknown;
  thumbUrl: string | null;
  imageUrls: string[];
};
