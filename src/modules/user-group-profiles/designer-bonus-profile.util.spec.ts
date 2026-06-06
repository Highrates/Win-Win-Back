import { describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import {
  designerBonusMirrorInputsChanged,
  designerBonusMirrorInputsFromProfile,
} from './designer-bonus-profile.util';

describe('designerBonusMirrorInputs', () => {
  const base = {
    designerOwnCatalogBonusPercent: new Prisma.Decimal(10),
    designerOwnMinimumCatalogSiteTotalRub: 50_000,
  };

  it('changed: false если ставки те же', () => {
    const before = designerBonusMirrorInputsFromProfile(base);
    const after = designerBonusMirrorInputsFromProfile(base);
    expect(designerBonusMirrorInputsChanged(before, after)).toBe(false);
  });

  it('changed: true при смене процента', () => {
    const before = designerBonusMirrorInputsFromProfile(base);
    const after = designerBonusMirrorInputsFromProfile({
      ...base,
      designerOwnCatalogBonusPercent: new Prisma.Decimal(12),
    });
    expect(designerBonusMirrorInputsChanged(before, after)).toBe(true);
  });
});
