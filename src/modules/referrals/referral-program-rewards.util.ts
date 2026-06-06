import type { Prisma } from '@prisma/client';

/** Поля профиля, влияющие на расчёт ReferralReward. */
export type ReferralProgramRewardsInputs = {
  enabled: boolean;
  level1Percent: number;
  level2Percent: number;
  minimumOrderSiteTotalRub: number;
};

function toPercent(value: Prisma.Decimal | number): number {
  return typeof value === 'number' ? value : value.toNumber();
}

export function referralProgramRewardsInputsFromProfile(row: {
  enabled: boolean;
  level1Percent: Prisma.Decimal | number;
  level2Percent: Prisma.Decimal | number;
  minimumOrderSiteTotalRub: number;
}): ReferralProgramRewardsInputs {
  return {
    enabled: row.enabled,
    level1Percent: toPercent(row.level1Percent),
    level2Percent: toPercent(row.level2Percent),
    minimumOrderSiteTotalRub: row.minimumOrderSiteTotalRub,
  };
}

export function referralProgramRewardsInputsChanged(
  before: ReferralProgramRewardsInputs,
  after: ReferralProgramRewardsInputs,
): boolean {
  return (
    before.enabled !== after.enabled ||
    before.level1Percent !== after.level1Percent ||
    before.level2Percent !== after.level2Percent ||
    before.minimumOrderSiteTotalRub !== after.minimumOrderSiteTotalRub
  );
}
