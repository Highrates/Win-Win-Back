import { describe, expect, it } from 'vitest';
import {
  parseBudgetDigits,
  parseExpectedBudgetRetailRub,
  resolveSourcingTypicalDims,
  sourcingKpLineTotalRub,
  sourcingKpOrderTotalRub,
  TYPICAL_SOURCING_VOLUME_M3,
  TYPICAL_SOURCING_WEIGHT_KG,
} from './sourcing-kp-pricing';

describe('parseBudgetDigits', () => {
  it('оставляет только цифры', () => {
    expect(parseBudgetDigits('50 000 ₽')).toBe('50000');
  });
});

describe('parseExpectedBudgetRetailRub', () => {
  it('парсит строку с пробелами', () => {
    expect(parseExpectedBudgetRetailRub('50 000')).toBe(50000);
  });

  it('округляет число', () => {
    expect(parseExpectedBudgetRetailRub(50000.7)).toBe(50001);
  });

  it('парсит Decimal-like', () => {
    expect(parseExpectedBudgetRetailRub({ toString: () => '12000.00' })).toBe(12000);
  });

  it('null для пустого', () => {
    expect(parseExpectedBudgetRetailRub('')).toBeNull();
    expect(parseExpectedBudgetRetailRub(null)).toBeNull();
  });
});

describe('resolveSourcingTypicalDims', () => {
  it('возвращает типовые при null', () => {
    expect(resolveSourcingTypicalDims(null, null)).toEqual({
      weightKg: TYPICAL_SOURCING_WEIGHT_KG,
      volumeM3: TYPICAL_SOURCING_VOLUME_M3,
    });
  });

  it('сохраняет явные значения', () => {
    expect(resolveSourcingTypicalDims(12, 0.05)).toEqual({ weightKg: 12, volumeM3: 0.05 });
  });
});

describe('sourcingKp totals', () => {
  it('считает строку и заказ', () => {
    expect(sourcingKpLineTotalRub({ quantity: 3, offerUnitPrice: 1000.005 })).toBe(3000.02);
    expect(
      sourcingKpOrderTotalRub([
        { quantity: 2, offerUnitPrice: 100 },
        { quantity: 1, offerUnitPrice: 50 },
      ]),
    ).toBe(250);
  });
});
