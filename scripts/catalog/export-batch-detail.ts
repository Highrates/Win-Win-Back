#!/usr/bin/env ts-node
/**
 * Детальный отчёт по партии товаров для согласования миграции.
 *
 * Usage:
 *   npx ts-node ... export-batch-detail.ts --ids=id1,id2
 *   npx ts-node ... export-batch-detail.ts --slugs=slug1,slug2
 *   npx ts-node ... export-batch-detail.ts --category-slug=pupitr-stul --limit=10
 */
import * as fs from 'fs';
import { PrismaClient } from '@prisma/client';
import { flattenCatalogV1Leaves } from '../../../scripts/catalog/catalog-v1-tree';
import { resolveMigrationHint } from '../../../scripts/catalog/catalog-migration-map';

const prisma = new PrismaClient();
const v1Leaves = flattenCatalogV1Leaves();

function arg(name: string): string | undefined {
  const p = `--${name}=`;
  return process.argv.find((a) => a.startsWith(p))?.slice(p.length);
}

async function main() {
  const ids = arg('ids')?.split(',').filter(Boolean);
  const slugs = arg('slugs')?.split(',').filter(Boolean);
  const categorySlug = arg('category-slug');
  const limit = Number(arg('limit') ?? '10');

  let productIds = ids ?? [];

  if (!productIds.length && slugs?.length) {
    const rows = await prisma.product.findMany({
      where: { slug: { in: slugs } },
      select: { id: true },
    });
    productIds = rows.map((r) => r.id);
  }

  if (!productIds.length && categorySlug) {
    const cat = await prisma.category.findUnique({ where: { slug: categorySlug } });
    if (!cat) throw new Error(`Category not found: ${categorySlug}`);
    const rows = await prisma.product.findMany({
      where: { categoryId: cat.id },
      orderBy: { name: 'asc' },
      take: limit,
      select: { id: true },
    });
    productIds = rows.map((r) => r.id);
  }

  if (!productIds.length) {
    throw new Error('Provide --ids, --slugs, or --category-slug');
  }

  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    orderBy: { name: 'asc' },
    include: {
      category: { select: { id: true, slug: true, name: true, parentId: true } },
      brand: { select: { name: true } },
      modifications: { orderBy: { sortOrder: 'asc' } },
      elements: {
        orderBy: { sortOrder: 'asc' },
        include: {
          availabilities: {
            include: {
              brandMaterialColor: {
                include: {
                  material: { select: { name: true } },
                },
              },
            },
          },
        },
      },
      variants: {
        orderBy: { sortOrder: 'asc' },
        include: {
          modification: { select: { name: true } },
          elementSelections: {
            include: {
              element: { select: { name: true } },
              brandMaterialColor: {
                include: { material: { select: { name: true } } },
              },
            },
          },
        },
      },
    },
  });

  const categories = await prisma.category.findMany({
    select: { id: true, slug: true, name: true, parentId: true },
  });
  const byId = new Map(categories.map((c) => [c.id, c]));

  function catPath(id: string): string {
    const parts: string[] = [];
    let cur = byId.get(id);
    while (cur) {
      parts.unshift(cur.name);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    return parts.join(' / ');
  }

  const targetCatId = await prisma.category.findUnique({
    where: { slug: arg('target-v1-slug') ?? 'stulya-s-pupitrom' },
    select: { id: true, slug: true, name: true },
  });

  const report = products.map((p) => {
    const hint = resolveMigrationHint(p.category.slug, null);
    const targetSlug = hint.targetV1Slug ?? arg('target-v1-slug') ?? 'stulya-s-pupitrom';
    const targetPath = v1Leaves.get(targetSlug) ?? hint.targetPath;

    const nameIssues: string[] = [];
    if (/[\u4e00-\u9fff]/.test(p.name)) nameIssues.push('ieroglify');
    if (/офисное кресло/i.test(p.name) && /кресло/i.test(p.name.replace(/офисное кресло/i, '')))
      nameIssues.push('duplicate-kreslo');
    if (/конференц-кресло/i.test(p.name.toLowerCase()) && p.name.toLowerCase().includes('офисное'))
      nameIssues.push('redundant-prefix');

    let proposedName = p.name;
    if (/конференц/i.test(p.name)) proposedName = 'Конференц-кресло';
    else if (/кресло кит/i.test(p.name.toLowerCase())) proposedName = 'Кресло Кит';
    else if (/^офисное кресло\s+/i.test(p.name))
      proposedName = p.name.replace(/^офисное кресло\s+/i, '');

    return {
      productId: p.id,
      slug: p.slug,
      isActive: p.isActive,
      brand: p.brand?.name ?? null,
      current: {
        name: p.name,
        categoryPath: catPath(p.categoryId),
        categorySlug: p.category.slug,
      },
      proposed: {
        name: proposedName,
        categoryV1Slug: targetSlug,
        categoryV1Path: targetPath,
        tags: hint.suggestedTags,
      },
      nameIssues,
      modifications: p.modifications.map((m) => ({
        id: m.id,
        name: m.name,
        modificationSlug: m.modificationSlug,
      })),
      elements: p.elements.map((e) => ({
        id: e.id,
        name: e.name,
        poolSize: e.availabilities.length,
        poolSample: e.availabilities.slice(0, 3).map((mc) => ({
          material: mc.brandMaterialColor.material.name,
          colorId: mc.brandMaterialColorId,
        })),
      })),
      variants: p.variants.map((v) => ({
        id: v.id,
        variantLabel: v.variantLabel,
        sku: v.sku,
        modification: v.modification.name,
        price: v.price?.toString() ?? null,
        selections: v.elementSelections.map((s) => ({
          element: s.element.name,
          material: s.brandMaterialColor.material.name,
        })),
      })),
      checks: {
        moveCategory: p.category.slug !== targetSlug,
        rename: proposedName !== p.name,
        modsOk: p.modifications.every((m) => /\d/.test(m.name)),
      },
    };
  });

  const out = arg('out') ?? 'catalog-batch-review.json';
  fs.writeFileSync(out, JSON.stringify({ targetCategory: targetCatId, items: report }, null, 2), 'utf8');

  console.log(`\n=== Batch detail export ===`);
  console.log(`Items: ${report.length}`);
  console.log(`Output: ${out}`);
  console.log(`Target v1: ${targetCatId?.name ?? 'stulya-s-pupitrom'} (${targetCatId?.slug})\n`);

  for (const r of report) {
    console.log(`• ${r.slug}`);
    console.log(`  name: "${r.current.name}" → "${r.proposed.name}"`);
    console.log(`  cat:  ${r.current.categoryPath}`);
    console.log(`     → ${r.proposed.categoryV1Path}`);
    console.log(`  mods: ${r.modifications.map((m) => m.name).join(' | ') || '—'}`);
    console.log(`  vars: ${r.variants.length}, issues: ${r.nameIssues.join(', ') || '—'}`);
  }
  console.log('');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
