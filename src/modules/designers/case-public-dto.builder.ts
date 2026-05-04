import { Prisma } from '@prisma/client';
import { sanitizeProfileAboutHtml } from '../blog/blog-html.util';
import type { CatalogService } from '../catalog/catalog.service';

export function parseStringIds(raw: Prisma.JsonValue | null | undefined, max: number): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x): x is string => typeof x === 'string')
    .map((x) => x.trim())
    .filter((x) => x.length > 0)
    .slice(0, max);
}

export function parseCoverUrls(raw: Prisma.JsonValue): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x): x is string => typeof x === 'string')
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
}

export function servicesLineFromJson(raw: Prisma.JsonValue): string | null {
  if (Array.isArray(raw)) {
    const parts = raw
      .filter((x): x is string => typeof x === 'string')
      .map((x) => x.trim())
      .filter((x) => x.length > 0);
    return parts.length ? parts.join(', ') : null;
  }
  return null;
}

/** Порядок как в кейсе; без дублей по точному совпадению строки. */
export function roomTypesLabelsFromJson(raw: Prisma.JsonValue | null | undefined): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of raw) {
    if (typeof x !== 'string') continue;
    const t = x.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

export function displayLikes(user: number, admin: number): number {
  return Math.max(0, user + admin);
}

/** Сводка товара для слотов кейса (каталог). */
export type CaseProductSummaryDto = {
  id: string;
  slug: string;
  name: string;
  price: number;
  imageUrl: string | null;
  imageUrls: string[];
  casesLinkedCount: number;
  likesDisplayCount: number;
};

/** Поля кейса, достаточные для публичного DTO (без join user). */
export type CasePublicRowInput = {
  id: string;
  title: string;
  shortDescription: string | null;
  descriptionHtml: string | null;
  coverLayout: string | null;
  coverImageUrls: Prisma.JsonValue | null;
  roomTypes: Prisma.JsonValue | null;
  productIds: Prisma.JsonValue | null;
  likesUserCount: number;
  likesAdminBoost: number;
};

export type CaseDesignerMeta = {
  slug: string;
  displayName: string;
  photoUrl: string | null;
};

const emptyProductSlot = (id: string): CaseProductSummaryDto => ({
  id,
  slug: '',
  name: 'Товар',
  price: 0,
  imageUrl: null,
  imageUrls: [],
  casesLinkedCount: 0,
  likesDisplayCount: 0,
});

function mapProductsFromIds(
  productIds: Prisma.JsonValue | null,
  productById: Map<string, CaseProductSummaryDto>,
): CaseProductSummaryDto[] {
  const pids = parseStringIds(productIds, 80);
  return pids.map((id) => {
    const p = productById.get(id);
    if (!p || !p.slug) return emptyProductSlot(id);
    return {
      id: p.id,
      slug: p.slug,
      name: p.name,
      price: p.price,
      imageUrl: p.imageUrl,
      imageUrls: p.imageUrls ?? [],
      casesLinkedCount: p.casesLinkedCount,
      likesDisplayCount: p.likesDisplayCount,
    };
  });
}

/** Ядро публичного кейса: как на витрине дизайнера / в «Проектах» (без полей дизайнера). */
export function buildCasePublicCore(
  c: CasePublicRowInput,
  productById: Map<string, CaseProductSummaryDto>,
) {
  const pids = parseStringIds(c.productIds, 80);
  const coverUrls = parseCoverUrls(c.coverImageUrls ?? null);
  const layoutCase = c.coverLayout === '16:9' ? ('16:9' as const) : ('4:3' as const);
  const rawDesc = c.descriptionHtml?.trim() ? c.descriptionHtml.trim() : '';
  const descriptionHtml = rawDesc ? sanitizeProfileAboutHtml(rawDesc) : null;
  return {
    id: c.id,
    title: c.title,
    shortDescription: c.shortDescription?.trim() || null,
    placesLine: servicesLineFromJson(c.roomTypes ?? null),
    roomTypes: roomTypesLabelsFromJson(c.roomTypes ?? null),
    descriptionHtml,
    coverLayout: layoutCase,
    coverImageUrls: coverUrls,
    likesDisplayCount: displayLikes(c.likesUserCount, c.likesAdminBoost),
    products: mapProductsFromIds(c.productIds, productById),
  };
}

/** Публичный кейс + опционально мета дизайнера (избранное, список проектов). */
export function buildCasePublicDto(
  c: CasePublicRowInput,
  productById: Map<string, CaseProductSummaryDto>,
  designer?: CaseDesignerMeta | null,
) {
  const core = buildCasePublicCore(c, productById);
  if (!designer) return core;
  return {
    ...core,
    designerSlug: designer.slug,
    designerDisplayName: designer.displayName,
    designerPhotoUrl: designer.photoUrl,
  };
}

export function collectProductIdsFromCaseRows(
  rows: Array<{ productIds: Prisma.JsonValue | null }>,
): string[] {
  const all = new Set<string>();
  for (const row of rows) {
    for (const id of parseStringIds(row.productIds, 80)) {
      all.add(id);
    }
  }
  return [...all];
}

/** Карта сводок товаров по id для всех productIds в переданных кейсах. */
export async function buildProductSummaryMapForCases(
  catalog: CatalogService,
  rows: Array<{ productIds: Prisma.JsonValue | null }>,
): Promise<Map<string, CaseProductSummaryDto>> {
  const ids = collectProductIdsFromCaseRows(rows);
  if (!ids.length) return new Map();
  const { items } = await catalog.resolveProductSummariesByIds(ids);
  return new Map(items.map((p) => [p.id, p as CaseProductSummaryDto]));
}
