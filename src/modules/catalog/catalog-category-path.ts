/** Цепочка имён от корня к категории товара: «Гостиная → Диваны». */
export function buildCategoryPathLabel(
  categoryId: string,
  byId: Map<string, { name: string; parentId: string | null }>,
): string {
  const parts: string[] = [];
  let cur: string | null = categoryId;
  const guard = new Set<string>();
  while (cur && !guard.has(cur)) {
    guard.add(cur);
    const row = byId.get(cur);
    if (!row) break;
    parts.push(row.name);
    cur = row.parentId;
  }
  return parts.reverse().join(' → ');
}
