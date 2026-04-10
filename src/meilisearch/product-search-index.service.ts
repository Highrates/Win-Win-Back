import { Injectable, Logger } from '@nestjs/common';
import type { Index } from 'meilisearch';
import { PrismaService } from '../prisma/prisma.service';
import { MeilisearchService, PRODUCTS_INDEX } from './meilisearch.service';
import {
  buildProductSearchDocument,
  collectProductCategoryIds,
  type ProductVariantSearchIndexRow,
} from './product-search-doc';
import { applyProductIndexSearchSettings } from './product-index-settings';

const BATCH = 400;

function effectiveVariantImages(
  shared: { url: string }[],
  variant: { url: string }[],
): { url: string }[] {
  if (variant?.length) return variant;
  return shared;
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
    if (!this.meili.isEnabled()) return;
    try {
      const index = this.meili.getIndex(PRODUCTS_INDEX);
      await this.ensureSettingsOnce(index);
      await index.deleteDocuments({ filter: `productId = "${productId}"` });

      const row = await this.prisma.product.findUnique({
        where: { id: productId },
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
            select: {
              id: true,
              isActive: true,
              updatedAt: true,
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
      if (!row) return;

      const categoryIds = collectProductCategoryIds(row.categoryId, row.productCategories);
      const shared = row.images.map((i) => ({ url: i.url }));
      const docs: Record<string, unknown>[] = [];

      for (const v of row.variants) {
        const eff = effectiveVariantImages(shared, v.images.map((i) => ({ url: i.url })));
        const r: ProductVariantSearchIndexRow = {
          id: v.id,
          productId: row.id,
          slug: row.slug,
          name: row.name,
          shortDescription: row.shortDescription,
          categoryId: row.categoryId,
          categoryIds,
          brandId: row.brandId,
          isActive: row.isActive && v.isActive,
          updatedAt: v.updatedAt,
          category: row.category,
          brand: row.brand,
          price: v.price,
          images: eff,
        };
        docs.push(buildProductSearchDocument(r));
      }

      if (docs.length) {
        await index.addDocuments(docs, { primaryKey: 'id' });
      }
    } catch (e) {
      this.log.warn(
        `Meilisearch: не удалось проиндексировать товар ${productId}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
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
          select: {
            id: true,
            isActive: true,
            updatedAt: true,
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

    const flat: Record<string, unknown>[] = [];
    for (const row of rows) {
      const categoryIds = collectProductCategoryIds(row.categoryId, row.productCategories);
      const shared = row.images.map((i) => ({ url: i.url }));
      for (const v of row.variants) {
        const eff = effectiveVariantImages(shared, v.images.map((i) => ({ url: i.url })));
        flat.push(
          buildProductSearchDocument({
            id: v.id,
            productId: row.id,
            slug: row.slug,
            name: row.name,
            shortDescription: row.shortDescription,
            categoryId: row.categoryId,
            categoryIds,
            brandId: row.brandId,
            isActive: row.isActive && v.isActive,
            updatedAt: v.updatedAt,
            category: row.category,
            brand: row.brand,
            price: v.price,
            images: eff,
          }),
        );
      }
    }

    let indexed = 0;
    for (let i = 0; i < flat.length; i += BATCH) {
      const chunk = flat.slice(i, i + BATCH);
      await index.addDocuments(chunk, { primaryKey: 'id' });
      indexed += chunk.length;
    }
    this.log.log(`Meilisearch: проиндексировано карточек (вариантов): ${indexed}`);
    return { indexed };
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
