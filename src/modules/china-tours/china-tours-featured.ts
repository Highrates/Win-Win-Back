/** Порядок витрины по featuredTourIds (только найденные опубликованные). */
export function orderToursByFeaturedIds<T extends { id: string }>(
  rows: T[],
  featuredIds: string[],
): T[] {
  if (!featuredIds.length) return rows;
  const byId = new Map(rows.map((t) => [t.id, t]));
  return featuredIds.map((id) => byId.get(id)).filter((t): t is T => Boolean(t));
}
