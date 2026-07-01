import {
  calcCnyFromRetailRub,
  calcMskAndRetailRub,
  TYPICAL_SOURCING_VOLUME_M3,
  TYPICAL_SOURCING_WEIGHT_KG,
  type PricingProfileCalcInput,
} from './pricing-calculation';

export type ForwardRetailFromProfileResult =
  | { ok: true; retailRub: number; mskRub: number; shareS: number }
  | { ok: false; error: 'INVALID_INPUT' };

export type ReverseRetailToCnyFromProfileResult =
  | {
      ok: true;
      costPriceCny: number;
      mskRub: number;
      retailRub: number;
      retailAtDims: number;
      fitsBudget: boolean;
      shareS: number;
      weightKg: number;
      volumeM3: number;
      typicalWeightKg: number;
      typicalVolumeM3: number;
    }
  | { ok: false; error: 'INVALID_INPUT' | 'NEGATIVE_CNY' };

export function forwardRetailFromProfileCalc(
  calcIn: PricingProfileCalcInput,
  dto: { costPriceCny: number; weightKg: number; volumeM3: number },
): ForwardRetailFromProfileResult {
  const { costPriceCny, weightKg, volumeM3 } = dto;
  if (
    !Number.isFinite(costPriceCny) ||
    costPriceCny < 0 ||
    !Number.isFinite(weightKg) ||
    weightKg <= 0 ||
    !Number.isFinite(volumeM3) ||
    volumeM3 <= 0
  ) {
    return { ok: false, error: 'INVALID_INPUT' };
  }
  const { retailRub, mskRub, shareS } = calcMskAndRetailRub(calcIn, {
    costPriceCny,
    grossWeightKg: weightKg,
    volumeM3,
  });
  return { ok: true, retailRub, mskRub, shareS };
}

export function reverseRetailToCnyFromProfileCalc(
  calcIn: PricingProfileCalcInput,
  dto: { retailRub: number; weightKg?: number; volumeM3?: number },
): ReverseRetailToCnyFromProfileResult {
  const weightKg = dto.weightKg ?? TYPICAL_SOURCING_WEIGHT_KG;
  const volumeM3 = dto.volumeM3 ?? TYPICAL_SOURCING_VOLUME_M3;
  if (
    !Number.isFinite(dto.retailRub) ||
    dto.retailRub <= 0 ||
    !Number.isFinite(weightKg) ||
    weightKg <= 0 ||
    !Number.isFinite(volumeM3) ||
    volumeM3 <= 0
  ) {
    return { ok: false, error: 'INVALID_INPUT' };
  }

  const reverseAtTypical = calcCnyFromRetailRub(calcIn, dto.retailRub, {
    costPriceCny: 1,
    grossWeightKg: TYPICAL_SOURCING_WEIGHT_KG,
    volumeM3: TYPICAL_SOURCING_VOLUME_M3,
  });
  if (!reverseAtTypical.ok) {
    return {
      ok: false,
      error: reverseAtTypical.reason === 'NEGATIVE_CNY' ? 'NEGATIVE_CNY' : 'INVALID_INPUT',
    };
  }

  const costPriceCny = reverseAtTypical.costPriceCny;
  const forwardAtDims = calcMskAndRetailRub(calcIn, {
    costPriceCny,
    grossWeightKg: weightKg,
    volumeM3,
  });

  return {
    ok: true,
    costPriceCny,
    mskRub: forwardAtDims.mskRub,
    retailRub: dto.retailRub,
    retailAtDims: forwardAtDims.retailRub,
    fitsBudget: forwardAtDims.retailRub <= dto.retailRub,
    shareS: forwardAtDims.shareS,
    weightKg,
    volumeM3,
    typicalWeightKg: TYPICAL_SOURCING_WEIGHT_KG,
    typicalVolumeM3: TYPICAL_SOURCING_VOLUME_M3,
  };
}

export type SourcingKpForwardLineInput = {
  costPriceCny: number;
  weightKg: number;
  volumeM3: number;
};

export function batchForwardRetailFromProfileCalc(
  calcIn: PricingProfileCalcInput,
  lines: SourcingKpForwardLineInput[],
): ForwardRetailFromProfileResult[] {
  return lines.map((line) => forwardRetailFromProfileCalc(calcIn, line));
}
