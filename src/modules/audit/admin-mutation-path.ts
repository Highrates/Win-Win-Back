/**
 * Префиксы API вида `/{API_PREFIX}/{module}/admin/...` для HTTP-аудита мутаций.
 * При появлении новых админ-разделов добавьте модуль сюда (например `projects`).
 */
export const AUDIT_ADMIN_MODULES = [
  'catalog',
  'orders',
  'blog',
  'pages',
  'referrals',
  'collections',
  'designers',
  'projects',
] as const;

export type AuditAdminModule = (typeof AUDIT_ADMIN_MODULES)[number];

/** Похоже на Prisma cuid (достаточно для извлечения id из URL). */
export function isLikelyCuid(segment: string): boolean {
  return /^c[a-z0-9]{8,}$/i.test(segment) && segment.length >= 12;
}

export function lastLikelyCuid(segments: string[]): string | undefined {
  for (let i = segments.length - 1; i >= 0; i--) {
    if (isLikelyCuid(segments[i])) return segments[i];
  }
  return undefined;
}

export type ParsedAdminMutationPath = {
  module: string;
  entityType: string;
  entityId?: string;
  /** Доп. метка: bulk-delete, reorder, status, … */
  operation?: string;
};

function normalizeApiPrefix(raw: string): string {
  return raw.replace(/^\/+|\/+$/g, '').replace(/\/+/g, '/') || 'api/v1';
}

/** Путь вида /api/v1/catalog/admin/brands/... */
export function adminMutationPathMatches(pathOnly: string, apiPrefixRaw: string): boolean {
  const apiPrefix = normalizeApiPrefix(apiPrefixRaw);
  const p = pathOnly.split('?')[0];
  for (const mod of AUDIT_ADMIN_MODULES) {
    const prefix = `/${apiPrefix}/${mod}/admin`.replace(/\/+/g, '/');
    if (p.startsWith(prefix)) return true;
  }
  return false;
}

function partsAfterAdmin(pathOnly: string, apiPrefixRaw: string): { module: string; rest: string[] } | null {
  const apiPrefix = normalizeApiPrefix(apiPrefixRaw);
  const parts = pathOnly.split('?')[0].split('/').filter(Boolean);
  const prefParts = apiPrefix.split('/').filter(Boolean);
  // parts: ['api','v1','catalog','admin', ...]
  if (parts.length < prefParts.length + 3) return null;
  for (let i = 0; i < prefParts.length; i++) {
    if (parts[i] !== prefParts[i]) return null;
  }
  const i0 = prefParts.length;
  const module = parts[i0];
  if (parts[i0 + 1] !== 'admin') return null;
  if (!AUDIT_ADMIN_MODULES.includes(module as AuditAdminModule)) return null;
  const rest = parts.slice(i0 + 2);
  return { module, rest };
}

function parseCatalogAdmin(rest: string[]): ParsedAdminMutationPath {
  const [a, b, c] = rest;
  if (!a) return { module: 'catalog', entityType: 'CatalogAdmin' };
  if (a === 'brands') {
    if (b && isLikelyCuid(b)) return { module: 'catalog', entityType: 'Brand', entityId: b };
    if (b === 'bulk-delete') return { module: 'catalog', entityType: 'Brand', operation: 'bulk-delete' };
    return { module: 'catalog', entityType: 'Brand' };
  }
  if (a === 'categories') {
    if (b && isLikelyCuid(b)) return { module: 'catalog', entityType: 'Category', entityId: b };
    if (b === 'reorder') return { module: 'catalog', entityType: 'Category', operation: 'reorder' };
    if (b === 'bulk-delete') return { module: 'catalog', entityType: 'Category', operation: 'bulk-delete' };
    return { module: 'catalog', entityType: 'Category' };
  }
  if (a === 'products') {
    if (b === 'bulk-delete') return { module: 'catalog', entityType: 'Product', operation: 'bulk-delete' };
    if (b && isLikelyCuid(b)) return { module: 'catalog', entityType: 'Product', entityId: b };
    return { module: 'catalog', entityType: 'Product' };
  }
  if (a === 'media') {
    if (b === 'objects' && c && isLikelyCuid(c)) {
      return { module: 'catalog', entityType: 'MediaObject', entityId: c };
    }
    if (b === 'folders' && c && isLikelyCuid(c)) {
      return { module: 'catalog', entityType: 'MediaFolder', entityId: c };
    }
    if (b === 'objects') return { module: 'catalog', entityType: 'MediaObject' };
    if (b === 'folders') return { module: 'catalog', entityType: 'MediaFolder' };
    if (b === 'maintenance') return { module: 'catalog', entityType: 'MediaLibrary', operation: 'maintenance' };
    return { module: 'catalog', entityType: 'MediaLibrary' };
  }
  const id = lastLikelyCuid(rest);
  return {
    module: 'catalog',
    entityType: a ? `${a[0].toUpperCase()}${a.slice(1)}` : 'CatalogAdmin',
    entityId: id,
    operation: id ? undefined : rest.join('/'),
  };
}

