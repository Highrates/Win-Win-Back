import { describe, expect, it } from 'vitest';
import {
  TYPICAL_SOURCING_VOLUME_M3,
  TYPICAL_SOURCING_WEIGHT_KG,
  calcCnyFromRetailRub,
  calcMskAndRetailRub,
  type PricingProfileCalcInput,
} from './pricing-calculation';

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

describe('calcCnyFromRetailRub', () => {
  it('round-trip: CNY → retail → CNY ≈ исходный', () => {
    const product = { costPriceCny: 8500, grossWeightKg: 30, volumeM3: 0.15 };
    const forward = calcMskAndRetailRub(sampleProfile, product);
    const reverse = calcCnyFromRetailRub(sampleProfile, forward.retailRub, product);
    expect(reverse.ok).toBe(true);
    if (!reverse.ok) return;
    expect(reverse.costPriceCny).toBe(product.costPriceCny);
    expect(reverse.retailRub).toBe(forward.retailRub);
  });

  it('использует типовые габариты заявки на подбор', () => {
    const product = {
      costPriceCny: 5000,
      grossWeightKg: TYPICAL_SOURCING_WEIGHT_KG,
      volumeM3: TYPICAL_SOURCING_VOLUME_M3,
    };
    const forward = calcMskAndRetailRub(sampleProfile, product);
    const reverse = calcCnyFromRetailRub(sampleProfile, forward.retailRub, product);
    expect(reverse.ok).toBe(true);
    if (!reverse.ok) return;
    expect(reverse.costPriceCny).toBe(5000);
  });

  it('NEGATIVE_CNY при слишком низком бюджете', () => {
    const r = calcCnyFromRetailRub(sampleProfile, 1000, { costPriceCny: 1, grossWeightKg: 30, volumeM3: 0.15 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('NEGATIVE_CNY');
  });

  it('заявка на подбор: ¥ от типовых габаритов, габариты влияют на розницу', () => {
    const budget = 50_000;
    const reverse = calcCnyFromRetailRub(sampleProfile, budget, {
      costPriceCny: 1,
      grossWeightKg: TYPICAL_SOURCING_WEIGHT_KG,
      volumeM3: TYPICAL_SOURCING_VOLUME_M3,
    });
    expect(reverse.ok).toBe(true);
    if (!reverse.ok) return;

    const forwardHeavy = calcMskAndRetailRub(sampleProfile, {
      costPriceCny: reverse.costPriceCny,
      grossWeightKg: 100,
      volumeM3: 0.15,
    });
    const forwardLargeVol = calcMskAndRetailRub(sampleProfile, {
      costPriceCny: reverse.costPriceCny,
      grossWeightKg: 30,
      volumeM3: 0.6,
    });

    expect(forwardHeavy.retailRub).toBeGreaterThan(budget);
    expect(forwardLargeVol.retailRub).toBeGreaterThan(budget);
  });
});
