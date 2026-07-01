/** Типовые габариты для обратного расчёта ¥ из бюджета заявки на подбор. */
export const TYPICAL_SOURCING_WEIGHT_KG = 30;
export const TYPICAL_SOURCING_VOLUME_M3 = 0.15;

/** Только цифры бюджета (для состояния формы / API). */
export function parseBudgetDigits(raw: string): string {
  return raw.replace(/\D/g, '');
}

/** Бюджет → розничная сумма в ₽ (целое). Принимает строку с цифрами, число или Decimal-like. */
export function parseExpectedBudgetRetailRub(
  raw: string | number | { toString(): string } | null | undefined,
): number | null {
  if (raw == null) return null;
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || raw <= 0) return null;
    return Math.round(raw);
  }
  const s = String(raw).trim();
  if (!s) return null;
  const numericCandidate = s.replace(/\s/g, '').replace(',', '.');
  if (/^\d+(\.\d+)?$/.test(numericCandidate)) {
    const n = Number(numericCandidate);
    if (Number.isFinite(n) && n > 0) return Math.round(n);
  }
  const digits = s.replace(/\D/g, '');
  if (!digits) return null;
  const n = Number(digits);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

/** Вес/объём строки КП: явные значения или типовые для заявки на подбор. */
export function resolveSourcingTypicalDims(
  grossWeightKg?: number | null,
  volumeM3?: number | null,
): { weightKg: number; volumeM3: number } {
  return {
    weightKg:
      grossWeightKg != null && Number.isFinite(grossWeightKg) && grossWeightKg > 0
        ? grossWeightKg
        : TYPICAL_SOURCING_WEIGHT_KG,
    volumeM3:
      volumeM3 != null && Number.isFinite(volumeM3) && volumeM3 > 0
        ? volumeM3
        : TYPICAL_SOURCING_VOLUME_M3,
  };
}

export type SourcingKpLineForTotal = {
  quantity: number;
  offerUnitPrice: number;
};

export function sourcingKpLineTotalRub(line: SourcingKpLineForTotal): number {
  const unit = Number.isFinite(line.offerUnitPrice) ? line.offerUnitPrice : 0;
  const qty = Number.isFinite(line.quantity) ? line.quantity : 0;
  return Math.round(unit * qty * 100) / 100;
}

export function sourcingKpOrderTotalRub(lines: SourcingKpLineForTotal[]): number {
  let sum = 0;
  for (const line of lines) sum += sourcingKpLineTotalRub(line);
  return Math.round(sum * 100) / 100;
}

/** Сумма предложения для списка заявок (без скидок). */
export function sourcingCommercialProposalOfferTotalRub(
  lines: Array<{ quantity: number; offerUnitPrice: number }> | null | undefined,
): number | null {
  if (!lines?.length) return null;
  const total = sourcingKpOrderTotalRub(lines);
  return total > 0 ? total : null;
}
