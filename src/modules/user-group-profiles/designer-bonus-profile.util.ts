import type { Prisma } from '@prisma/client';

export type DesignerBonusMirrorInputs = {
  designerOwnCatalogBonusPercent: number;
  designerOwnMinimumCatalogSiteTotalRub: number;
};

function toPercent(value: Prisma.Decimal | number): number {
  return typeof value === 'number' ? value : value.toNumber();
}

export function designerBonusMirrorInputsFromProfile(row: {
  designerOwnCatalogBonusPercent: Prisma.Decimal | number;
  designerOwnMinimumCatalogSiteTotalRub: number;
}): DesignerBonusMirrorInputs {
  return {
    designerOwnCatalogBonusPercent: toPercent(row.designerOwnCatalogBonusPercent),
    designerOwnMinimumCatalogSiteTotalRub: row.designerOwnMinimumCatalogSiteTotalRub,
  };
}

export function designerBonusMirrorInputsChanged(
  before: DesignerBonusMirrorInputs,
  after: DesignerBonusMirrorInputs,
): boolean {
  return (
    before.designerOwnCatalogBonusPercent !== after.designerOwnCatalogBonusPercent ||
    before.designerOwnMinimumCatalogSiteTotalRub !== after.designerOwnMinimumCatalogSiteTotalRub
  );
}
