import { describe, expect, it } from 'vitest';
import {
  buildOrderMatchKey,
  buildSourcingMatchKey,
  formatDimsMm,
  mergePatchIntoOrderSnapshot,
  ORDER_SNAPSHOT_VOLUME_M3_KEY,
  orderItemToExportLine,
  parseDimsMm,
  parseMatchKey,
  volumeM3FromOrderSnapshot,
} from './pi-excel-map';
import { matchOrderPatches, matchSourcingPatches } from './pi-excel-merge';
import type { PiExcelLinePatch } from './pi-excel.types';

describe('pi-excel-map', () => {
  it('builds and parses match keys', () => {
    expect(buildOrderMatchKey({ sourceOrderItemId: 'abc', no: 1 })).toBe('OI:abc');
    const fx = buildOrderMatchKey({ productId: 'p1', productName: 'Chair', no: 2 });
    expect(fx).toMatch(/^FX:[a-f0-9]{8}$/);
    // reorder-safe: same product → same FX regardless of No
    expect(buildOrderMatchKey({ productId: 'p1', productName: 'Chair', no: 99 })).toBe(fx);
    expect(buildOrderMatchKey({ no: 3 })).toBe('N:3');
    expect(buildSourcingMatchKey({ sourceSourcingRequestItemId: 's1', no: 1 })).toBe('SL:s1');
    expect(buildSourcingMatchKey({ productName: 'Widget', no: 5 })).toMatch(/^FX:[a-f0-9]{8}$/);
    expect(parseMatchKey('OI:xyz')).toEqual({ kind: 'OI', id: 'xyz' });
    expect(parseMatchKey('N:4')).toEqual({ kind: 'N', n: 4 });
    expect(parseMatchKey('FX:deadbeef')).toEqual({ kind: 'FX', hash: 'deadbeef' });
    expect(parseMatchKey('FX:2:deadbeef')).toEqual({
      kind: 'FX',
      hash: 'deadbeef',
      legacySortOrder: 2,
    });
    expect(parseMatchKey('')).toBeNull();
  });

  it('parses dims', () => {
    expect(formatDimsMm(730, 550, 540)).toBe('730*550*540');
    expect(parseDimsMm('730×550×540 mm')).toEqual({
      lengthMm: 730,
      widthMm: 550,
      heightMm: 540,
    });
  });

  it('merges patch into snapshot', () => {
    const snap = mergePatchIntoOrderSnapshot(
      { productName: 'Chair', weightKg: 1 },
      {
        excelRow: 12,
        no: 1,
        matchKey: 'N:1',
        quantity: 2,
        unitPrice: 100,
        description: null,
        productSizeMm: '100*200*300',
        weightKg: 7.5,
        volumeM3: 0.2,
        modelName: null,
      },
    );
    expect(snap).toMatchObject({
      productName: 'Chair',
      lengthMm: 100,
      widthMm: 200,
      heightMm: 300,
      weightKg: 7.5,
      volumeLiters: 0.2,
    });
  });

  it('volume: snapshot m³ ↔ Excel m³ round-trip (legacy key volumeLiters)', () => {
    const knownM3 = 0.289;
    const snap = { [ORDER_SNAPSHOT_VOLUME_M3_KEY]: knownM3, productName: 'X' };
    expect(volumeM3FromOrderSnapshot(snap)).toBe(knownM3);

    const line = orderItemToExportLine({
      no: 1,
      itemId: 'oi-1',
      quantity: 1,
      unitPriceCny: 10,
      snapshot: snap,
    });
    expect(line.volumeM3).toBe(knownM3);

    const merged = mergePatchIntoOrderSnapshot(snap, {
      excelRow: 12,
      no: 1,
      matchKey: 'OI:oi-1',
      quantity: 1,
      unitPrice: 10,
      description: null,
      productSizeMm: null,
      weightKg: null,
      volumeM3: knownM3,
      modelName: null,
    });
    expect(merged[ORDER_SNAPSHOT_VOLUME_M3_KEY]).toBe(knownM3);
    expect(volumeM3FromOrderSnapshot(merged)).toBe(knownM3);
  });
});

