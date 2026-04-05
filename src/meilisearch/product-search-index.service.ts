import { Injectable, Logger } from '@nestjs/common';
import type { Index } from 'meilisearch';
import { PrismaService } from '../prisma/prisma.service';
import { MeilisearchService, PRODUCTS_INDEX } from './meilisearch.service';
import { buildProductSearchDocument, collectProductCategoryIds } from './product-search-doc';
import { applyProductIndexSearchSettings } from './product-index-settings';

const BATCH = 400;

@Injectable()
export class ProductSearchIndexService {
  private readonly log = new Logger(ProductSearchIndexService.name);
  private settingsApplied = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly meili: MeilisearchService,
  ) {}

  /** Синхронизация одного товара (создание/обновление). Ошибки Meilisearch не пробрасываются. */
  async syncProduct(productId: string): Promise<void> {
    if (!this.meili.isEnabled()) return;
    try {
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
      });
      const index = this.meili.getIndex(PRODUCTS_INDEX);
      if (!row) {
        await index.deleteDocuments([productId]);
        return;
      }
      await this.ensureSettingsOnce(index);
      await index.addDocuments(
        [
          buildProductSearchDocument({
            ...row,
            categoryIds: collectProductCategoryIds(row.categoryId, row.productCategories),
          }),
        ],
        { primaryKey: 'id' },
      );
    } catch (e) {
      this.log.warn(
        `Meilisearch: не удалось проиндексировать товар ${productId}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  /** Удаление из индекса после удаления из БД. */
  async removeProducts(ids: string[]): Promise<void> {
    if (!this.meili.isEnabled() || ids.length === 0) return;
    try {
      const index = this.meili.getIndex(PRODUCTS_INDEX);
      await index.deleteDocuments(ids);
    } catch (e) {
      this.log.warn(
        `Meilisearch: не удалить документы: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  /** Полная переиндексация каталога из Prisma. */
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
    });
    let indexed = 0;
    for (let i = 0; i < rows.length; i += BATCH) {
      const chunk = rows
        .slice(i, i + BATCH)
        .map((r) =>
          buildProductSearchDocument({
            ...r,
            categoryIds: collectProductCategoryIds(r.categoryId, r.productCategories),
          }),
        );
      await index.addDocuments(chunk, { primaryKey: 'id' });
      indexed += chunk.length;
    }
    this.log.log(`Meilisearch: проиндексировано товаров: ${indexed}`);
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
