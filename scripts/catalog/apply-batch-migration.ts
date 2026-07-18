#!/usr/bin/env ts-node
/**
 * Применяет согласованную партию миграции из JSON.
 *
 * Usage:
 *   npx ts-node ... apply-batch-migration.ts --file=../../scripts/catalog/batches/batch2-....json
 *   npx ts-node ... apply-batch-migration.ts --file=... --dry-run
 *
 * proposed:
 *   name, categoryV1Slug, tags
 *   modificationName — переименовать ВСЕ модификации (batch1-совместимо)
 *   modifications: [{ id, name }] — точечно по id
 *   elementName — переименовать ВСЕ элементы (batch1-совместимо)
 *   elements: [{ id, name }] — точечно по id
 *   variantSkus: [{ variantId, sku }] — артикул варианта; при коллизии → sku.1, sku.2, …
 *   shortDescription — короткое описание (plain); "" → null
 *   technicalSpecs — технические параметры (plain); "" → null
 */
import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const dryRun = process.argv.includes('--dry-run');

function arg(name: string): string | undefined {
  const p = `--${name}=`;
  return process.argv.find((a) => a.startsWith(p))?.slice(p.length);
}

type NamedPatch = { id: string; name: string };
type VariantSkuPatch = { variantId: string; sku: string };

type BatchItem = {
  productId: string;
  slug?: string;
  apply?: boolean;
  proposed: {
    name?: string;
    categoryV1Slug?: string;
    shortDescription?: string | null;
    technicalSpecs?: string | null;
    modificationName?: string;
    modifications?: NamedPatch[];
    elementName?: string;
    elements?: NamedPatch[];
    variantSkus?: VariantSkuPatch[];
    tags?: string[];
  };
};

async function resolveTagIds(slugs: string[]): Promise<Map<string, string>> {
  const rows = await prisma.catalogTag.findMany({
    where: { slug: { in: slugs } },
    select: { id: true, slug: true },
  });
  return new Map(rows.map((r) => [r.slug, r.id]));
}

/** Свободный sku: base, base.1, base.2, … (уникален глобально на ProductVariant.sku). */
async function allocateUniqueSku(
  desired: string,
  variantId: string,
  reservedInBatch: Set<string>,
): Promise<string> {
  const base = desired.trim();
  if (!base) throw new Error('Empty sku');

  for (let n = 0; n < 100; n++) {
    const candidate = n === 0 ? base : `${base}.${n}`;
    if (reservedInBatch.has(candidate)) continue;

    const clash = await prisma.productVariant.findFirst({
      where: {
        sku: candidate,
        NOT: { id: variantId },
      },
      select: { id: true },
    });
    if (!clash) {
      reservedInBatch.add(candidate);
      return candidate;
    }
  }
  throw new Error(`Cannot allocate unique sku from "${base}"`);
}

