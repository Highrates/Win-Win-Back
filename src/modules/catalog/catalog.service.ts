import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { CuratedCollectionKind, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MeilisearchService, PRODUCTS_INDEX } from '../../meilisearch/meilisearch.service';
import {
  buildProductSearchDocument,
  collectProductCategoryIds,
  priceToNumber,
} from '../../meilisearch/product-search-doc';
import { resolveEffectiveVariantImages } from './variant-effective-gallery';

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

  /**
   * Карточка товара для витрины.
   * Отдаёт общий набор кадров, диапазон цен активных вариантов, а также новую
   * структуру: модификации, пул элементов (с пулом «материал-цветов» из бренда)
   * и собранные варианты (modification + selections).
   */
  async getProductBySlug(
    slug: string,
    variantQuery?: { variantSlug?: string; variantId?: string; sizeParam?: string },
  ) {
    void variantQuery;
    const row = await this.prisma.product.findUnique({
      where: { slug, isActive: true },
      include: {
        category: { include: { parent: { select: { id: true, slug: true, name: true } } } },
        productCategories: { include: { category: true } },
        brand: true,
        images: { orderBy: { sortOrder: 'asc' } },
        modifications: {
          orderBy: { sortOrder: 'asc' },
          select: {
            id: true,
            name: true,
            modificationSlug: true,
            sortOrder: true,
          },
        },
        elements: {
          orderBy: { sortOrder: 'asc' },
          include: {
            availabilities: {
              orderBy: { sortOrder: 'asc' },
              include: {
                brandMaterialColor: {
                  select: {
                    id: true,
                    name: true,
                    imageUrl: true,
                    sortOrder: true,
                    brandMaterial: { select: { id: true, name: true, sortOrder: true } },
                  },
                },
              },
            },
          },
        },
        variants: {
          where: { isActive: true },
          orderBy: [{ isDefault: 'desc' }, { sortOrder: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            variantSlug: true,
            variantLabel: true,
            modificationId: true,
            price: true,
            sku: true,
            isDefault: true,
            model3dUrl: true,
            drawingUrl: true,
            elementSelections: {
              select: {
                productElementId: true,
                brandMaterialColorId: true,
              },
            },
          },
        },
      },
    });
    if (!row) return null;

    const shared = row.images.map((i) => ({ url: i.url, alt: i.alt }));

    const decimalPrice = (p: unknown): number => {
      if (p == null) return 0;
      if (typeof p === 'number' && Number.isFinite(p)) return p;
      const n = parseFloat(String(p));
      return Number.isFinite(n) ? n : 0;
    };

    const prices = row.variants.map((v) => decimalPrice(v.price)).filter((n) => n > 0);
    const priceMin = prices.length ? Math.min(...prices) : 0;
    const priceMax = prices.length ? Math.max(...prices) : 0;

    const variants = row.variants.map((v) => ({
      id: v.id,
      variantSlug: v.variantSlug,
      variantLabel: v.variantLabel,
      modificationId: v.modificationId,
      price: v.price,
      sku: v.sku,
      isDefault: v.isDefault,
      model3dUrl: v.model3dUrl,
      drawingUrl: v.drawingUrl,
      selections: v.elementSelections.map((s) => ({
        productElementId: s.productElementId,
        brandMaterialColorId: s.brandMaterialColorId,
      })),
      images: shared,
    }));

    const modifications = row.modifications.map((m) => ({
      id: m.id,
      name: m.name,
      modificationSlug: m.modificationSlug,
      sortOrder: m.sortOrder,
    }));

    const elements = row.elements.map((el) => ({
      id: el.id,
      name: el.name,
      sortOrder: el.sortOrder,
      availabilities: el.availabilities.map((a) => ({
        brandMaterialColorId: a.brandMaterialColor.id,
        brandMaterialId: a.brandMaterialColor.brandMaterial.id,
        materialName: a.brandMaterialColor.brandMaterial.name,
        materialSortOrder: a.brandMaterialColor.brandMaterial.sortOrder,
        colorName: a.brandMaterialColor.name,
        imageUrl: a.brandMaterialColor.imageUrl,
        sortOrder: a.sortOrder,
      })),
    }));

    const defaultVariant =
      row.variants.find((v) => v.isDefault) ?? row.variants[0] ?? null;
    const defaultModificationId =
      defaultVariant?.modificationId ?? row.modifications[0]?.id ?? null;

    return {
      slug: row.slug,
      name: row.name,
      price: null,
      priceMin,
      priceMax,
      shortDescription: row.shortDescription,
      description: row.description,
      seoTitle: row.seoTitle,
      seoDescription: row.seoDescription,
      deliveryText: row.deliveryText,
      technicalSpecs: row.technicalSpecs,
      additionalInfoHtml: row.additionalInfoHtml,
      specsJson: null,
      category: row.category,
      brand: row.brand,
      images: shared,
      modifications,
      elements,
      variants,
      defaultVariantId: defaultVariant?.id ?? null,
      defaultModificationId,
    };
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
    const productWhere: Prisma.ProductWhereInput = {
      AND: [...and, { variants: { some: { isActive: true } } }],
    };
    const skip = (page - 1) * limit;
    const [products, total] = await Promise.all([
      this.prisma.product.findMany({
        where: productWhere,
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
          category: { select: { name: true } },
          productCategories: { select: { categoryId: true } },
          brand: { select: { name: true } },
          images: {
            take: 6,
            orderBy: { sortOrder: 'asc' },
            select: { url: true },
          },
          variants: {
            where: { isActive: true },
            select: { price: true },
          },
        },
      }),
      this.prisma.product.count({ where: productWhere }),
    ]);
    const hits = dedupeProductHitsById(
      products.map((p) => {
        const prices = p.variants.map((v) => priceToNumber(v.price)).filter((n) => n > 0);
        const priceMin = prices.length ? Math.min(...prices) : 0;
        const priceMax = prices.length ? Math.max(...prices) : 0;
        const shared = p.images.map((i) => ({ url: i.url }));
        return buildProductSearchDocument({
          id: p.id,
          productId: p.id,
          slug: p.slug,
          name: p.name,
          shortDescription: p.shortDescription,
          categoryId: p.categoryId,
          categoryIds: collectProductCategoryIds(p.categoryId, p.productCategories),
          brandId: p.brandId,
          isActive: p.isActive,
          updatedAt: p.updatedAt,
          category: p.category,
          brand: p.brand,
          sortPrice: priceMin,
          priceMin,
          priceMax,
          images: shared,
        }) as Record<string, unknown>;
      }),
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
            images: {
              take: 6,
              orderBy: { sortOrder: 'asc' },
              select: { url: true, alt: true },
            },
            variants: {
              where: { isDefault: true, isActive: true },
              take: 1,
              select: {
                id: true,
                variantLabel: true,
                price: true,
                variantProductImages: {
                  take: 6,
                  orderBy: { sortOrder: 'asc' },
                  include: { productImage: { select: { url: true, alt: true } } },
                },
              },
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
      const dv = pr.variants[0];
      const shared = pr.images.map((im) => ({ url: im.url, alt: im.alt }));
      const effective = dv
        ? resolveEffectiveVariantImages({
            sharedProductImages: shared,
            variantProductImagesFromJunction: dv.variantProductImages,
          })
        : shared;
      const imageUrls = effective.map((im) => im.url.trim()).filter(Boolean);
      const displayName = dv?.variantLabel?.trim() || pr.name;
      items.push({
        id: dv?.id ?? pr.id,
        slug: pr.slug,
        name: displayName,
        price: dv?.price ?? 0,
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
