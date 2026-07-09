import type { AdminSectionId } from './constants';
import type { AdminNavLabelKey } from './nav-manifest';

const LABELS_RU: Record<AdminSectionId, string> = {
  dashboard: 'Дашборд',
  catalog: 'Каталог',
  brands: 'Бренды',
  orders: 'Заказы',
  applications: 'Заявки',
  clients: 'Пользователи',
  objects: 'Медиафайлы',
  blog: 'Блог',
  journal: 'Журнал',
  settings: 'Настройки',
};

const LABELS_ZH: Record<AdminSectionId, string> = {
  dashboard: '仪表板',
  catalog: '目录',
  brands: '品牌',
  orders: '订单',
  applications: '申请',
  clients: '用户',
  objects: '媒体文件',
  blog: '博客',
  journal: '日志',
  settings: '设置',
};

const NAV_EXTRA_RU: Record<Exclude<AdminNavLabelKey, AdminSectionId>, string> = {
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

const NAV_EXTRA_ZH: Record<Exclude<AdminNavLabelKey, AdminSectionId>, string> = {
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

export function adminSectionLabel(
  id: AdminSectionId,
  locale: 'ru' | 'zh' = 'ru',
): string {
  return locale === 'zh' ? LABELS_ZH[id] : LABELS_RU[id];
}

export function adminNavLabel(labelKey: AdminNavLabelKey, locale: 'ru' | 'zh' = 'ru'): string {
  if (labelKey in LABELS_RU) {
    return adminSectionLabel(labelKey as AdminSectionId, locale);
  }
  const extra = locale === 'zh' ? NAV_EXTRA_ZH : NAV_EXTRA_RU;
  return extra[labelKey as Exclude<AdminNavLabelKey, AdminSectionId>];
}

export function adminSectionCatalog(locale: 'ru' | 'zh' = 'ru'): Array<{ id: AdminSectionId; label: string }> {
  return (Object.keys(LABELS_RU) as AdminSectionId[]).map((id) => ({
    id,
    label: adminSectionLabel(id, locale),
  }));
}
