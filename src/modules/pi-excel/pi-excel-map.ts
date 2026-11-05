import { orderItemSnapshotMetaRows } from '@win-win/order-item-snapshot';
import type { PiExcelExportLine, ParsedMatchKey, PiExcelLinePatch } from './pi-excel.types';

export function formatDisplayId(fullId: string): string {
  const clean = fullId.replace(/[^a-z0-9]/gi, '');
  if (clean.length <= 8) return clean.toUpperCase();
  return `${clean.slice(0, 4).toUpperCase()}-${clean.slice(-4).toUpperCase()}`;
}

/** Short stable hash for freeform match keys (not crypto). */
export function shortStableHash(input: string): string {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * Prefer durable source ids. Never export KL:<proposalLineId> — those die on draft re-init.
 * Freeform lines: `FX:<hash(productId|name)>` — **no sortOrder** (reorder-safe).
 * Legacy files may still have `FX:<no>:<hash>`; parse keeps hash and optional legacySortOrder.
 */
export function buildOrderMatchKey(opts: {
  sourceOrderItemId?: string | null;
  productId?: string | null;
  productName?: string | null;
  no: number;
}): string {
  const oi = opts.sourceOrderItemId?.trim();
  if (oi) return `OI:${oi}`;
  const stable = `${opts.productId?.trim() || ''}|${(opts.productName || '').trim()}`;
  if (stable !== '|') return `FX:${shortStableHash(stable)}`;
  return `N:${opts.no}`;
}

export function buildSourcingMatchKey(opts: {
  sourceSourcingRequestItemId?: string | null;
  productName?: string | null;
  no: number;
}): string {
  if (opts.sourceSourcingRequestItemId?.trim()) {
    return `SL:${opts.sourceSourcingRequestItemId.trim()}`;
  }
  const name = (opts.productName || '').trim();
  if (name) return `FX:${shortStableHash(name)}`;
  return `N:${opts.no}`;
}

export function parseMatchKey(raw: unknown): ParsedMatchKey {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  // Legacy: FX:{no}:{hash}
  const fxLegacy = /^FX:(\d+):([a-f0-9]+)$/i.exec(s);
  if (fxLegacy) {
    const legacySortOrder = Number.parseInt(fxLegacy[1]!, 10);
    const hash = fxLegacy[2]!.toLowerCase();
    if (!Number.isFinite(legacySortOrder) || legacySortOrder < 1 || !hash) return null;
    return { kind: 'FX', hash, legacySortOrder };
  }
  // Current: FX:{hash}
  const fx = /^FX:([a-f0-9]+)$/i.exec(s);
  if (fx) {
    const hash = fx[1]!.toLowerCase();
    if (!hash) return null;
    return { kind: 'FX', hash };
  }
  const m = /^(OI|KL|SL|N):(.+)$/i.exec(s);
  if (!m) return null;
  const kind = m[1]!.toUpperCase() as 'OI' | 'KL' | 'SL' | 'N';
  const rest = m[2]!.trim();
  if (!rest) return null;
  if (kind === 'N') {
    const n = Number.parseInt(rest, 10);
    if (!Number.isFinite(n) || n < 1) return null;
    return { kind: 'N', n };
  }
  return { kind, id: rest };
}

export function snapshotAsRecord(snapshot: unknown): Record<string, unknown> | null {
  if (snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)) {
    return snapshot as Record<string, unknown>;
  }
  return null;
}

export function formatDimsMm(
  lengthMm: unknown,
  widthMm: unknown,
  heightMm: unknown,
): string | null {
  const l = typeof lengthMm === 'number' && Number.isFinite(lengthMm) ? lengthMm : null;
  const w = typeof widthMm === 'number' && Number.isFinite(widthMm) ? widthMm : null;
  const h = typeof heightMm === 'number' && Number.isFinite(heightMm) ? heightMm : null;
  if (l == null || w == null || h == null) return null;
  return `${l}*${w}*${h}`;
}

export function parseDimsMm(raw: unknown): {
  lengthMm: number | null;
  widthMm: number | null;
  heightMm: number | null;
} {
  if (raw == null) return { lengthMm: null, widthMm: null, heightMm: null };
  const s = String(raw)
    .replace(/mm\.?/gi, '')
    .replace(/×/g, '*')
    .replace(/x/gi, '*')
    .replace(/,/g, '.')
    .trim();
  const parts = s
    .split('*')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => Number.parseFloat(p.replace(/[^\d.]/g, '')));
  if (parts.length < 3) return { lengthMm: null, widthMm: null, heightMm: null };
  const [lengthMm, widthMm, heightMm] = parts;
  const ok = (n: number | undefined) =>
    n != null && Number.isFinite(n) && n > 0 ? Math.round(n) : null;
  return {
    lengthMm: ok(lengthMm),
    widthMm: ok(widthMm),
    heightMm: ok(heightMm),
  };
}

