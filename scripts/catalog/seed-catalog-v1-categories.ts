#!/usr/bin/env ts-node
/**
 * Создаёт скелет категорий v1 в БД (идемпотентно по slug).
 *
 * Usage (из backend/, DATABASE_URL → prod или dev):
 *   npm run catalog:seed-v1
 *   npm run catalog:seed-v1 -- --dry-run
 */
import { PrismaClient } from '@prisma/client';
import { CATALOG_V1_TREE, type CatalogV1Node } from '../../../scripts/catalog/catalog-v1-tree';

const prisma = new PrismaClient();

const dryRun = process.argv.includes('--dry-run');

type SeedStats = { created: number; skipped: number; errors: number };

async function upsertNode(
  node: CatalogV1Node,
  parentId: string | null,
  sortOrder: number,
  stats: SeedStats,
  depth = 0,
): Promise<string> {
  const existing = await prisma.category.findUnique({ where: { slug: node.slug } });

  if (existing) {
    if (existing.parentId !== parentId) {
      console.warn(
        `  ⚠ slug=${node.slug} уже есть, но parentId отличается (БД=${existing.parentId ?? 'null'}, ожидали=${parentId ?? 'null'})`,
      );
    }
    console.log(`  · skip  ${'  '.repeat(depth)}${node.name} (${node.slug})`);
    stats.skipped++;
    const id = existing.id;
    if (node.children?.length) {
      for (let i = 0; i < node.children.length; i++) {
        await upsertNode(node.children[i], id, i, stats, depth + 1);
      }
    }
    return id;
  }

  if (dryRun) {
    console.log(`  + dry   ${'  '.repeat(depth)}${node.name} (${node.slug})`);
    stats.created++;
    const fakeId = `dry-${node.slug}`;
    if (node.children?.length) {
      for (let i = 0; i < node.children.length; i++) {
        await upsertNode(node.children[i], fakeId, i, stats, depth + 1);
      }
    }
    return fakeId;
  }

  const created = await prisma.category.create({
    data: {
      name: node.name,
      slug: node.slug,
      parentId,
      sortOrder,
      isActive: true,
    },
  });
  console.log(`  + create ${'  '.repeat(depth)}${node.name} (${node.slug})`);
  stats.created++;

  if (node.children?.length) {
    for (let i = 0; i < node.children.length; i++) {
      await upsertNode(node.children[i], created.id, i, stats, depth + 1);
    }
  }
  return created.id;
}

async function main() {
  console.log(`\n=== Catalog v1 seed ${dryRun ? '(DRY RUN)' : ''} ===\n`);
  const stats: SeedStats = { created: 0, skipped: 0, errors: 0 };

  for (let i = 0; i < CATALOG_V1_TREE.length; i++) {
    const root = CATALOG_V1_TREE[i];
    console.log(`\n[${i + 1}/${CATALOG_V1_TREE.length}] ${root.name}`);
    try {
      await upsertNode(root, null, i, stats);
    } catch (e) {
      stats.errors++;
      console.error(`  ✗ ${root.name}:`, e);
    }
  }

  console.log('\n---');
  console.log(`Created: ${stats.created}, Skipped: ${stats.skipped}, Errors: ${stats.errors}`);
  if (dryRun) {
    console.log('(dry-run — в БД ничего не записано)\n');
  } else {
    console.log('Готово. Старые категории не тронуты.\n');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