describe('pi-excel-merge', () => {
  const patch = (over: Partial<PiExcelLinePatch>): PiExcelLinePatch => ({
    excelRow: 12,
    no: 1,
    matchKey: null,
    quantity: 5,
    unitPrice: 10,
    description: null,
    productSizeMm: null,
    weightKg: null,
    volumeM3: null,
    modelName: null,
    ...over,
  });

  it('matches order lines by OI and No', () => {
    const lines = [
      {
        id: 'kl-a',
        sourceOrderItemId: 'oi-1',
        sortOrder: 0,
        productId: 'p1',
        productVariantId: null,
        quantity: 1,
        unit: 'шт',
        snapshot: null,
        offerUnitPrice: 1,
        discountPercent: null,
        deliveryEta: null,
        lineNote: null,
      },
      {
        id: 'kl-b',
        sourceOrderItemId: null,
        sortOrder: 1,
        productId: 'p2',
        productVariantId: null,
        quantity: 2,
        unit: 'шт',
        snapshot: null,
        offerUnitPrice: 2,
        discountPercent: null,
        deliveryEta: null,
        lineNote: null,
      },
    ];
    const { pairs, unmatched } = matchOrderPatches(lines, [
      patch({ matchKey: 'OI:oi-1', excelRow: 12 }),
      patch({ no: 2, matchKey: null, excelRow: 13 }),
    ]);
    expect(unmatched).toEqual([]);
    expect(pairs.map((p) => p.line.id)).toEqual(['kl-a', 'kl-b']);
  });

  it('soft-reports unmatched excel rows without throwing', () => {
    const result = matchOrderPatches(
      [
        {
          id: 'kl-a',
          sourceOrderItemId: 'oi-1',
          sortOrder: 0,
          productId: 'p1',
          productVariantId: null,
          quantity: 1,
          unit: 'шт',
          snapshot: null,
          offerUnitPrice: 1,
          discountPercent: null,
          deliveryEta: null,
          lineNote: null,
        },
      ],
      [
        patch({ matchKey: 'OI:oi-1', excelRow: 12 }),
        patch({ matchKey: 'OI:missing', no: 99, excelRow: 13 }),
      ],
    );
    expect(result.pairs).toHaveLength(1);
    expect(result.unmatched).toHaveLength(1);
    expect(result.unmatched[0]).toMatch(/строка Excel 13/);
  });

  it('matches sourcing by SL', () => {
    const { pairs, unmatched } = matchSourcingPatches(
      [
        {
          id: 'l1',
          sourceSourcingRequestItemId: 'si-1',
          sortOrder: 0,
          productName: 'A',
          description: null,
          imageUrls: [],
          quantity: 1,
          unit: 'шт',
          costPriceCny: 10,
          grossWeightKg: null,
          volumeM3: null,
          offerUnitPrice: 100,
          deliveryEta: null,
        },
      ],
      [patch({ matchKey: 'SL:si-1' })],
    );
    expect(unmatched).toEqual([]);
    expect(pairs[0]!.line.id).toBe('l1');
  });

  it('published KL: key does not match new draft line ids (soft unmatched)', () => {
    const result = matchOrderPatches(
      [
        {
          id: 'new-draft-line-id',
          sourceOrderItemId: null,
          sortOrder: 0,
          productId: 'p1',
          productVariantId: null,
          quantity: 1,
          unit: 'шт',
          snapshot: { productName: 'X' },
          offerUnitPrice: 10,
          discountPercent: null,
          deliveryEta: null,
          lineNote: null,
        },
      ],
      [patch({ matchKey: 'KL:old-published-line-id', no: null, excelRow: 12 })],
    );
    expect(result.pairs).toEqual([]);
    expect(result.unmatched).toHaveLength(1);
  });

  it('duplicate excel match on same draft line → second unmatched', () => {
    const result = matchOrderPatches(
      [
        {
          id: 'kl-a',
          sourceOrderItemId: 'oi-1',
          sortOrder: 0,
          productId: 'p1',
          productVariantId: null,
          quantity: 1,
          unit: 'шт',
          snapshot: null,
          offerUnitPrice: 1,
          discountPercent: null,
          deliveryEta: null,
          lineNote: null,
        },
      ],
      [
        patch({ matchKey: 'OI:oi-1', excelRow: 12 }),
        patch({ matchKey: 'OI:oi-1', excelRow: 13 }),
      ],
    );
    expect(result.pairs).toHaveLength(1);
    expect(result.unmatched[0]).toMatch(/уже сопоставлена/);
  });

  it('FX key matches freeform order line without sourceOrderItemId', () => {
    const key = buildOrderMatchKey({ productId: 'p9', productName: 'Free', no: 1 });
    const result = matchOrderPatches(
      [
        {
          id: 'kl-free',
          sourceOrderItemId: null,
          sortOrder: 0,
          productId: 'p9',
          productVariantId: null,
          quantity: 1,
          unit: 'шт',
          snapshot: { productName: 'Free' },
          offerUnitPrice: 1,
          discountPercent: null,
          deliveryEta: null,
          lineNote: null,
        },
      ],
      [patch({ matchKey: key, excelRow: 12 })],
    );
    expect(result.unmatched).toEqual([]);
    expect(result.pairs[0]!.line.id).toBe('kl-free');
  });

  it('FX hash still matches after draft reorder (sortOrder changed)', () => {
    const key = buildOrderMatchKey({ productId: 'p9', productName: 'Free', no: 1 });
    const result = matchOrderPatches(
      [
        {
          id: 'kl-other',
          sourceOrderItemId: null,
          sortOrder: 0,
          productId: 'p1',
          productVariantId: null,
          quantity: 1,
          unit: 'шт',
          snapshot: { productName: 'Other' },
          offerUnitPrice: 1,
          discountPercent: null,
          deliveryEta: null,
          lineNote: null,
        },
        {
          id: 'kl-free',
          sourceOrderItemId: null,
          sortOrder: 1,
          productId: 'p9',
          productVariantId: null,
          quantity: 1,
          unit: 'шт',
          snapshot: { productName: 'Free' },
          offerUnitPrice: 1,
          discountPercent: null,
          deliveryEta: null,
          lineNote: null,
        },
      ],
      [patch({ matchKey: key, no: 1, excelRow: 12 })],
    );
    expect(result.unmatched).toEqual([]);
    expect(result.pairs[0]!.line.id).toBe('kl-free');
  });

  it('legacy FX:no:hash matches by hash; duplicate hash → first unused', () => {
    const hash = buildOrderMatchKey({ productId: 'p9', productName: 'Dup', no: 1 }).slice(3);
    const result = matchOrderPatches(
      [
        {
          id: 'a',
          sourceOrderItemId: null,
          sortOrder: 0,
          productId: 'p9',
          productVariantId: null,
          quantity: 1,
          unit: 'шт',
          snapshot: { productName: 'Dup' },
          offerUnitPrice: 1,
          discountPercent: null,
          deliveryEta: null,
          lineNote: null,
        },
        {
          id: 'b',
          sourceOrderItemId: null,
          sortOrder: 1,
          productId: 'p9',
          productVariantId: null,
          quantity: 2,
          unit: 'шт',
          snapshot: { productName: 'Dup' },
          offerUnitPrice: 2,
          discountPercent: null,
          deliveryEta: null,
          lineNote: null,
        },
      ],
      [
        patch({ matchKey: `FX:9:${hash}`, excelRow: 12 }),
        patch({ matchKey: `FX:${hash}`, excelRow: 13 }),
      ],
    );
    expect(result.unmatched).toEqual([]);
    expect(result.pairs.map((p) => p.line.id)).toEqual(['a', 'b']);
  });
});
