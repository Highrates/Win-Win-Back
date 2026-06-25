"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const product_validation_1 = require("./product-validation");
(0, vitest_1.describe)('isProductMinimallyFilled', () => {
    (0, vitest_1.it)('false when all fields empty', () => {
        (0, vitest_1.expect)((0, product_validation_1.isProductMinimallyFilled)({})).toBe(false);
        (0, vitest_1.expect)((0, product_validation_1.isProductMinimallyFilled)({ name: '  ', referenceCount: 0 })).toBe(false);
    });
    (0, vitest_1.it)('true when any signal present', () => {
        (0, vitest_1.expect)((0, product_validation_1.isProductMinimallyFilled)({ name: 'Стул' })).toBe(true);
        (0, vitest_1.expect)((0, product_validation_1.isProductMinimallyFilled)({ description: 'Описание' })).toBe(true);
        (0, vitest_1.expect)((0, product_validation_1.isProductMinimallyFilled)({ productLink: 'https://shop.test/item' })).toBe(true);
        (0, vitest_1.expect)((0, product_validation_1.isProductMinimallyFilled)({ referenceCount: 1 })).toBe(true);
    });
});
(0, vitest_1.describe)('isSoftValidProductLink', () => {
    (0, vitest_1.it)('accepts empty', () => {
        (0, vitest_1.expect)((0, product_validation_1.isSoftValidProductLink)('')).toBe(true);
        (0, vitest_1.expect)((0, product_validation_1.isSoftValidProductLink)(undefined)).toBe(true);
    });
    (0, vitest_1.it)('accepts host with dot', () => {
        (0, vitest_1.expect)((0, product_validation_1.isSoftValidProductLink)('shop.example.com/item')).toBe(true);
        (0, vitest_1.expect)((0, product_validation_1.isSoftValidProductLink)('https://shop.example.com')).toBe(true);
    });
    (0, vitest_1.it)('rejects invalid urls', () => {
        (0, vitest_1.expect)((0, product_validation_1.isSoftValidProductLink)('not a url')).toBe(false);
        (0, vitest_1.expect)((0, product_validation_1.isSoftValidProductLink)('localhost')).toBe(false);
    });
});
