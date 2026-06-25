"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveSourcingProductStoredName = resolveSourcingProductStoredName;
exports.resolveSourcingProductDisplayName = resolveSourcingProductDisplayName;
const limits_1 = require("./limits");
/** Имя позиции в БД: явное name → для одного товара title заявки → «Товар N». */
function resolveSourcingProductStoredName(params) {
    const trimmed = params.name?.trim();
    if (trimmed)
        return trimmed.slice(0, limits_1.SOURCING_PRODUCT_NAME_MAX);
    const title = params.requestTitle.trim();
    if (params.productCount === 1 && title) {
        return title.slice(0, limits_1.SOURCING_PRODUCT_NAME_MAX);
    }
    return `Товар ${params.productIndex + 1}`;
}
/** UI/админка: пустое имя и legacy «—» → те же правила, что при сохранении в БД. */
function resolveSourcingProductDisplayName(params) {
    const trimmed = params.name?.trim();
    if (trimmed && trimmed !== '—')
        return trimmed;
    return resolveSourcingProductStoredName({
        name: '',
        requestTitle: params.requestTitle,
        productIndex: params.productIndex,
        productCount: params.productCount,
    });
}
