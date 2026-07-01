/** Типовые габариты для обратного расчёта ¥ из бюджета заявки на подбор. */
export declare const TYPICAL_SOURCING_WEIGHT_KG = 30;
export declare const TYPICAL_SOURCING_VOLUME_M3 = 0.15;
/** Только цифры бюджета (для состояния формы / API). */
export declare function parseBudgetDigits(raw: string): string;
/** Бюджет → розничная сумма в ₽ (целое). Принимает строку с цифрами, число или Decimal-like. */
export declare function parseExpectedBudgetRetailRub(raw: string | number | {
    toString(): string;
} | null | undefined): number | null;
/** Вес/объём строки КП: явные значения или типовые для заявки на подбор. */
export declare function resolveSourcingTypicalDims(grossWeightKg?: number | null, volumeM3?: number | null): {
    weightKg: number;
    volumeM3: number;
};
export type SourcingKpLineForTotal = {
    quantity: number;
    offerUnitPrice: number;
};
export declare function sourcingKpLineTotalRub(line: SourcingKpLineForTotal): number;
export declare function sourcingKpOrderTotalRub(lines: SourcingKpLineForTotal[]): number;
/** Сумма предложения для списка заявок (без скидок). */
export declare function sourcingCommercialProposalOfferTotalRub(lines: Array<{
    quantity: number;
    offerUnitPrice: number;
}> | null | undefined): number | null;
