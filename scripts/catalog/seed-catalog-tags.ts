#!/usr/bin/env ts-node
/**
 * Seed контекстных тегов каталога v1.
 * Usage: npm run catalog:seed-tags
 */
import { PrismaClient } from '@prisma/client';

const TAGS = [
  { slug: 'ofis', name: 'Офис', sortOrder: 0 },
  { slug: 'horeca', name: 'HoReCa', sortOrder: 1 },
  { slug: 'sad', name: 'Сад', sortOrder: 2 },
  { slug: 'auditoriya', name: 'Аудитория', sortOrder: 3 },
  { slug: 'dom', name: 'Дом', sortOrder: 4 },
] as const;

const prisma = new PrismaClient();

async function main() {
  console.log('\n=== Catalog tags seed ===\n');
  for (const t of TAGS) {
    const row = await prisma.catalogTag.upsert({
      where: { slug: t.slug },
      create: t,
      update: { name: t.name, sortOrder: t.sortOrder },
    });
    console.log(`  · ${row.slug} (${row.name})`);
  }
  console.log('\nDone.\n');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