function parseOrdersAdmin(rest: string[]): ParsedAdminMutationPath {
  if (rest.length === 0) return { module: 'orders', entityType: 'OrderAdmin' };
  const [id, action] = rest;
  if (id && isLikelyCuid(id)) {
    if (action === 'status') {
      return { module: 'orders', entityType: 'Order', entityId: id, operation: 'status' };
    }
    return { module: 'orders', entityType: 'Order', entityId: id };
  }
  return {
    module: 'orders',
    entityType: 'Order',
    entityId: lastLikelyCuid(rest),
    operation: rest.join('/'),
  };
}

/** Заготовки под будущие админ-контроллеры blog/pages/… */
function parseGenericModule(module: string, rest: string[]): ParsedAdminMutationPath {
  if (module === 'blog') {
    const [r0, r1, r2] = rest;
    if (r0 === 'posts' && r1 && isLikelyCuid(r1)) {
      return { module, entityType: 'BlogPost', entityId: r1 };
    }
    if (r0 === 'posts') return { module, entityType: 'BlogPost', operation: r1 };
    if (r0 === 'categories' && r1 && isLikelyCuid(r1)) {
      return { module, entityType: 'BlogCategory', entityId: r1 };
    }
    if (r0 === 'categories') return { module, entityType: 'BlogCategory', operation: r1 };
  }
  if (module === 'pages') {
    const [r0, r1] = rest;
    if (r0 && isLikelyCuid(r0)) return { module, entityType: 'Page', entityId: r0 };
    if (r0 === 'bulk-delete') return { module, entityType: 'Page', operation: 'bulk-delete' };
    if (r0 && r1 && isLikelyCuid(r1)) return { module, entityType: 'Page', entityId: r1 };
  }
  if (module === 'designers') {
    const [r0, r1] = rest;
    if (r0 && isLikelyCuid(r0)) return { module, entityType: 'Designer', entityId: r0 };
    if (r0 === 'reorder') return { module, entityType: 'Designer', operation: 'reorder' };
  }
  if (module === 'collections') {
    const id = lastLikelyCuid(rest);
    return {
      module,
      entityType: 'Collection',
      entityId: id,
      operation: id ? undefined : rest.join('/') || undefined,
    };
  }
  if (module === 'referrals') {
    const id = lastLikelyCuid(rest);
    return {
      module,
      entityType: 'Referral',
      entityId: id,
      operation: id ? undefined : rest.join('/') || undefined,
    };
  }
  if (module === 'projects') {
    const id = lastLikelyCuid(rest);
    return {
      module,
      entityType: 'Project',
      entityId: id,
      operation: id ? undefined : rest.join('/') || undefined,
    };
  }
  const id = lastLikelyCuid(rest);
  return {
    module,
    entityType: `${module[0].toUpperCase()}${module.slice(1)}Admin`,
    entityId: id,
    operation: id ? undefined : rest.join('/') || undefined,
  };
}

export function parseAdminMutationPath(
  pathOnly: string,
  apiPrefixRaw: string,
): ParsedAdminMutationPath | null {
  const parsed = partsAfterAdmin(pathOnly, apiPrefixRaw);
  if (!parsed) return null;
  const { module, rest } = parsed;
  if (module === 'catalog') return parseCatalogAdmin(rest);
  if (module === 'orders') return parseOrdersAdmin(rest);
  return parseGenericModule(module, rest);
}
