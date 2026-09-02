/** Inclusive `from` / exclusive `to` for dashboard metrics (ISO strings from admin UI). */
export type DashboardDateRange = {
  from: Date;
  to: Date;
};

export function parseDashboardDateRange(
  fromRaw?: string,
  toRaw?: string,
): DashboardDateRange | null {
  const fromStr = fromRaw?.trim();
  const toStr = toRaw?.trim();
  if (!fromStr || !toStr) return null;
  const from = new Date(fromStr);
  const to = new Date(toStr);
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime())) return null;
  if (to.getTime() <= from.getTime()) return null;
  return { from, to };
}

export function createdAtInRange(range: DashboardDateRange | null): { gte: Date; lt: Date } | undefined {
  if (!range) return undefined;
  return { gte: range.from, lt: range.to };
}
