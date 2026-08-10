import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { CuratedCollectionKind, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MeilisearchService, PRODUCTS_INDEX } from '../../meilisearch/meilisearch.service';
import { ProductSearchIndexService } from '../../meilisearch/product-search-index.service';
import {
  buildProductSearchDocument,
  collectProductCategoryIds,
  priceToNumber,
} from '../../meilisearch/product-search-doc';
import { resolveEffectiveVariantImages } from './variant-effective-gallery';
import { enrichProductsWithLikedByMe } from '../../common/utils/enrich-products-liked-by-me';
import {
  collectCategoryAndDescendantIds,
  meilisearchCategoryScopeFilter,
} from './category-scope';
import {
  meilisearchOrEquals,
  parseCsvIds,
  parseFlagParam,
  parseSizeBound,
} from './catalog-product-filters';
import {
  collectBrandMaterialIdsFromElements,
  collectSizeLabelsFromModifications,
} from '../../meilisearch/product-search-doc';
import { CatalogTierPricingService } from './catalog-tier-pricing.service';

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

/** Фасеты публичного поиска / filter-options. */
type CatalogSearchFacets = {
  brandIds: string[];
  materialIds: string[];
  widthFrom?: number;
  widthTo?: number;
  heightFrom?: number;
  heightTo?: number;
  hasCase: boolean;
  hasModel3d: boolean;
  hasDrawing: boolean;
};

const EMPTY_SEARCH_FACETS: CatalogSearchFacets = {
  brandIds: [],
  materialIds: [],
  hasCase: false,
  hasModel3d: false,
  hasDrawing: false,
};

/** Сортировка публичного `GET /catalog/products/search`. */
export type ProductSearchSort = 'popular' | 'price_asc' | 'price_desc' | 'newest';

const PRODUCT_SEARCH_SORTS = new Set<ProductSearchSort>([
  'popular',
  'price_asc',
  'price_desc',
  'newest',
]);

export function parseProductSearchSort(raw?: string | ProductSearchSort): ProductSearchSort {
  const v = (typeof raw === 'string' ? raw.trim() : raw) as ProductSearchSort | undefined;
  return v && PRODUCT_SEARCH_SORTS.has(v) ? v : 'popular';
}

/** Границы цены для search (min цена товара / поле `price` в Meili). */
function parsePriceBound(raw: number | string | undefined): number | undefined {
  if (raw == null || raw === '') return undefined;
  const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!Number.isFinite(n) || n < 0) return undefined;
  return n;
}

/** Meilisearch `sort` (поля уже в индексе: likesDisplayCount, price, updatedAt). */
function meilisearchSortFor(sort: ProductSearchSort): string[] {
  switch (sort) {
    case 'price_asc':
      return ['price:asc', 'updatedAt:desc'];
    case 'price_desc':
      return ['price:desc', 'updatedAt:desc'];
    case 'newest':
      return ['updatedAt:desc'];
    case 'popular':
    default:
      return ['likesDisplayCount:desc', 'updatedAt:desc'];
  }
}

/** Prisma orderBy для сортировок без агрегации по вариантам. */
function prismaOrderByFor(sort: ProductSearchSort): Prisma.ProductOrderByWithRelationInput[] {
  switch (sort) {
    case 'newest':
      return [{ updatedAt: 'desc' }, { id: 'desc' }];
    case 'popular':
    default:
      // Близко к likesDisplayCount = likesUserCount + likesAdminBoost (без expression-orderBy).
      return [{ likesUserCount: 'desc' }, { likesAdminBoost: 'desc' }, { updatedAt: 'desc' }];
  }
}

