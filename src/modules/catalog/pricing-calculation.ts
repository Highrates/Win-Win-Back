/**
 * Расчёт по docs/ценообразование.md: доля контейнера, себестоимость МСК, цена с наценкой.
 */

export type PricingProfileCalcInput = {
  containerType: string;
  /** Если оба заданы и > 0: W90/V90 = 0,9 × лимиты; иначе стандарт 40'/20'. */
  containerMaxWeightKg?: number | null;
  containerMaxVolumeM3?: number | null;
  cnyRate: number;
  usdRate: number;
  eurRate: number;
  transferCommissionPct: number;
  customsAdValoremPct: number;
  customsWeightPct: number;
  vatPct: number;
  markupPct: number;
  agentRub: number;
  warehousePortUsd: number;
  fobUsd: number;
  portMskRub: number;
  extraLogisticsRub: number;
};

export type ProductPricingCalcInput = {
  costPriceCny: number;
  grossWeightKg: number;
  volumeM3: number;
};

export function containerW90V90(containerType: string): { w90: number; v90: number } {
  const t = String(containerType).trim();
  if (t === '20') return { w90: 25407, v90: 29.7 };
  return { w90: 24030, v90: 60.3 };
}

export function effectiveW90V90(
  profile: Pick<
    PricingProfileCalcInput,
    'containerType' | 'containerMaxWeightKg' | 'containerMaxVolumeM3'
  >,
): { w90: number; v90: number } {
  const mw = profile.containerMaxWeightKg;
  const mv = profile.containerMaxVolumeM3;
  if (
    mw != null &&
    mv != null &&
    Number.isFinite(mw) &&
    Number.isFinite(mv) &&
    mw > 0 &&
    mv > 0
  ) {
    return { w90: 0.9 * mw, v90: 0.9 * mv };
  }
  return containerW90V90(profile.containerType);
}

/** Доля занятости контейнера одной единицей: max(m/W90, v/V90). */
export function logisticsShareS(
  grossWeightKg: number,
  volumeM3: number,
  profile: Pick<
    PricingProfileCalcInput,
    'containerType' | 'containerMaxWeightKg' | 'containerMaxVolumeM3'
  >,
): number {
  const { w90, v90 } = effectiveW90V90(profile);
  if (w90 <= 0 || v90 <= 0) return 0;
  return Math.max(grossWeightKg / w90, volumeM3 / v90);
}

export function calcMskAndRetailRub(
  profile: PricingProfileCalcInput,
  product: ProductPricingCalcInput,
): { shareS: number; mskRub: number; retailRub: number } {
  const m = product.grossWeightKg;
  const v = product.volumeM3;
  const cny = product.costPriceCny;

  const S = logisticsShareS(m, v, profile);

  const Rc = profile.cnyRate;
  const Ru = profile.usdRate;
  const Re = profile.eurRate;

  const Lsp = profile.warehousePortUsd;
  const Lfob = profile.fobUsd;
  const Lpm = profile.portMskRub;
  const Lex = profile.extraLogisticsRub;

  const Dsp = Lsp * Ru * S;
  const PcnyRub = cny * Rc;
  const Btransfer = PcnyRub + Dsp;
  const k = profile.transferCommissionPct / 100;
  const K = Btransfer * k;
  const Binvoice = Btransfer + K;

  const d = profile.customsAdValoremPct / 100;
  const Tadval = (PcnyRub + Dsp) * d;
  const dm = profile.customsWeightPct / 100;
  const Tweight = m * dm * Re;
  const T = Tadval + Tweight;

  const nv = profile.vatPct / 100;
  const N = Binvoice * nv + profile.agentRub * S;

  const Dfob = Lfob * Ru * S;
  const Dpm = Lpm * S;
  const Dex = Lex * S;

  const Pmsk = Binvoice + T + N + Dfob + Dpm + Dex;

  const u = profile.markupPct / 100;
  const Pretail = Pmsk * (1 + u);

  const mskRub = roundMoney(Pmsk);
  const retailRub = roundMoney(Pretail);

  return { shareS: S, mskRub, retailRub };
}

function roundMoney(x: number): number {
  return Math.round(x);
}