export function descriptionFromOrderSnapshot(snapshot: unknown): string | null {
  const rows = orderItemSnapshotMetaRows(snapshot);
  if (!rows.length) return null;
  return rows.map((r) => `${r.label}: ${r.value}`).join('\n');
}

export function modelNameFromOrderSnapshot(snapshot: unknown, fallbackName?: string | null): string {
  const s = snapshotAsRecord(snapshot);
  const name =
    (typeof s?.productName === 'string' && s.productName.trim()) ||
    (fallbackName?.trim() ?? '') ||
    '—';
  const mod = typeof s?.modificationLabel === 'string' ? s.modificationLabel.trim() : '';
  return mod ? `${name}\n${mod}` : name;
}

export function imageUrlFromOrderSnapshot(snapshot: unknown): string | null {
  const s = snapshotAsRecord(snapshot);
  if (typeof s?.imageUrl === 'string' && s.imageUrl.trim()) return s.imageUrl.trim();
  if (Array.isArray(s?.imageUrls)) {
    for (const u of s.imageUrls) {
      if (typeof u === 'string' && u.trim()) return u.trim();
    }
  }
  return null;
}

/** Brand for Excel col D — from snapshot when present. */
export function brandFromOrderSnapshot(snapshot: unknown): string | null {
  const s = snapshotAsRecord(snapshot);
  if (typeof s?.brandName === 'string' && s.brandName.trim()) return s.brandName.trim();
  if (typeof s?.brand === 'string' && s.brand.trim()) return s.brand.trim();
  if (s?.brand && typeof s.brand === 'object' && !Array.isArray(s.brand)) {
    const name = (s.brand as Record<string, unknown>).name;
    if (typeof name === 'string' && name.trim()) return name.trim();
  }
  return null;
}

export function weightFromSnapshot(snapshot: unknown): number | null {
  const s = snapshotAsRecord(snapshot);
  const w = s?.weightKg;
  return typeof w === 'number' && Number.isFinite(w) && w > 0 ? w : null;
}

/**
 * Legacy snapshot / catalog field name `volumeLiters` stores **m³** (not litres).
 * Same contract as KP UI (`KpGrossFieldsEditor`) and variant admin (`volumeLiters: volM3`).
 * Excel PI col L is also m³ — read/write via `volumeM3FromOrderSnapshot` / `setOrderSnapshotVolumeM3`.
 */
export const ORDER_SNAPSHOT_VOLUME_M3_KEY = 'volumeLiters' as const;

/** Read canonical volume (m³) from order snapshot (`volumeLiters` key stores m³). */
export function volumeM3FromOrderSnapshot(snapshot: unknown): number | null {
  const s = snapshotAsRecord(snapshot);
  const v = s?.[ORDER_SNAPSHOT_VOLUME_M3_KEY];
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
}

/** Write Excel/order volume (m³) into snapshot under legacy `volumeLiters` key. */
export function setOrderSnapshotVolumeM3(
  snapshot: Record<string, unknown>,
  volumeM3: number,
): void {
  if (Number.isFinite(volumeM3) && volumeM3 > 0) {
    snapshot[ORDER_SNAPSHOT_VOLUME_M3_KEY] = volumeM3;
  }
}

export function orderItemToExportLine(opts: {
  no: number;
  itemId: string;
  productId?: string | null;
  quantity: number;
  /** CNY for PI col H; null → skip price cell */
  unitPriceCny: number | null;
  snapshot: unknown;
  productName?: string | null;
}): PiExcelExportLine {
  const snap = opts.snapshot;
  const s = snapshotAsRecord(snap);
  const modelName = modelNameFromOrderSnapshot(snap, opts.productName);
  return {
    no: opts.no,
    matchKey: buildOrderMatchKey({
      sourceOrderItemId: opts.itemId,
      productId: opts.productId,
      productName: modelName,
      no: opts.no,
    }),
    modelName,
    brand: brandFromOrderSnapshot(snap),
    quantity: opts.quantity,
    unitPrice: opts.unitPriceCny,
    description: descriptionFromOrderSnapshot(snap),
    productSizeMm: formatDimsMm(s?.lengthMm, s?.widthMm, s?.heightMm),
    weightKg: weightFromSnapshot(snap),
    volumeM3: volumeM3FromOrderSnapshot(snap),
    imageUrl: imageUrlFromOrderSnapshot(snap),
  };
}

