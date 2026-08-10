import { Injectable, Logger } from '@nestjs/common';
import type { Index } from 'meilisearch';
import { PrismaService } from '../prisma/prisma.service';
import { MeilisearchService, PRODUCTS_INDEX } from './meilisearch.service';
import {
  buildProductSearchDocument,
  collectBrandMaterialIdsFromElements,
  collectProductCategoryIds,
  collectSizeLabelsFromModifications,
  priceToNumber,
  type ProductVariantSearchIndexRow,
} from './product-search-doc';
import { applyProductIndexSearchSettings } from './product-index-settings';

const BATCH = 400;

const PRODUCT_INDEX_SELECT = {
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
  casesLinkedCount: true,
  qaMessageCountPublic: true,
  likesUserCount: true,
  likesAdminBoost: true,
  catalogTags: { select: { tagId: true } },
} as const;

function rowToSearchDocument(row: {
  id: string;
  slug: string;
  name: string;
  shortDescription: string | null;
  categoryId: string;
  brandId: string | null;
  isActive: boolean;
  updatedAt: Date;
  category: { name: string };
  productCategories: { categoryId: string }[];
  brand: { name: string } | null;
  images: { url: string }[];
  variants: { price: unknown; model3dUrl: string | null; drawingUrl: string | null }[];
  modifications: { name: string }[];
  elements: {
    availabilities: { brandMaterialColor: { brandMaterialId: string } }[];
  }[];
  casesLinkedCount: number;
  qaMessageCountPublic: number;
  likesUserCount: number;
  likesAdminBoost: number;
  catalogTags: { tagId: string }[];
}): Record<string, unknown> {
  const categoryIds = collectProductCategoryIds(row.categoryId, row.productCategories);
  const catalogTagIds = row.catalogTags.map((t) => t.tagId);
  const shared = row.images.map((i) => ({ url: i.url }));
  const prices = row.variants.map((v) => priceToNumber(v.price)).filter((n) => n > 0);
  const priceMin = prices.length ? Math.min(...prices) : 0;
  const priceMax = prices.length ? Math.max(...prices) : 0;
  const r: ProductVariantSearchIndexRow = {
    id: row.id,
    productId: row.id,
    slug: row.slug,
    name: row.name,
    shortDescription: row.shortDescription,
    categoryId: row.categoryId,
    categoryIds,
    brandId: row.brandId,
    isActive: row.isActive,
    updatedAt: row.updatedAt,
    category: row.category,
    brand: row.brand,
    sortPrice: priceMin,
    priceMin,
    priceMax,
    images: shared,
    casesLinkedCount: row.casesLinkedCount,
    qaMessageCountPublic: row.qaMessageCountPublic,
    likesUserCount: row.likesUserCount,
    likesAdminBoost: row.likesAdminBoost,
    catalogTagIds,
    sizeLabels: collectSizeLabelsFromModifications(row.modifications),
    brandMaterialIds: collectBrandMaterialIdsFromElements(row.elements),
    hasModel3d: row.variants.some((v) => Boolean(v.model3dUrl?.trim())),
    hasDrawing: row.variants.some((v) => Boolean(v.drawingUrl?.trim())),
  };
  return buildProductSearchDocument(r);
}

@Injectable()
export class ProductSearchIndexService {
  private readonly log = new Logger(ProductSearchIndexService.name);
  private settingsApplied = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly meili: MeilisearchService,
  ) {}

  /** После изменения товара переиндексируются все его варианты. */
  async syncProduct(productId: string): Promise<void> {
    try {
      await this.syncProductStrict(productId);
    } catch (e) {
      this.log.warn(
        `Meilisearch: не удалось проиндексировать товар ${productId}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  /** То же, что syncProduct, но пробрасывает ошибку (для retry-обёрток). */
  async syncProductStrict(productId: string): Promise<void> {
    if (!this.meili.isEnabled()) return;
    const index = this.meili.getIndex(PRODUCTS_INDEX);
    await this.ensureSettingsOnce(index);
    await index.deleteDocuments({ filter: `productId = "${productId}"` });

    const row = await this.prisma.product.findUnique({
      where: { id: productId },
      select: PRODUCT_INDEX_SELECT,
    });
    if (!row) return;

    await index.addDocuments([rowToSearchDocument(row)], { primaryKey: 'id' });
  }

  async removeProducts(productIds: string[]): Promise<void> {
    if (!this.meili.isEnabled() || productIds.length === 0) return;
    try {
      const index = this.meili.getIndex(PRODUCTS_INDEX);
      for (const pid of productIds) {
        await index.deleteDocuments({ filter: `productId = "${pid}"` });
      }
    } catch (e) {
      this.log.warn(
        `Meilisearch: не удалить документы: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  async reindexAllProducts(): Promise<{ indexed: number }> {
    if (!this.meili.isEnabled()) {
      this.log.log('Meilisearch выключен (MEILISEARCH_ENABLED), переиндексация пропущена');
      return { indexed: 0 };
    }
    const index = this.meili.getIndex(PRODUCTS_INDEX);
    await applyProductIndexSearchSettings(index);
    this.settingsApplied = true;
    await index.deleteAllDocuments();

    const rows = await this.prisma.product.findMany({
      select: PRODUCT_INDEX_SELECT,
    });

    const flat = rows.map((row) => rowToSearchDocument(row));

    let indexed = 0;
    for (let i = 0; i < flat.length; i += BATCH) {
      const chunk = flat.slice(i, i + BATCH);
      await index.addDocuments(chunk, { primaryKey: 'id' });
      indexed += chunk.length;
    }
    this.log.log(`Meilisearch: проиндексировано карточек (товаров): ${indexed}`);
    return { indexed };
  }

  /** Применить настройки индекса (sortable/filterable). */
  async ensureIndexSettings(): Promise<void> {
    if (!this.meili.isEnabled()) return;
    const index = this.meili.getIndex(PRODUCTS_INDEX);
    await this.ensureSettingsOnce(index);
  }

  private async ensureSettingsOnce(index: Index<Record<string, unknown>>): Promise<void> {
    if (this.settingsApplied) return;
    try {
      await applyProductIndexSearchSettings(index);
      this.settingsApplied = true;
    } catch (e) {
      this.log.warn(
        `Meilisearch: настройки индекса: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
}
