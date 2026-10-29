import { orderLineFxHash, parseMatchKey, shortStableHash } from './pi-excel-map';
import type { PiExcelLinePatch, PiExcelMatchResult } from './pi-excel.types';

export type OrderDraftLineForMerge = {
  id: string;
  sourceOrderItemId: string | null;
  sortOrder: number;
  productId: string;
  productVariantId: string | null;
  quantity: number;
  unit: string;
  snapshot: Record<string, unknown> | null;
  offerUnitPrice: number;
  discountPercent: number | null;
  deliveryEta: string | null;
  lineNote: string | null;
};

export type SourcingDraftLineForMerge = {
  id: string;
  sourceSourcingRequestItemId: string | null;
  sortOrder: number;
  productName: string;
  description: string | null;
  imageUrls: string[];
  quantity: number;
  unit: string;
  costPriceCny: number;
  grossWeightKg: number | null;
  volumeM3: number | null;
  offerUnitPrice: number;
  deliveryEta: string | null;
};

function lineNo(sortOrder: number, index: number): number {
  return (Number.isFinite(sortOrder) ? sortOrder : index) + 1;
}

function productNameFromSnap(snapshot: Record<string, unknown> | null): string {
  const n = snapshot?.productName;
  return typeof n === 'string' ? n.trim() : '';
}

function takeFirstUnused<T extends { id: string }>(
  candidates: T[] | undefined,
  used: Set<string>,
): T | undefined {
  if (!candidates?.length) return undefined;
  return candidates.find((c) => !used.has(c.id));
}

/**
 * Match Excel patches onto existing draft lines.
 * Unmatched Excel rows are reported (soft) — do not fail the whole file.
 * Unmatched draft lines stay unchanged.
 *
 * FX keys are hash-only (`FX:{hash}`); collisions (same productId|name) disambiguate
 * by first unused draft line with that hash. Legacy `FX:{no}:{hash}` still matches by hash.
 */
export function matchOrderPatches(
  draftLines: OrderDraftLineForMerge[],
  patches: PiExcelLinePatch[],
): PiExcelMatchResult<OrderDraftLineForMerge> {
  const byOi = new Map<string, OrderDraftLineForMerge>();
  const byKl = new Map<string, OrderDraftLineForMerge>();
  const byNo = new Map<number, OrderDraftLineForMerge>();
  const byFxHash = new Map<string, OrderDraftLineForMerge[]>();

  draftLines.forEach((l, idx) => {
    const no = lineNo(l.sortOrder, idx);
    if (l.sourceOrderItemId) byOi.set(l.sourceOrderItemId, l);
    byKl.set(l.id, l);
    byNo.set(no, l);
    const hash = orderLineFxHash({
      productId: l.productId,
      productName: productNameFromSnap(l.snapshot),
    });
    const list = byFxHash.get(hash) ?? [];
    list.push(l);
    byFxHash.set(hash, list);
  });

  const used = new Set<string>();
  const pairs: PiExcelMatchResult<OrderDraftLineForMerge>['pairs'] = [];
  const unmatched: string[] = [];

  for (const patch of patches) {
    let target: OrderDraftLineForMerge | undefined;
    const key = parseMatchKey(patch.matchKey);
    if (key?.kind === 'OI') target = byOi.get(key.id);
    else if (key?.kind === 'KL') target = byKl.get(key.id);
    else if (key?.kind === 'FX') {
      target = takeFirstUnused(byFxHash.get(key.hash), used);
      // Legacy disambiguate: if several share hash and legacy no is present, prefer that No.
      if (
        !target &&
        key.legacySortOrder != null &&
        byNo.has(key.legacySortOrder) &&
        !used.has(byNo.get(key.legacySortOrder)!.id)
      ) {
        const byLegacyNo = byNo.get(key.legacySortOrder)!;
        const hash = orderLineFxHash({
          productId: byLegacyNo.productId,
          productName: productNameFromSnap(byLegacyNo.snapshot),
        });
        if (hash === key.hash) target = byLegacyNo;
      }
    } else if (key?.kind === 'N') target = byNo.get(key.n);

    if (!target && patch.no != null) target = byNo.get(patch.no);

    if (!target) {
      unmatched.push(`строка Excel ${patch.excelRow} (T=${patch.matchKey ?? '—'}, No=${patch.no ?? '—'})`);
      continue;
    }
    if (used.has(target.id)) {
      unmatched.push(
        `строка Excel ${patch.excelRow}: позиция уже сопоставлена (${target.id.slice(0, 8)}…)`,
      );
      continue;
    }
    used.add(target.id);
    pairs.push({ line: target, patch });
  }

  return { pairs, unmatched };
}

export function matchSourcingPatches(
  draftLines: SourcingDraftLineForMerge[],
  patches: PiExcelLinePatch[],
): PiExcelMatchResult<SourcingDraftLineForMerge> {
  const bySl = new Map<string, SourcingDraftLineForMerge>();
  const byNo = new Map<number, SourcingDraftLineForMerge>();
  const byFxHash = new Map<string, SourcingDraftLineForMerge[]>();

  draftLines.forEach((l, idx) => {
    const no = lineNo(l.sortOrder, idx);
    if (l.sourceSourcingRequestItemId) bySl.set(l.sourceSourcingRequestItemId, l);
    bySl.set(l.id, l);
    byNo.set(no, l);
    const name = l.productName?.trim() || '';
    if (name) {
      const hash = shortStableHash(name);
      const list = byFxHash.get(hash) ?? [];
      list.push(l);
      byFxHash.set(hash, list);
    }
  });

  const used = new Set<string>();
  const pairs: PiExcelMatchResult<SourcingDraftLineForMerge>['pairs'] = [];
  const unmatched: string[] = [];

  for (const patch of patches) {
    let target: SourcingDraftLineForMerge | undefined;
    const key = parseMatchKey(patch.matchKey);
    if (key?.kind === 'SL') target = bySl.get(key.id);
    else if (key?.kind === 'FX') {
      target = takeFirstUnused(byFxHash.get(key.hash), used);
      if (
        !target &&
        key.legacySortOrder != null &&
        byNo.has(key.legacySortOrder) &&
        !used.has(byNo.get(key.legacySortOrder)!.id)
      ) {
        const byLegacyNo = byNo.get(key.legacySortOrder)!;
        const name = byLegacyNo.productName?.trim() || '';
        if (name && shortStableHash(name) === key.hash) target = byLegacyNo;
      }
    } else if (key?.kind === 'N') target = byNo.get(key.n);

    if (!target && patch.no != null) target = byNo.get(patch.no);

    if (!target) {
      unmatched.push(`строка Excel ${patch.excelRow} (T=${patch.matchKey ?? '—'}, No=${patch.no ?? '—'})`);
      continue;
    }
    if (used.has(target.id)) {
      unmatched.push(
        `строка Excel ${patch.excelRow}: позиция уже сопоставлена (${target.id.slice(0, 8)}…)`,
      );
      continue;
    }
    used.add(target.id);
    pairs.push({ line: target, patch });
  }

  return { pairs, unmatched };
}