export function orderKpLineToExportLine(opts: {
  no: number;
  sourceOrderItemId: string | null;
  productId?: string | null;
  quantity: number;
  /** CNY for PI col H; null → skip price cell */
  unitPriceCny: number | null;
  snapshot: unknown;
}): PiExcelExportLine {
  const snap = opts.snapshot;
  const s = snapshotAsRecord(snap);
  const modelName = modelNameFromOrderSnapshot(snap);
  return {
    no: opts.no,
    matchKey: buildOrderMatchKey({
      sourceOrderItemId: opts.sourceOrderItemId,
      productId: opts.productId,
      productName: modelName,
      no: opts.no,
    }),
    modelName,
    brand: brandFromOrderSnapshot(snap),
    quantity: opts.quantity,
    unitPrice: opts.unitPriceCny,
    description: descriptionFromOrderSnapshot(snap),
    productSizeMm: formatDimsMm(s?.lengthMm, s?.widthMm, s?.heightMm),
    weightKg: weightFromSnapshot(snap),
    volumeM3: volumeM3FromOrderSnapshot(snap),
    imageUrl: imageUrlFromOrderSnapshot(snap),
  };
}

export function sourcingLineToExportLine(opts: {
  no: number;
  sourceSourcingRequestItemId?: string | null;
  productName: string;
  brand?: string | null;
  description?: string | null;
  quantity: number;
  costPriceCny: number;
  grossWeightKg?: number | null;
  volumeM3?: number | null;
  imageUrl?: string | null;
}): PiExcelExportLine {
  return {
    no: opts.no,
    matchKey: buildSourcingMatchKey({
      sourceSourcingRequestItemId: opts.sourceSourcingRequestItemId,
      productName: opts.productName,
      no: opts.no,
    }),
    modelName: opts.productName?.trim() || '—',
    brand: opts.brand?.trim() || null,
    quantity: opts.quantity,
    unitPrice: opts.costPriceCny,
    description: opts.description?.trim() || null,
    productSizeMm: null,
    weightKg: opts.grossWeightKg != null && opts.grossWeightKg > 0 ? opts.grossWeightKg : null,
    volumeM3: opts.volumeM3 != null && opts.volumeM3 > 0 ? opts.volumeM3 : null,
    imageUrl: opts.imageUrl?.trim() || null,
  };
}

export function orderLineFxHash(opts: {
  productId?: string | null;
  productName?: string | null;
}): string {
  return shortStableHash(`${opts.productId?.trim() || ''}|${(opts.productName || '').trim()}`);
}

export function cellToNumber(raw: unknown): number | null {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string') {
    const t = raw
      .replace(/\u00a0/g, ' ')
      .replace(/\s/g, '')
      .replace(',', '.')
      .replace(/[^\d.\-]/g, '');
    if (!t || t === '-' || t === '.') return null;
    const n = Number.parseFloat(t);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function cellToInt(raw: unknown): number | null {
  const n = cellToNumber(raw);
  if (n == null) return null;
  const i = Math.floor(n);
  return i >= 1 ? i : null;
}

export function cellToText(raw: unknown): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  return s || null;
}

/**
 * Apply numeric / size fields from a patch onto an order KP snapshot.
 *
 * Narrow mapping (intentional asymmetry vs sourcing):
 * - Merges: dims (length/width/height mm), weightKg, volume (m³ via volumeLiters key).
 * - **Ignores** Excel `description` and model name — order KP keeps catalog snapshot meta.
 * - Sourcing import merges `description` on the line DTO; orders do not.
 */
export function mergePatchIntoOrderSnapshot(
  snapshot: unknown,
  patch: PiExcelLinePatch,
): Record<string, unknown> {
  const out = { ...(snapshotAsRecord(snapshot) ?? {}) };
  const dims = parseDimsMm(patch.productSizeMm);
  if (dims.lengthMm != null) out.lengthMm = dims.lengthMm;
  if (dims.widthMm != null) out.widthMm = dims.widthMm;
  if (dims.heightMm != null) out.heightMm = dims.heightMm;
  if (patch.weightKg != null && patch.weightKg > 0) out.weightKg = patch.weightKg;
  if (patch.volumeM3 != null && patch.volumeM3 > 0) {
    setOrderSnapshotVolumeM3(out, patch.volumeM3);
  }
  return out;
}

export function pushFieldChange(
  fields: { field: string; before: string | number | null; after: string | number | null }[],
  field: string,
  before: string | number | null | undefined,
  after: string | number | null | undefined,
) {
  const b = before ?? null;
  const a = after ?? null;
  if (b === a) return;
  if (typeof b === 'number' && typeof a === 'number' && Math.abs(b - a) < 1e-9) return;
  fields.push({ field, before: b, after: a });
}
