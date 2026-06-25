"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SOURCING_LIST_MAX_LIMIT = exports.SOURCING_LIST_DEFAULT_LIMIT = exports.SOURCING_UNIT_OPTIONS = exports.SOURCING_BUDGET_MAX = exports.SOURCING_PRODUCT_LINK_MAX = exports.SOURCING_PRODUCT_FIELD_MAX = exports.SOURCING_PRODUCT_DESCRIPTION_MAX = exports.SOURCING_PRODUCT_NAME_MAX = exports.SOURCING_CITY_MAX = exports.SOURCING_TITLE_MAX = exports.SOURCING_FILE_KEY_MAX = exports.SOURCING_MAX_ATTACHMENT_KEYS = exports.SOURCING_MAX_REFERENCE_KEYS_PER_PRODUCT = exports.SOURCING_MAX_PRODUCTS = exports.SOURCING_UPLOAD_TOTAL_MAX_BYTES = exports.SOURCING_MAX_FILES = exports.SOURCING_FILE_MAX_BYTES = void 0;
exports.clampSourcingListPage = clampSourcingListPage;
exports.clampSourcingListLimit = clampSourcingListLimit;
/** Лимиты заявки на подбор — единый контракт фронт / Nest. */
exports.SOURCING_FILE_MAX_BYTES = 15 * 1024 * 1024;
exports.SOURCING_MAX_FILES = 50;
exports.SOURCING_UPLOAD_TOTAL_MAX_BYTES = 100 * 1024 * 1024;
exports.SOURCING_MAX_PRODUCTS = 50;
exports.SOURCING_MAX_REFERENCE_KEYS_PER_PRODUCT = 20;
exports.SOURCING_MAX_ATTACHMENT_KEYS = 50;
exports.SOURCING_FILE_KEY_MAX = 128;
exports.SOURCING_TITLE_MAX = 200;
exports.SOURCING_CITY_MAX = 200;
exports.SOURCING_PRODUCT_NAME_MAX = 200;
exports.SOURCING_PRODUCT_DESCRIPTION_MAX = 5000;
exports.SOURCING_PRODUCT_FIELD_MAX = 500;
exports.SOURCING_PRODUCT_LINK_MAX = 2048;
exports.SOURCING_BUDGET_MAX = 32;
exports.SOURCING_UNIT_OPTIONS = [
    'шт',
    'комплект',
    'м²',
    'м.п.',
    'кг',
    'упак.',
    'пара',
    'лист',
    'м³',
    'т',
];
exports.SOURCING_LIST_DEFAULT_LIMIT = 20;
exports.SOURCING_LIST_MAX_LIMIT = 100;
function clampSourcingListPage(page) {
    return Math.max(Number.isFinite(page) ? page : 1, 1);
}
function clampSourcingListLimit(limit) {
    const n = Number.isFinite(limit) ? limit : exports.SOURCING_LIST_DEFAULT_LIMIT;
    return Math.min(Math.max(n, 1), exports.SOURCING_LIST_MAX_LIMIT);
}
