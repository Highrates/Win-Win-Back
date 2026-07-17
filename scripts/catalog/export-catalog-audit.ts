#!/usr/bin/env ts-node
/**
 * Выгрузка аудита каталога для миграции v1 → CSV.
 *
 * Usage (из backend/, DATABASE_URL → prod через SSH tunnel или на VPS):
 *   npm run catalog:audit-export
 *   npm run catalog:audit-export -- --out /tmp/catalog-audit.csv
 *   npm run catalog:audit-export -- --category-slug=pupitr-stul
 *   npm run catalog:audit-export -- --category-slug=zhurnalny-stoliki,obedenyy-stoly
 */
import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
import { flattenCatalogV1Leaves } from '../../../scripts/catalog/catalog-v1-tree';
import { resolveMigrationHint } from '../../../scripts/catalog/catalog-migration-map';

const prisma = new PrismaClient();

function arg(name: string): string | undefined {
  const p = `--${name}=`;
  return process.argv.find((a) => a.startsWith(p))?.slice(p.length);
}

const outPath = arg('out') ?? path.join(process.cwd(), 'catalog-audit-export.csv');
const categorySlugs = arg('category-slug')?.split(',').map((s) => s.trim()).filter(Boolean) ?? [];

const v1Leaves = flattenCatalogV1Leaves();

function csvEscape(value: string | number | null | undefined): string {
  const s = value == null ? '' : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function row(cols: (string | number | null | undefined)[]): string {
  return cols.map(csvEscape).join(',');
}

type CatRow = {
  id: string;
  slug: string;
  name: string;
  parentId: string | null;
};

function buildCategoryPath(catId: string, byId: Map<string, CatRow>): string {
  const parts: string[] = [];
  let cur: CatRow | undefined = byId.get(catId);
  while (cur) {
    parts.unshift(cur.name);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return parts.join(' / ');
}

function rootSlugForCategory(catId: string, byId: Map<string, CatRow>): string | null {
  let cur: CatRow | undefined = byId.get(catId);
  if (!cur) return null;
  while (cur.parentId) {
    const parent = byId.get(cur.parentId);
    if (!parent) break;
    cur = parent;
  }
  return cur.slug;
}

function nameIssues(name: string): string {
  const flags: string[] = [];
  if (/[\u4e00-\u9fff]/.test(name)) flags.push('ieroglify');
  if (/\d+\s*[x×хX]\s*\d+/.test(name)) flags.push('razmer-v-name');
  if (/%20/.test(name)) flags.push('pct20');
  if (/^\s|\s$/.test(name)) flags.push('trim');
  return flags.join('|');
}

async function main() {
  const categories = await prisma.category.findMany({
    select: { id: true, slug: true, name: true, parentId: true },
  });
  const byId = new Map(categories.map((c) => [c.id, c]));

  const categoryFilter = categorySlugs.length
    ? {
        category: {
          slug: { in: categorySlugs },
        },
      }
    : {};

  const products = await prisma.product.findMany({
    where: categoryFilter,
    orderBy: [{ category: { slug: 'asc' } }, { name: 'asc' }],
    select: {
      id: true,
      slug: true,
      name: true,
      isActive: true,
      categoryId: true,
      category: { select: { slug: true, name: true } },
      brand: { select: { name: true } },
      _count: { select: { variants: true, modifications: true, elements: true } },
    },
  });

  const header = row([
    'status',
    'product_id',
    'product_slug',
    'product_name',
    'is_active',
    'brand',
    'variants_count',
    'modifications_count',
    'elements_count',
    'old_category_id',
    'old_category_slug',
    'old_category_path',
    'target_v1_slug',
    'target_v1_path',
    'suggested_tags',
    'wave',
    'migration_note',
    'name_issues',
  ]);

  const lines = [header];

  for (const p of products) {
    const oldPath = buildCategoryPath(p.categoryId, byId);
    const rootSlug = rootSlugForCategory(p.categoryId, byId);
    const hint = resolveMigrationHint(p.category.slug, rootSlug);
    const targetPathFromSlug =
      hint.targetV1Slug != null ? v1Leaves.get(hint.targetV1Slug) ?? hint.targetPath : hint.targetPath;

    lines.push(
      row([
        'todo',
        p.id,
        p.slug,
        p.name,
        p.isActive ? 'yes' : 'no',
        p.brand?.name ?? '',
        p._count.variants,
        p._count.modifications,
        p._count.elements,
        p.categoryId,
        p.category.slug,
        oldPath,
        hint.targetV1Slug ?? '',
        targetPathFromSlug,
        hint.suggestedTags.join('|'),
        hint.wave,
        hint.note ?? '',
        nameIssues(p.name),
      ]),
    );
  }

  fs.writeFileSync(outPath, `\uFEFF${lines.join('\n')}\n`, 'utf8');

  console.log(`\n=== Catalog audit export ===`);
  console.log(`Products: ${products.length}`);
  console.log(`Output:   ${outPath}`);
  if (categorySlugs.length) {
    console.log(`Filter:   category-slug (${categorySlugs.join(', ')})`);
  }
  console.log('');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