/** Публичное дерево каталога: корни и рекурсивные активные потомки (без дублирования узлов между ветками). */
export type PublicCategoryTreeChild = {
  id: string;
  slug: string;
  name: string;
  sortOrder: number;
  backgroundImageUrl: string | null;
  productCount?: number;
  children?: PublicCategoryTreeChild[];
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
    private productSearchIndex: ProductSearchIndexService,
    private tierPricing: CatalogTierPricingService,
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

  /** Контекстные теги витрины (офис, HoReCa, …) для навигации. */
  async getCatalogTagsNav() {
    const rows = await this.prisma.catalogTag.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: {
        slug: true,
        name: true,
        sortOrder: true,
        coverImageUrl: true,
        _count: { select: { products: { where: { product: { isActive: true } } } } },
        products: {
          take: 1,
          orderBy: { product: { updatedAt: 'desc' } },
          select: {
            product: {
              select: {
                images: { take: 1, orderBy: { sortOrder: 'asc' }, select: { url: true } },
              },
            },
          },
        },
      },
    });
    return {
      items: rows.map((r) => ({
        slug: r.slug,
        name: r.name,
        sortOrder: r.sortOrder,
        productCount: r._count.products,
        coverImageUrl:
          r.coverImageUrl?.trim() ||
          r.products[0]?.product?.images[0]?.url ||
          null,
      })),
    };
  }

  /** Контекстный тег по slug для страницы `/catalog?tag=`. */
  async getCatalogTagBySlug(tagSlug: string) {
    const slug = tagSlug.trim();
    const row = await this.prisma.catalogTag.findUnique({
      where: { slug },
      select: {
        slug: true,
        name: true,
        sortOrder: true,
        coverImageUrl: true,
        products: {
          take: 1,
          orderBy: { product: { updatedAt: 'desc' } },
          select: {
            product: {
              select: {
                images: { take: 1, orderBy: { sortOrder: 'asc' }, select: { url: true } },
              },
            },
          },
        },
      },
    });
    if (!row) throw new NotFoundException('Tag not found');
    return {
      slug: row.slug,
      name: row.name,
      sortOrder: row.sortOrder,
      coverImageUrl:
        row.coverImageUrl?.trim() ||
        row.products[0]?.product?.images[0]?.url ||
        null,
    };
  }

  /** Категории для полосы на главной при выбранном контекстном теге. */
  async getTagStripCategories(tagSlug: string) {
    const slug = tagSlug.trim();
    const tag = await this.prisma.catalogTag.findUnique({ where: { slug } });
    if (!tag) throw new NotFoundException('Tag not found');

    const categories = await this.prisma.category.findMany({
      where: { isActive: true },
      select: {
        id: true,
        parentId: true,
        slug: true,
        name: true,
        sortOrder: true,
        backgroundImageUrl: true,
      },
    });
    const byId = new Map(categories.map((c) => [c.id, c]));

    const rootCategoryFor = (categoryId: string) => {
      let cur = byId.get(categoryId);
      if (!cur) return null;
      while (cur.parentId !== null) {
        const parent = byId.get(cur.parentId);
        if (!parent) return null;
        cur = parent;
      }
      return cur;
    };

    const links = await this.prisma.productCatalogTag.findMany({
      where: { tagId: tag.id, product: { isActive: true } },
      select: {
        product: {
          select: {
            categoryId: true,
            productCategories: { select: { categoryId: true } },
          },
        },
      },
    });

    const stripIds = new Set<string>();
    for (const link of links) {
      const ids = collectProductCategoryIds(
        link.product.categoryId,
        link.product.productCategories,
      );
      for (const cid of ids) {
        const node = rootCategoryFor(cid);
        if (node) stripIds.add(node.id);
      }
    }

    const mapRow = (c: (typeof categories)[number]) => ({
      slug: c.slug,
      name: c.name,
      sortOrder: c.sortOrder,
      backgroundImageUrl: c.backgroundImageUrl,
    });

    let rows = categories
      .filter((c) => c.parentId === null && stripIds.has(c.id))
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'ru'));

    if (!rows.length) {
      rows = categories
        .filter((c) => c.parentId === null)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'ru'));
    }

    return { items: rows.map(mapRow) };
  }

  /**
   * Дерево для витрины: активные корни и полное поддерево активных потомков (произвольная глубина).
   */
  async getCategoryTree(): Promise<{ roots: PublicCategoryTreeRoot[] }> {
    const rootsRows = await this.prisma.category.findMany({
      where: { isActive: true, parentId: null },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        slug: true,
        name: true,
        sortOrder: true,
        backgroundImageUrl: true,
        _count: {
          select: {
            primaryProducts: { where: { isActive: true } },
            productCategories: { where: { product: { isActive: true } } },
          },
        },
      },
    });
    const roots: PublicCategoryTreeRoot[] = [];
    for (const r of rootsRows) {
      const { _count, ...rest } = r;
      roots.push({
        ...rest,
        productCount: _count.primaryProducts + _count.productCategories,
        children: await this.buildPublicCategorySubtree(r.id),
      });
    }
    return { roots };
  }

  private async buildPublicCategorySubtree(parentId: string): Promise<PublicCategoryTreeChild[]> {
    const rows = await this.prisma.category.findMany({
      where: { parentId, isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        slug: true,
        name: true,
        sortOrder: true,
        backgroundImageUrl: true,
      },
    });
    const out: PublicCategoryTreeChild[] = [];
    for (const row of rows) {
      const nested = await this.buildPublicCategorySubtree(row.id);
      out.push({
        ...row,
        ...(nested.length > 0 ? { children: nested } : {}),
      });
    }
    return out;
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
    variantQuery?: {
      variantSlug?: string;
      variantId?: string;
      sizeParam?: string;
      userId?: string;
    },
  ) {
    void variantQuery;
    const userId = variantQuery?.userId;
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
            priceMode: true,
            costPriceCny: true,
            weightKg: true,
            volumeLiters: true,
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
            variantProductImages: {
              orderBy: { sortOrder: 'asc' },
              include: {
                productImage: { select: { url: true, alt: true } },
              },
            },
          },
        },
      },
    });
    if (!row) return null;

    const shared = row.images.map((i) => ({ url: i.url, alt: i.alt }));

    const productCategories = row.productCategories.map((pc) => ({ categoryId: pc.categoryId }));
    const displayPrices = await this.tierPricing.resolveVariantDisplayPricesForUser(
      userId,
      row.categoryId,
      productCategories,
      row.variants,
    );
    const prices = displayPrices.filter((n) => n > 0);
    const priceMin = prices.length ? Math.min(...prices) : 0;
    const priceMax = prices.length ? Math.max(...prices) : 0;

    const variants = row.variants.map((v, i) => ({
      id: v.id,
      variantSlug: v.variantSlug,
      variantLabel: v.variantLabel,
      modificationId: v.modificationId,
      price: displayPrices[i] > 0 ? displayPrices[i] : v.price,
      sku: v.sku,
      isDefault: v.isDefault,
      model3dUrl: v.model3dUrl,
      drawingUrl: v.drawingUrl,
      selections: v.elementSelections.map((s) => ({
        productElementId: s.productElementId,
        brandMaterialColorId: s.brandMaterialColorId,
      })),
      images: resolveEffectiveVariantImages({
        sharedProductImages: shared,
        variantProductImagesFromJunction: v.variantProductImages,
      }),
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

    const likesDisplayCount = Math.max(0, row.likesUserCount + row.likesAdminBoost);
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      price: null,
      priceMin,
      priceMax,
      casesLinkedCount: row.casesLinkedCount,
      likesDisplayCount,
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

  /** Категория + все потомки — товары подкатегорий видны в родительской выдаче. */
  private async categoryScopeIds(categoryId: string): Promise<string[]> {
    const trimmed = categoryId.trim();
    if (!trimmed) return [];
    const rows = await this.prisma.category.findMany({
      where: { isActive: true },
      select: { id: true, parentId: true },
    });
    return collectCategoryAndDescendantIds(trimmed, rows);
  }

  async searchProducts(params: {
    q?: string;
    categoryId?: string;
    /** Один id или CSV (`id1,id2`). */
    brandId?: string;
    tagSlug?: string;
    page?: number;
    limit?: number;
    userId?: string;
    sort?: ProductSearchSort | string;
    priceFrom?: number | string;
    priceTo?: number | string;
    /** Ширина / высота варианта, мм. */
    widthFrom?: number | string;
    widthTo?: number | string;
    heightFrom?: number | string;
    heightTo?: number | string;
    /** Материалы бренда CSV. */
    materialId?: string;
    hasCase?: string | boolean;
    has3d?: string | boolean;
    hasDrawing?: string | boolean;
  }) {
    const page = params.page ?? 1;
    const limit = Math.min(params.limit ?? 20, 100);
    const sort = parseProductSearchSort(params.sort);
    let priceFrom = parsePriceBound(params.priceFrom);
    let priceTo = parsePriceBound(params.priceTo);
    if (priceFrom != null && priceTo != null && priceFrom > priceTo) {
      const tmp = priceFrom;
      priceFrom = priceTo;
      priceTo = tmp;
    }
    let widthFrom = parseSizeBound(params.widthFrom);
    let widthTo = parseSizeBound(params.widthTo);
    if (widthFrom != null && widthTo != null && widthFrom > widthTo) {
      const tmp = widthFrom;
      widthFrom = widthTo;
      widthTo = tmp;
    }
    let heightFrom = parseSizeBound(params.heightFrom);
    let heightTo = parseSizeBound(params.heightTo);
    if (heightFrom != null && heightTo != null && heightFrom > heightTo) {
      const tmp = heightFrom;
      heightFrom = heightTo;
      heightTo = tmp;
    }
    const brandIds = parseCsvIds(params.brandId);
    const materialIds = parseCsvIds(params.materialId);
    const hasCase =
      typeof params.hasCase === 'boolean' ? params.hasCase : parseFlagParam(String(params.hasCase ?? ''));
    const hasModel3d =
      typeof params.has3d === 'boolean' ? params.has3d : parseFlagParam(String(params.has3d ?? ''));
    const hasDrawing =
      typeof params.hasDrawing === 'boolean'
        ? params.hasDrawing
        : parseFlagParam(String(params.hasDrawing ?? ''));

    const categoryScope = params.categoryId?.trim()
      ? await this.categoryScopeIds(params.categoryId)
      : null;

    const hasDimensionFilter =
      widthFrom != null || widthTo != null || heightFrom != null || heightTo != null;

    const facetFilters = {
      brandIds,
      materialIds,
      widthFrom,
      widthTo,
      heightFrom,
      heightTo,
      hasCase,
      hasModel3d,
      hasDrawing,
    };

    let tagIds: string[] = [];
    if (params.tagSlug?.trim()) {
      const slugs = [
        ...new Set(
          params.tagSlug
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
        ),
      ];
      if (slugs.length) {
        const tags = await this.prisma.catalogTag.findMany({
          where: { slug: { in: slugs } },
          select: { id: true },
        });
        if (!tags.length) {
          return { hits: [], total: 0, page, limit };
        }
        tagIds = tags.map((t) => t.id);
      }
    }

    /** Габариты пока только в Prisma (точные widthMm/heightMm вариантов). */
    if (!this.meilisearch.isEnabled() || hasDimensionFilter) {
      return this.searchProductsViaPrisma(
        params,
        page,
        limit,
        params.userId,
        categoryScope,
        tagIds,
        sort,
        priceFrom,
        priceTo,
        facetFilters,
      );
    }

    try {
      const index = this.meilisearch.getIndex(PRODUCTS_INDEX);
      await this.productSearchIndex.ensureIndexSettings();
      const filters: string[] = ['isActive = true'];
      if (categoryScope?.length) {
        const catFilter = meilisearchCategoryScopeFilter(categoryScope);
        if (catFilter) filters.push(catFilter);
      }
      const brandFilter = meilisearchOrEquals('brandId', brandIds);
      if (brandFilter) filters.push(brandFilter);
      if (tagIds.length === 1) {
        filters.push(`catalogTagIds = "${tagIds[0]}"`);
      } else if (tagIds.length > 1) {
        filters.push(`(${tagIds.map((id) => `catalogTagIds = "${id}"`).join(' OR ')})`);
      }
      if (priceFrom != null) filters.push(`price >= ${priceFrom}`);
      if (priceTo != null) filters.push(`price <= ${priceTo}`);
      const materialFilter = meilisearchOrEquals('brandMaterialIds', materialIds);
      if (materialFilter) filters.push(materialFilter);
      if (hasCase) filters.push('casesLinkedCount > 0');
      if (hasModel3d) filters.push('hasModel3d = true');
      if (hasDrawing) filters.push('hasDrawing = true');
      const filter = filters.join(' AND ');
      const result = await index.search(params.q ?? '', {
        filter,
        limit,
        offset: (page - 1) * limit,
        sort: meilisearchSortFor(sort),
      });
      const rawHits = result.hits as Record<string, unknown>[];
      const deduped = dedupeProductHitsById(rawHits).filter(
        (h): h is Record<string, unknown> & { id: string } => typeof h.id === 'string' && !!h.id,
      );
      const liked = await enrichProductsWithLikedByMe(this.prisma, deduped, params.userId);
      const hits = await this.tierPricing.enrichSearchHits(liked, params.userId);
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
      return this.searchProductsViaPrisma(
        params,
        page,
        limit,
        params.userId,
        categoryScope,
        tagIds,
        sort,
        priceFrom,
        priceTo,
        facetFilters,
      );
    }
  }

  /** Опции панели «Фильтры»: бренды / материалы с учётом уже выбранных фильтров (faceted). */
  async getProductFilterOptions(params: {
    categoryId?: string;
    brandId?: string;
    tagSlug?: string;
    priceFrom?: number | string;
    priceTo?: number | string;
    widthFrom?: number | string;
    widthTo?: number | string;
    heightFrom?: number | string;
    heightTo?: number | string;
    materialId?: string;
    hasCase?: string | boolean;
    has3d?: string | boolean;
    hasDrawing?: string | boolean;
  }) {
    let priceFrom = parsePriceBound(params.priceFrom);
    let priceTo = parsePriceBound(params.priceTo);
    if (priceFrom != null && priceTo != null && priceFrom > priceTo) {
      const tmp = priceFrom;
      priceFrom = priceTo;
      priceTo = tmp;
    }
    let widthFrom = parseSizeBound(params.widthFrom);
    let widthTo = parseSizeBound(params.widthTo);
    if (widthFrom != null && widthTo != null && widthFrom > widthTo) {
      const tmp = widthFrom;
      widthFrom = widthTo;
      widthTo = tmp;
    }
    let heightFrom = parseSizeBound(params.heightFrom);
    let heightTo = parseSizeBound(params.heightTo);
    if (heightFrom != null && heightTo != null && heightFrom > heightTo) {
      const tmp = heightFrom;
      heightFrom = heightTo;
      heightTo = tmp;
    }
    const brandIds = parseCsvIds(params.brandId);
    const materialIds = parseCsvIds(params.materialId);
    const hasCase =
      typeof params.hasCase === 'boolean' ? params.hasCase : parseFlagParam(String(params.hasCase ?? ''));
    const hasModel3d =
      typeof params.has3d === 'boolean' ? params.has3d : parseFlagParam(String(params.has3d ?? ''));
    const hasDrawing =
      typeof params.hasDrawing === 'boolean'
        ? params.hasDrawing
        : parseFlagParam(String(params.hasDrawing ?? ''));

    const facets: CatalogSearchFacets = {
      brandIds,
      materialIds,
      widthFrom,
      widthTo,
      heightFrom,
      heightTo,
      hasCase,
      hasModel3d,
      hasDrawing,
    };

    const categoryScope = params.categoryId?.trim()
      ? await this.categoryScopeIds(params.categoryId)
      : null;

    let tagIds: string[] = [];
    if (params.tagSlug?.trim()) {
      const slugs = [
        ...new Set(
          params.tagSlug
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
        ),
      ];
      if (slugs.length) {
        const tags = await this.prisma.catalogTag.findMany({
          where: { slug: { in: slugs } },
          select: { id: true },
        });
        tagIds = tags.map((t) => t.id);
        if (!tagIds.length) {
          return { materials: [], brands: [] };
        }
      }
    }

    const baseOpts = {
      categoryScope,
      tagIds,
      priceFrom,
      priceTo,
      facets,
    };

    const brandWhere = this.buildProductFilterWhere({
      ...baseOpts,
      omitBrandFilter: true,
    });
    const materialWhere = this.buildProductFilterWhere({
      ...baseOpts,
      omitMaterialFilter: true,
    });

    const [brandRows, materialRows] = await Promise.all([
      this.prisma.product.findMany({
        where: brandWhere,
        select: {
          brandId: true,
          brand: { select: { id: true, name: true } },
        },
      }),
      this.prisma.product.findMany({
        where: materialWhere,
        select: {
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
      }),
    ]);

    const brandsMap = new Map<string, string>();
    const materialsMap = new Map<string, string>();

    for (const p of brandRows) {
      if (p.brand?.id) brandsMap.set(p.brand.id, p.brand.name);
    }
    for (const p of materialRows) {
      for (const el of p.elements) {
        for (const a of el.availabilities) {
          const m = a.brandMaterialColor.brandMaterial;
          if (m?.id) materialsMap.set(m.id, m.name);
        }
      }
    }

    /** Выбранные значения остаются в списке, даже если после других фильтров hit=0. */
    const missingBrandIds = brandIds.filter((id) => !brandsMap.has(id));
    if (missingBrandIds.length) {
      const extra = await this.prisma.brand.findMany({
        where: { id: { in: missingBrandIds } },
        select: { id: true, name: true },
      });
      for (const b of extra) brandsMap.set(b.id, b.name);
    }
    const missingMaterialIds = materialIds.filter((id) => !materialsMap.has(id));
    if (missingMaterialIds.length) {
      const extra = await this.prisma.brandMaterial.findMany({
        where: { id: { in: missingMaterialIds } },
        select: { id: true, name: true },
      });
      for (const m of extra) materialsMap.set(m.id, m.name);
    }

    const materials = [...materialsMap.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    const brands = [...brandsMap.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'));

    return { materials, brands };
  }

  /**
   * Общий WHERE витрины (категория / зона / цена / габариты / флаги / бренд / материал).
   * Для faceted options можно опустить собственный фильтр измерения.
   */
  private buildProductFilterWhere(opts: {
    categoryScope?: string[] | null;
    tagIds?: string[] | null;
    q?: string;
    priceFrom?: number;
    priceTo?: number;
    facets: CatalogSearchFacets;
    omitBrandFilter?: boolean;
    omitMaterialFilter?: boolean;
  }): Prisma.ProductWhereInput {
    const facets = opts.facets ?? EMPTY_SEARCH_FACETS;
    const and: Prisma.ProductWhereInput[] = [{ isActive: true }];
    const scope = opts.categoryScope;
    if (scope?.length) {
      and.push({
        OR: [
          { categoryId: { in: scope } },
          { productCategories: { some: { categoryId: { in: scope } } } },
        ],
      });
    }
    if (!opts.omitBrandFilter) {
      if (facets.brandIds.length === 1) {
        and.push({ brandId: facets.brandIds[0] });
      } else if (facets.brandIds.length > 1) {
        and.push({ brandId: { in: facets.brandIds } });
      }
    }
    const tagIds = opts.tagIds;
    if (tagIds?.length === 1) {
      and.push({ catalogTags: { some: { tagId: tagIds[0] } } });
    } else if (tagIds && tagIds.length > 1) {
      and.push({
        OR: tagIds.map((tagId) => ({ catalogTags: { some: { tagId } } })),
      });
    }
    const q = opts.q?.trim();
    if (q) {
      and.push({
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { slug: { contains: q, mode: 'insensitive' } },
          { shortDescription: { contains: q, mode: 'insensitive' } },
        ],
      });
    }
    if (opts.priceFrom != null) {
      and.push({
        variants: {
          some: { isActive: true, price: { gte: opts.priceFrom } },
        },
      });
      and.push({
        NOT: {
          variants: {
            some: {
              isActive: true,
              price: { gt: 0, lt: opts.priceFrom },
            },
          },
        },
      });
    }
    if (opts.priceTo != null) {
      and.push({
        variants: {
          some: { isActive: true, price: { gt: 0, lte: opts.priceTo } },
        },
      });
    }
    if (
      facets.widthFrom != null ||
      facets.widthTo != null ||
      facets.heightFrom != null ||
      facets.heightTo != null
    ) {
      const variantSome: Prisma.ProductVariantWhereInput = { isActive: true };
      if (facets.widthFrom != null || facets.widthTo != null) {
        const widthMm: Prisma.IntNullableFilter = { not: null };
        if (facets.widthFrom != null) widthMm.gte = facets.widthFrom;
        if (facets.widthTo != null) widthMm.lte = facets.widthTo;
        variantSome.widthMm = widthMm;
      }
      if (facets.heightFrom != null || facets.heightTo != null) {
        const heightMm: Prisma.IntNullableFilter = { not: null };
        if (facets.heightFrom != null) heightMm.gte = facets.heightFrom;
        if (facets.heightTo != null) heightMm.lte = facets.heightTo;
        variantSome.heightMm = heightMm;
      }
      and.push({ variants: { some: variantSome } });
    }
    if (!opts.omitMaterialFilter && facets.materialIds.length) {
      and.push({
        elements: {
          some: {
            availabilities: {
              some: {
                brandMaterialColor: { brandMaterialId: { in: facets.materialIds } },
              },
            },
          },
        },
      });
    }
    if (facets.hasCase) {
      and.push({ casesLinkedCount: { gt: 0 } });
    }
    if (facets.hasModel3d) {
      and.push({
        variants: { some: { isActive: true, model3dUrl: { not: null } } },
      });
    }
    if (facets.hasDrawing) {
      and.push({
        variants: { some: { isActive: true, drawingUrl: { not: null } } },
      });
    }
    return {
      AND: [...and, { variants: { some: { isActive: true } } }],
    };
  }

  private async searchProductsViaPrisma(
    params: {
      q?: string;
      categoryId?: string;
      brandId?: string;
    },
    page: number,
    limit: number,
    userId?: string,
    categoryScope?: string[] | null,
    tagIds?: string[] | null,
    sort: ProductSearchSort = 'popular',
    priceFrom?: number,
    priceTo?: number,
    facets: CatalogSearchFacets = EMPTY_SEARCH_FACETS,
  ) {
    const productWhere = this.buildProductFilterWhere({
      categoryScope:
        categoryScope ??
        (params.categoryId?.trim() ? await this.categoryScopeIds(params.categoryId) : null),
      tagIds,
      q: params.q,
      priceFrom,
      priceTo,
      facets,
    });
    const skip = (page - 1) * limit;
    const needsInMemoryPriceSort = sort === 'price_asc' || sort === 'price_desc';

    const productSelect = {
      id: true,
      slug: true,
      name: true,
      shortDescription: true,
      categoryId: true,
      brandId: true,
      isActive: true,
      updatedAt: true,
      casesLinkedCount: true,
      qaMessageCountPublic: true,
      likesUserCount: true,
      likesAdminBoost: true,
      category: { select: { name: true } },
      productCategories: { select: { categoryId: true } },
      brand: { select: { name: true } },
      images: {
        take: 6,
        orderBy: { sortOrder: 'asc' as const },
        select: { url: true },
      },
      variants: {
        where: { isActive: true },
        select: { price: true, model3dUrl: true, drawingUrl: true },
      },
      modifications: { select: { name: true } },
      elements: {
        select: {
          availabilities: {
            select: {
              brandMaterialColor: { select: { brandMaterialId: true } },
            },
          },
        },
      },
    } satisfies Prisma.ProductSelect;

    const total = await this.prisma.product.count({ where: productWhere });

    let products: Prisma.ProductGetPayload<{ select: typeof productSelect }>[];
    if (needsInMemoryPriceSort) {
      // Fallback без Meili: цена только на вариантах — сортируем всю выборку, затем пагинируем.
      const all = await this.prisma.product.findMany({
        where: productWhere,
        select: productSelect,
      });
      const dir = sort === 'price_asc' ? 1 : -1;
      all.sort((a, b) => {
        const priceA = (() => {
          const prices = a.variants.map((v) => priceToNumber(v.price)).filter((n) => n > 0);
          return prices.length ? Math.min(...prices) : 0;
        })();
        const priceB = (() => {
          const prices = b.variants.map((v) => priceToNumber(v.price)).filter((n) => n > 0);
          return prices.length ? Math.min(...prices) : 0;
        })();
        if (priceA !== priceB) return (priceA - priceB) * dir;
        return b.updatedAt.getTime() - a.updatedAt.getTime();
      });
      products = all.slice(skip, skip + limit);
    } else {
      products = await this.prisma.product.findMany({
        where: productWhere,
        skip,
        take: limit,
        orderBy: prismaOrderByFor(sort),
        select: productSelect,
      });
    }
    const rawHits = dedupeProductHitsById(
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
          casesLinkedCount: p.casesLinkedCount,
          qaMessageCountPublic: p.qaMessageCountPublic,
          likesUserCount: p.likesUserCount,
          likesAdminBoost: p.likesAdminBoost,
          sizeLabels: collectSizeLabelsFromModifications(p.modifications),
          brandMaterialIds: collectBrandMaterialIdsFromElements(p.elements),
          hasModel3d: p.variants.some((v) => Boolean(v.model3dUrl?.trim())),
          hasDrawing: p.variants.some((v) => Boolean(v.drawingUrl?.trim())),
        }) as Record<string, unknown> & { id: string };
      }),
    );
    const liked = await enrichProductsWithLikedByMe(this.prisma, rawHits, userId);
    const hits = await this.tierPricing.enrichSearchHits(liked, userId);
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
      const lifestyle =
        b.backgroundImageUrl?.trim() ||
        b.coverImageUrl?.trim() ||
        t[0] ||
        null;
      const productPreview = b.productPreviewImageUrl?.trim() || null;
      return {
        slug: b.slug,
        name: b.name,
        logoUrl: logo,
        shortDescription: b.shortDescription?.trim() || null,
        productPreviewImageUrl: productPreview,
        lifestyleImageUrl: lifestyle,
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
   * Публичная коллекция товаров по slug (`kind: PRODUCT`, активная), порядок как в админке.
   */
  async getCuratedProductCollectionBySlug(slug: string, userId?: string) {
    const col = await this.prisma.curatedCollection.findFirst({
      where: { slug, isActive: true, kind: CuratedCollectionKind.PRODUCT },
      include: {
        productItems: {
          where: { product: { isActive: true } },
          orderBy: { sortOrder: 'asc' },
          include: {
            product: {
              include: {
                brand: { select: { id: true, name: true } },
                catalogTags: { select: { tag: { select: { slug: true, name: true } } } },
                images: { orderBy: { sortOrder: 'asc' }, take: 6 },
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
        },
      },
    });
    if (!col) return null;

    const products = col.productItems.map((pi) => {
      const p = pi.product;
      const dv = p.variants[0];
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
        brandId: p.brandId ?? p.brand?.id ?? null,
        brandName: p.brand?.name ?? null,
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

    const tierHits = products.map((p) => {
      const priceNum = p.price != null ? priceToNumber(p.price) : 0;
      return {
        id: p.id,
        price: priceNum,
        priceMin: priceNum,
        priceMax: priceNum,
        sortPrice: priceNum,
      };
    });
    const enrichedTierHits = await this.tierPricing.enrichSearchHits(tierHits, userId);
    const tierPriceByProductId = new Map(
      enrichedTierHits.map((h) => [h.id, h.price as number]),
    );
    const productsWithTier = products.map((p) => {
      const tierPrice = tierPriceByProductId.get(p.id);
      if (tierPrice == null || !Number.isFinite(tierPrice) || tierPrice <= 0) return p;
      return { ...p, price: tierPrice };
    });

    const productsWithLikes = await enrichProductsWithLikedByMe(this.prisma, productsWithTier, userId);

    return {
      slug: col.slug,
      name: col.name,
      kind: 'PRODUCT' as const,
      coverImageUrl: col.coverImageUrl,
      products: productsWithLikes,
    };
  }

  /**
   * Все активные товарные коллекции и наборы для витрины каталога (полный состав, без лимита).
   * Сначала коллекции (`kind: PRODUCT`), затем наборы — по `sortOrder`.
   */
  async listPublicCollectionsAndSets(userId?: string) {
    const productInclude = {
      images: { orderBy: { sortOrder: 'asc' as const }, take: 6 },
      variants: {
        where: { isActive: true },
        orderBy: [{ isDefault: 'desc' as const }, { sortOrder: 'asc' as const }],
        take: 1,
        select: {
          id: true,
          variantLabel: true,
          price: true,
          currency: true,
        },
      },
    };

    const [collections, sets] = await Promise.all([
      this.prisma.curatedCollection.findMany({
        where: {
          isActive: true,
          kind: CuratedCollectionKind.PRODUCT,
          /** Главная «Рекомендации» — не дублируем на вкладке каталога. */
          NOT: { slug: 'rekomendatsii' },
        },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        include: {
          productItems: {
            where: { product: { isActive: true } },
            orderBy: { sortOrder: 'asc' },
            include: { product: { include: productInclude } },
          },
        },
      }),
      this.prisma.curatedProductSet.findMany({
        where: { isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        include: {
          items: {
            where: { product: { isActive: true } },
            orderBy: { sortOrder: 'asc' },
            include: { product: { include: productInclude } },
          },
        },
      }),
    ]);

    type RawProduct = {
      id: string;
      slug: string;
      name: string;
      casesLinkedCount: number;
      qaMessageCountPublic: number;
      likesUserCount: number;
      likesAdminBoost: number;
      images: { url: string }[];
      variants: {
        id: string;
        variantLabel: string | null;
        price: Prisma.Decimal | number | null;
        currency: string;
      }[];
    };

    const mapProducts = (products: RawProduct[]) =>
      products.map((p) => {
        const dv = p.variants[0];
        const images = p.images.map((im, i) => ({ url: im.url, sortOrder: i }));
        return {
          id: p.id,
          slug: p.slug,
          name: p.name,
          displayName: dv?.variantLabel?.trim() || p.name,
          variantId: dv?.id ?? null,
          price: dv?.price ?? null,
          currency: dv?.currency ?? 'RUB',
          images,
          casesLinkedCount: p.casesLinkedCount,
          qaMessageCountPublic: p.qaMessageCountPublic,
          likesDisplayCount: Math.max(0, p.likesUserCount + p.likesAdminBoost),
        };
      });

    type SectionDraft = {
      kind: 'collection' | 'set';
      slug: string;
      name: string;
      products: ReturnType<typeof mapProducts>;
    };

    const drafts: SectionDraft[] = [];
    for (const col of collections) {
      const products = mapProducts(col.productItems.map((pi) => pi.product));
      if (!products.length) continue;
      drafts.push({ kind: 'collection', slug: col.slug, name: col.name, products });
    }
    for (const set of sets) {
      const products = mapProducts(set.items.map((it) => it.product));
      if (!products.length) continue;
      drafts.push({ kind: 'set', slug: set.slug, name: set.name, products });
    }

    const allProducts = drafts.flatMap((d) => d.products);
    if (!allProducts.length) return { items: [] as SectionDraft[] };

    const tierHits = allProducts.map((p) => {
      const priceNum = p.price != null ? priceToNumber(p.price) : 0;
      return {
        id: p.id,
        price: priceNum,
        priceMin: priceNum,
        priceMax: priceNum,
        sortPrice: priceNum,
      };
    });
    const enrichedTierHits = await this.tierPricing.enrichSearchHits(tierHits, userId);
    const tierPriceByProductId = new Map(
      enrichedTierHits.map((h) => [h.id, h.price as number]),
    );

    const withTiers = drafts.map((d) => ({
      ...d,
      products: d.products.map((p) => {
        const tierPrice = tierPriceByProductId.get(p.id);
        if (tierPrice == null || !Number.isFinite(tierPrice) || tierPrice <= 0) return p;
        return { ...p, price: tierPrice };
      }),
    }));

    const flatForLikes = withTiers.flatMap((d) => d.products);
    const likedFlat = await enrichProductsWithLikedByMe(this.prisma, flatForLikes, userId);
    const likedById = new Map(likedFlat.map((p) => [p.id, p]));

    return {
      items: withTiers.map((d) => ({
        kind: d.kind,
        slug: d.slug,
        name: d.name,
        products: d.products.map((p) => likedById.get(p.id) ?? p),
      })),
    };
  }

  /**
   * Товары из тех же кураторских наборов, что и данный товар (без самого товара), без дублей.
   */
  async getProductSiblingsFromCuratedSets(productSlug: string, userId?: string) {
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
            casesLinkedCount: true,
            qaMessageCountPublic: true,
            likesUserCount: true,
            likesAdminBoost: true,
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
        productId: pr.id,
        id: dv?.id ?? pr.id,
        slug: pr.slug,
        name: displayName,
        price: dv?.price != null ? priceToNumber(dv.price) : 0,
        thumbUrl: imageUrls[0] ?? null,
        imageUrls,
        casesLinkedCount: pr.casesLinkedCount,
        qaMessageCountPublic: pr.qaMessageCountPublic,
        likesDisplayCount: Math.max(0, pr.likesUserCount + pr.likesAdminBoost),
      });
    }

    const tierHits = items.map((it) => ({
      id: it.productId,
      price: it.price,
      priceMin: it.price,
      priceMax: it.price,
      sortPrice: it.price,
    }));
    const enrichedTierHits = await this.tierPricing.enrichSearchHits(tierHits, userId);
    const tierPriceByProductId = new Map(
      enrichedTierHits.map((h) => [h.id, h.price as number]),
    );
    for (const it of items) {
      const tierPrice = tierPriceByProductId.get(it.productId);
      if (tierPrice != null && Number.isFinite(tierPrice) && tierPrice > 0) {
        it.price = tierPrice;
      }
    }

    const likedRows = await enrichProductsWithLikedByMe(
      this.prisma,
      items.map((it) => ({ id: it.productId })),
      userId,
    );
    const likedByProductId = new Map(likedRows.map((r) => [r.id, r.likedByMe]));
    return {
      items: items.map((it) => ({
        ...it,
        likedByMe: likedByProductId.get(it.productId),
      })),
    };
  }

  /** Короткие данные товара по id (для ЛК кейсов, витрины дизайнера и т.п.). Только активные; неизвестные id — плейсхолдер. */
  async resolveProductSummariesByIds(idsInput: string[]) {
    const ids = [...new Set(idsInput.map((x) => String(x).trim()).filter(Boolean))].slice(0, 80);
    type Item = {
      id: string;
      slug: string;
      name: string;
      price: number;
      imageUrl: string | null;
      /** До 6 URL общей галереи товара (как на PDP). */
      imageUrls: string[];
      casesLinkedCount: number;
      qaMessageCountPublic: number;
      likesDisplayCount: number;
    };
    if (!ids.length) return { items: [] as Item[] };
    const rows = await this.prisma.product.findMany({
      where: { id: { in: ids }, isActive: true },
      select: {
        id: true,
        slug: true,
        name: true,
        casesLinkedCount: true,
        qaMessageCountPublic: true,
        likesUserCount: true,
        likesAdminBoost: true,
        images: {
          take: 6,
          orderBy: { sortOrder: 'asc' },
          select: { url: true, alt: true },
        },
        variants: {
          where: { isActive: true },
          orderBy: [{ isDefault: 'desc' }, { sortOrder: 'asc' }],
          take: 1,
          select: {
            variantLabel: true,
            price: true,
          },
        },
      },
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    const items: Item[] = ids.map((id) => {
      const r = byId.get(id);
      if (!r)
        return {
          id,
          slug: '',
          name: 'Товар',
          price: 0,
          imageUrl: null,
          imageUrls: [],
          casesLinkedCount: 0,
          qaMessageCountPublic: 0,
          likesDisplayCount: 0,
        };
      const dv = r.variants[0];
      /** Как на PDP (`product.images`) и в Meilisearch: общая галерея товара, не junction варианта. */
      const galleryUrls = r.images.map((im) => im.url.trim()).filter(Boolean);
      const displayName = dv?.variantLabel?.trim() || r.name;
      return {
        id: r.id,
        slug: r.slug,
        name: displayName,
        price: priceToNumber(dv?.price ?? 0),
        imageUrl: galleryUrls[0] ?? null,
        imageUrls: galleryUrls,
          casesLinkedCount: r.casesLinkedCount,
          qaMessageCountPublic: r.qaMessageCountPublic,
          likesDisplayCount: Math.max(0, r.likesUserCount + r.likesAdminBoost),
      };
    });
    return { items };
  }
}

export type PublicSetSiblingProduct = {
  productId: string;
  /** id варианта по умолчанию (для `?v=` на карточке) */
  id: string;
  slug: string;
  name: string;
  price: unknown;
  thumbUrl: string | null;
  imageUrls: string[];
  casesLinkedCount?: number;
  qaMessageCountPublic?: number;
  likesDisplayCount?: number;
  likedByMe?: boolean;
};
