import { describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import {
  referralProgramRewardsInputsChanged,
  referralProgramRewardsInputsFromProfile,
} from './referral-program-rewards.util';

describe('referralProgramRewardsInputs', () => {
  const base = {
    enabled: true,
    level1Percent: new Prisma.Decimal(5),
    level2Percent: new Prisma.Decimal(3),
    minimumOrderSiteTotalRub: 10_000,
  };

  it('fromProfile нормализует Decimal', () => {
    expect(referralProgramRewardsInputsFromProfile(base)).toEqual({
      enabled: true,
      level1Percent: 5,
      level2Percent: 3,
      minimumOrderSiteTotalRub: 10_000,
    });
  });

  it('changed: false при смене только name (вне inputs)', () => {
    const before = referralProgramRewardsInputsFromProfile(base);
    const after = referralProgramRewardsInputsFromProfile(base);
    expect(referralProgramRewardsInputsChanged(before, after)).toBe(false);
  });

  it('changed: true при смене enabled', () => {
    const before = referralProgramRewardsInputsFromProfile(base);
    const after = referralProgramRewardsInputsFromProfile({ ...base, enabled: false });
    expect(referralProgramRewardsInputsChanged(before, after)).toBe(true);
  });

  it('changed: true при смене L1', () => {
    const before = referralProgramRewardsInputsFromProfile(base);
    const after = referralProgramRewardsInputsFromProfile({
      ...base,
      level1Percent: new Prisma.Decimal(7),
    });
    expect(referralProgramRewardsInputsChanged(before, after)).toBe(true);
  });
});
