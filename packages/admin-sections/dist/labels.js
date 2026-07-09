"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.adminSectionLabel = adminSectionLabel;
exports.adminNavLabel = adminNavLabel;
exports.adminSectionCatalog = adminSectionCatalog;
const LABELS_RU = {
    dashboard: 'Дашборд',
    catalog: 'Каталог',
    brands: 'Бренды',
    orders: 'Заказы',
    applications: 'Взаимодействия',
    clients: 'Пользователи',
    objects: 'Медиафайлы',
    blog: 'Блог',
    journal: 'Журнал',
    settings: 'Настройки',
};
const LABELS_ZH = {
    dashboard: '仪表板',
    catalog: '目录',
    brands: '品牌',
    orders: '订单',
    applications: '互动',
    clients: '用户',
    objects: '媒体文件',
    blog: '博客',
    journal: '日志',
    settings: '设置',
};
const NAV_EXTRA_RU = {
    products: 'Товары',
    categories: 'Категории',
    collections: 'Коллекции',
    productSets: 'Наборы',
    pricing: 'Ценообразование',
    staff: 'Сотрудники',
    userGroups: 'Группы пользователей',
    referrals: 'Реферальная программа',
    site: 'Настройки сайта',
};
const NAV_EXTRA_ZH = {
    products: '商品',
    categories: '类别',
    collections: '集合',
    productSets: '套装',
    pricing: '定价',
    staff: '员工',
    userGroups: '用户组',
    referrals: '推荐计划',
    site: '网站设置',
};
function adminSectionLabel(id, locale = 'ru') {
    return locale === 'zh' ? LABELS_ZH[id] : LABELS_RU[id];
}
function adminNavLabel(labelKey, locale = 'ru') {
    if (labelKey in LABELS_RU) {
        return adminSectionLabel(labelKey, locale);
    }
    const extra = locale === 'zh' ? NAV_EXTRA_ZH : NAV_EXTRA_RU;
    return extra[labelKey];
}
function adminSectionCatalog(locale = 'ru') {
    return Object.keys(LABELS_RU).map((id) => ({
        id,
        label: adminSectionLabel(id, locale),
    }));
}
