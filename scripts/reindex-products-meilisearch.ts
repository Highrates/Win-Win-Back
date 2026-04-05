/**
 * Полная переиндексация товаров в Meilisearch (индекс `products`).
 * Запуск из каталога backend:
 *   npx ts-node --compiler-options '{"module":"CommonJS"}' scripts/reindex-products-meilisearch.ts
 * Нужны DATABASE_URL, MEILISEARCH_ENABLED=true, MEILISEARCH_HOST (и при необходимости API key).
 */
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { PrismaClient } from '@prisma/client';
import { MeiliSearch } from 'meilisearch';
import {
  buildProductSearchDocument,
  collectProductCategoryIds,
} from '../src/meilisearch/product-search-doc';
import { applyProductIndexSearchSettings } from '../src/meilisearch/product-index-settings';

const PRODUCTS_INDEX = 'products';
const BATCH = 400;

function tryLoadEnvFile(file: string) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

tryLoadEnvFile(resolve(__dirname, '../.env'));
tryLoadEnvFile(resolve(process.cwd(), '.env'));
tryLoadEnvFile(resolve(process.cwd(), 'backend/.env'));

function meiliEnabled(): boolean {
  const v = process.env.MEILISEARCH_ENABLED?.trim().toLowerCase();
  return v === 'true' || v === '1' || v === 'yes';
}

async function main() {
  if (!meiliEnabled()) {
    console.error('Задайте MEILISEARCH_ENABLED=true и перезапустите скрипт.');
    process.exit(1);
  }
  const host = process.env.MEILISEARCH_HOST?.trim() || 'http://localhost:7700';
  const apiKey = process.env.MEILISEARCH_API_KEY;
  const client = new MeiliSearch({
    host,
    ...(apiKey ? { apiKey } : {}),
  });
  const index = client.index(PRODUCTS_INDEX);
  const prisma = new PrismaClient();

  try {
    await applyProductIndexSearchSettings(index);
    await index.deleteAllDocuments();

    const rows = await prisma.product.findMany({
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
    console.log(`Готово: в индекс загружено ${indexed} товаров.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
