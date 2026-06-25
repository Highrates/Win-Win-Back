"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const product_name_1 = require("./product-name");
(0, vitest_1.describe)('resolveSourcingProductStoredName', () => {
    (0, vitest_1.it)('использует явное имя', () => {
        (0, vitest_1.expect)((0, product_name_1.resolveSourcingProductStoredName)({
            name: '  Диван  ',
            requestTitle: 'Лобби ЖК',
            productIndex: 0,
            productCount: 2,
        })).toBe('Диван');
    });
    (0, vitest_1.it)('для одного товара без name берёт title заявки', () => {
        (0, vitest_1.expect)((0, product_name_1.resolveSourcingProductStoredName)({
            name: '',
            requestTitle: 'Подбор дивана',
            productIndex: 0,
            productCount: 1,
        })).toBe('Подбор дивана');
    });
    (0, vitest_1.it)('для нескольких товаров без name — «Товар N»', () => {
        (0, vitest_1.expect)((0, product_name_1.resolveSourcingProductStoredName)({
            requestTitle: 'Комплект мебели',
            productIndex: 1,
            productCount: 3,
        })).toBe('Товар 2');
    });
});
(0, vitest_1.describe)('resolveSourcingProductDisplayName', () => {
    (0, vitest_1.it)('legacy «—» в БД → «Товар N» или title', () => {
        (0, vitest_1.expect)((0, product_name_1.resolveSourcingProductDisplayName)({
            name: '—',
            requestTitle: 'Подбор дивана',
            productIndex: 0,
            productCount: 1,
        })).toBe('Подбор дивана');
        (0, vitest_1.expect)((0, product_name_1.resolveSourcingProductDisplayName)({
            name: '—',
            requestTitle: 'Комплект',
            productIndex: 1,
            productCount: 2,
        })).toBe('Товар 2');
    });
});
