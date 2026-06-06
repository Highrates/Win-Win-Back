export function parseAdminListQuery(
  pageRaw?: string | number,
  limitRaw?: string | number,
  defaultLimit = 20,
  maxLimit = 100,
) {
  const pageNum =
    typeof pageRaw === 'number' ? pageRaw : parseInt(String(pageRaw ?? '1'), 10);
  const limitNum =
    typeof limitRaw === 'number' ? limitRaw : parseInt(String(limitRaw ?? defaultLimit), 10);
  const page = Math.max(1, Number.isFinite(pageNum) ? pageNum : 1);
  const limit = Math.min(
    maxLimit,
    Math.max(1, Number.isFinite(limitNum) ? limitNum : defaultLimit),
  );
  return { page, limit, skip: (page - 1) * limit };
}

export function adminListResult<T>(
  items: T[],
  total: number,
  page: number,
  limit: number,
) {
  return { items, total, page, limit };
}