async function main() {
  const fileArg = arg('file');
  if (!fileArg) throw new Error('--file= path required');

  const file = path.isAbsolute(fileArg) ? fileArg : path.resolve(process.cwd(), fileArg);
  if (!fs.existsSync(file)) throw new Error(`File not found: ${file}`);

  const payload = JSON.parse(fs.readFileSync(file, 'utf8')) as {
    label?: string;
    items: BatchItem[];
  };
  const items = payload.items.filter((i) => i.apply !== false);

  console.log(`\n=== Apply batch migration ${dryRun ? '(DRY RUN)' : ''} ===`);
  console.log(`Batch: ${payload.label ?? path.basename(file)}`);
  console.log(`Items: ${items.length}\n`);

  const allTagSlugs = [...new Set(items.flatMap((i) => i.proposed.tags ?? []))];
  const tagIds = allTagSlugs.length ? await resolveTagIds(allTagSlugs) : new Map<string, string>();
  for (const slug of allTagSlugs) {
    if (!tagIds.has(slug)) throw new Error(`CatalogTag not found: ${slug}. Run catalog:seed-tags first.`);
  }

  const reservedSkus = new Set<string>();
  let updated = 0;

  for (const item of items) {
    const existing = await prisma.product.findUnique({
      where: { id: item.productId },
      include: {
        category: { select: { slug: true, name: true } },
        modifications: { orderBy: { sortOrder: 'asc' } },
        elements: { orderBy: { sortOrder: 'asc' } },
        variants: { select: { id: true, sku: true, variantLabel: true } },
        catalogTags: { select: { tagId: true, tag: { select: { slug: true } } } },
      },
    });
    if (!existing) {
      console.warn(`  ✗ skip missing ${item.productId}`);
      continue;
    }

    console.log(`  → ${existing.slug}`);

    const productData: {
      name?: string;
      categoryId?: string;
      shortDescription?: string | null;
      technicalSpecs?: string | null;
    } = {};
    if (item.proposed.name?.trim()) {
      productData.name = item.proposed.name.trim();
      console.log(`      name: "${existing.name}" → "${productData.name}"`);
    }

    if (item.proposed.categoryV1Slug?.trim()) {
      const cat = await prisma.category.findUnique({
        where: { slug: item.proposed.categoryV1Slug.trim() },
      });
      if (!cat) throw new Error(`Category not found: ${item.proposed.categoryV1Slug}`);
      productData.categoryId = cat.id;
      console.log(`      cat:  ${existing.category.name} → ${cat.name}`);
    }

    if (item.proposed.shortDescription !== undefined) {
      const next =
        item.proposed.shortDescription === null
          ? null
          : item.proposed.shortDescription.trim() || null;
      const prev = existing.shortDescription ?? '—';
      productData.shortDescription = next;
      console.log(`      short: "${String(prev).slice(0, 48)}" → "${String(next ?? '—').slice(0, 48)}"`);
    }

    if (item.proposed.technicalSpecs !== undefined) {
      const next =
        item.proposed.technicalSpecs === null
          ? null
          : item.proposed.technicalSpecs.trim() || null;
      const prev = existing.technicalSpecs ?? '—';
      productData.technicalSpecs = next;
      console.log(`      tech:  "${String(prev).slice(0, 48)}" → "${String(next ?? '—').slice(0, 48)}"`);
    }

    if (!dryRun && Object.keys(productData).length) {
      await prisma.product.update({ where: { id: item.productId }, data: productData });
    }

    const modById = new Map(existing.modifications.map((m) => [m.id, m]));
    if (item.proposed.modifications?.length) {
      for (const patch of item.proposed.modifications) {
        const mod = modById.get(patch.id);
        if (!mod) throw new Error(`Modification ${patch.id} not on product ${item.productId}`);
        const next = patch.name.trim();
        if (mod.name === next) continue;
        console.log(`      mod:  "${mod.name}" → "${next}"`);
        if (!dryRun) {
          await prisma.productModification.update({
            where: { id: mod.id },
            data: { name: next },
          });
        }
      }
    } else if (item.proposed.modificationName && existing.modifications.length) {
      for (const mod of existing.modifications) {
        if (mod.name === item.proposed.modificationName) continue;
        console.log(`      mod:  "${mod.name}" → "${item.proposed.modificationName}"`);
        if (!dryRun) {
          await prisma.productModification.update({
            where: { id: mod.id },
            data: { name: item.proposed.modificationName },
          });
        }
      }
    }

    const elById = new Map(existing.elements.map((e) => [e.id, e]));
    if (item.proposed.elements?.length) {
      for (const patch of item.proposed.elements) {
        const el = elById.get(patch.id);
        if (!el) throw new Error(`Element ${patch.id} not on product ${item.productId}`);
        const next = patch.name.trim();
        if (el.name === next) continue;
        console.log(`      elem: "${el.name}" → "${next}"`);
        if (!dryRun) {
          await prisma.productElement.update({
            where: { id: el.id },
            data: { name: next },
          });
        }
      }
    } else if (item.proposed.elementName && existing.elements.length) {
      for (const el of existing.elements) {
        if (el.name === item.proposed.elementName) continue;
        console.log(`      elem: "${el.name}" → "${item.proposed.elementName}"`);
        if (!dryRun) {
          await prisma.productElement.update({
            where: { id: el.id },
            data: { name: item.proposed.elementName },
          });
        }
      }
    }

    if (item.proposed.variantSkus?.length) {
      const varById = new Map(existing.variants.map((v) => [v.id, v]));
      for (const patch of item.proposed.variantSkus) {
        const v = varById.get(patch.variantId);
        if (!v) throw new Error(`Variant ${patch.variantId} not on product ${item.productId}`);
        const allocated = await allocateUniqueSku(patch.sku, v.id, reservedSkus);
        if (v.sku === allocated) {
          console.log(`      sku:  ${v.id.slice(-6)} already "${allocated}"`);
          continue;
        }
        const note = allocated !== patch.sku.trim() ? ` (wanted "${patch.sku.trim()}")` : '';
        console.log(`      sku:  "${v.sku ?? '—'}" → "${allocated}"${note}`);
        if (!dryRun) {
          await prisma.productVariant.update({
            where: { id: v.id },
            data: { sku: allocated },
          });
        }
      }
    }

    const wantTags = item.proposed.tags ?? [];
    const haveTags = new Set(existing.catalogTags.map((t) => t.tag.slug));
    const toAdd = wantTags.filter((s) => !haveTags.has(s));
    if (toAdd.length) {
      console.log(`      tags: +${toAdd.join(', ')}`);
      if (!dryRun) {
        await prisma.productCatalogTag.createMany({
          data: toAdd.map((slug) => ({
            productId: item.productId,
            tagId: tagIds.get(slug)!,
          })),
          skipDuplicates: true,
        });
      }
    }

    updated++;
  }

  console.log(`\nProcessed: ${updated}${dryRun ? ' (dry-run)' : ''}\n`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
