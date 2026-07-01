import { describe, expect, it } from 'vitest';
import {
  TYPICAL_SOURCING_VOLUME_M3,
  TYPICAL_SOURCING_WEIGHT_KG,
  type PricingProfileCalcInput,
} from './pricing-calculation';
import {
  batchForwardRetailFromProfileCalc,
  forwardRetailFromProfileCalc,
  reverseRetailToCnyFromProfileCalc,
} from './sourcing-kp-pricing-calc';

const sampleProfile: PricingProfileCalcInput = {
  containerType: '40',
  cnyRate: 11.5,
  usdRate: 79,
  eurRate: 91,
  transferCommissionPct: 4,
  customsAdValoremPct: 10,
  customsWeightPct: 8,
  vatPct: 22,
  markupPct: 25,
  agentRub: 50000,
  warehousePortUsd: 950,
  fobUsd: 4000,
  portMskRub: 280000,
  extraLogisticsRub: 141000,
};

describe('reverseRetailToCnyFromProfileCalc', () => {
  it('¥ от типовых габаритов; forward-check на пользовательских', () => {
    const budget = 50_000;
    const reverse = reverseRetailToCnyFromProfileCalc(sampleProfile, { retailRub: budget });
    expect(reverse.ok).toBe(true);
    if (!reverse.ok) return;

    expect(reverse.typicalWeightKg).toBe(TYPICAL_SOURCING_WEIGHT_KG);
    expect(reverse.typicalVolumeM3).toBe(TYPICAL_SOURCING_VOLUME_M3);
    expect(reverse.retailAtDims).toBeCloseTo(budget, -2);

    const heavy = reverseRetailToCnyFromProfileCalc(sampleProfile, {
      retailRub: budget,
      weightKg: 100,
      volumeM3: 0.15,
    });
    expect(heavy.ok).toBe(true);
    if (!heavy.ok) return;
    expect(heavy.fitsBudget).toBe(false);
    expect(heavy.retailAtDims).toBeGreaterThan(budget);
  });
});

describe('batchForwardRetailFromProfileCalc', () => {
  it('считает несколько строк без повторной загрузки профиля', () => {
    const lines = [
      { costPriceCny: 5000, weightKg: 30, volumeM3: 0.15 },
      { costPriceCny: 8000, weightKg: 30, volumeM3: 0.15 },
    ];
    const results = batchForwardRetailFromProfileCalc(sampleProfile, lines);
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.ok)).toBe(true);
    if (!results[0]?.ok || !results[1]?.ok) return;
    expect(results[1].retailRub).toBeGreaterThan(results[0].retailRub);
  });

  it('совпадает с одиночным forward', () => {
    const input = { costPriceCny: 5000, weightKg: 30, volumeM3: 0.15 };
    const single = forwardRetailFromProfileCalc(sampleProfile, input);
    const batch = batchForwardRetailFromProfileCalc(sampleProfile, [input])[0];
    expect(batch).toEqual(single);
  });
});

describe('budget → reverse → forward (сквозной calc)', () => {
  it('init KP line: budget → ¥ → ₽', () => {
    const budget = 50_000;
    const reverse = reverseRetailToCnyFromProfileCalc(sampleProfile, { retailRub: budget });
    expect(reverse.ok).toBe(true);
    if (!reverse.ok) return;

    const forward = forwardRetailFromProfileCalc(sampleProfile, {
      costPriceCny: reverse.costPriceCny,
      weightKg: TYPICAL_SOURCING_WEIGHT_KG,
      volumeM3: TYPICAL_SOURCING_VOLUME_M3,
    });
    expect(forward.ok).toBe(true);
    if (!forward.ok) return;
    expect(forward.retailRub).toBeGreaterThan(0);
    expect(forward.retailRub).toBeCloseTo(budget, -2);
  });
});
