"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const sourcing_kp_pricing_1 = require("./sourcing-kp-pricing");
(0, vitest_1.describe)('parseBudgetDigits', () => {
    (0, vitest_1.it)('оставляет только цифры', () => {
        (0, vitest_1.expect)((0, sourcing_kp_pricing_1.parseBudgetDigits)('50 000 ₽')).toBe('50000');
    });
});
(0, vitest_1.describe)('parseExpectedBudgetRetailRub', () => {
    (0, vitest_1.it)('парсит строку с пробелами', () => {
        (0, vitest_1.expect)((0, sourcing_kp_pricing_1.parseExpectedBudgetRetailRub)('50 000')).toBe(50000);
    });
    (0, vitest_1.it)('округляет число', () => {
        (0, vitest_1.expect)((0, sourcing_kp_pricing_1.parseExpectedBudgetRetailRub)(50000.7)).toBe(50001);
    });
    (0, vitest_1.it)('парсит Decimal-like', () => {
        (0, vitest_1.expect)((0, sourcing_kp_pricing_1.parseExpectedBudgetRetailRub)({ toString: () => '12000.00' })).toBe(12000);
    });
    (0, vitest_1.it)('null для пустого', () => {
        (0, vitest_1.expect)((0, sourcing_kp_pricing_1.parseExpectedBudgetRetailRub)('')).toBeNull();
        (0, vitest_1.expect)((0, sourcing_kp_pricing_1.parseExpectedBudgetRetailRub)(null)).toBeNull();
    });
});
(0, vitest_1.describe)('resolveSourcingTypicalDims', () => {
    (0, vitest_1.it)('возвращает типовые при null', () => {
        (0, vitest_1.expect)((0, sourcing_kp_pricing_1.resolveSourcingTypicalDims)(null, null)).toEqual({
            weightKg: sourcing_kp_pricing_1.TYPICAL_SOURCING_WEIGHT_KG,
            volumeM3: sourcing_kp_pricing_1.TYPICAL_SOURCING_VOLUME_M3,
        });
    });
    (0, vitest_1.it)('сохраняет явные значения', () => {
        (0, vitest_1.expect)((0, sourcing_kp_pricing_1.resolveSourcingTypicalDims)(12, 0.05)).toEqual({ weightKg: 12, volumeM3: 0.05 });
    });
});
(0, vitest_1.describe)('sourcingKp totals', () => {
    (0, vitest_1.it)('считает строку и заказ', () => {
        (0, vitest_1.expect)((0, sourcing_kp_pricing_1.sourcingKpLineTotalRub)({ quantity: 3, offerUnitPrice: 1000.005 })).toBe(3000.02);
        (0, vitest_1.expect)((0, sourcing_kp_pricing_1.sourcingKpOrderTotalRub)([
            { quantity: 2, offerUnitPrice: 100 },
            { quantity: 1, offerUnitPrice: 50 },
        ])).toBe(250);
    });
});
