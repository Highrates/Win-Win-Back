/** Узел дерева категорий для расчёта scope (сама категория + все потомки). */
export type CategoryTreeNode = { id: string; parentId: string | null };

/**
 * id категории и всех активных потомков (BFS).
 * Товар в подкатегории попадает в выдачу родительской категории.
 */
export function collectCategoryAndDescendantIds(
  categoryId: string,
  categories: CategoryTreeNode[],
): string[] {
  const root = categoryId.trim();
  if (!root) return [];

  const childrenByParent = new Map<string, string[]>();
  for (const c of categories) {
    const pid = c.parentId;
    if (!pid) continue;
    if (!childrenByParent.has(pid)) childrenByParent.set(pid, []);
    childrenByParent.get(pid)!.push(c.id);
  }

  const out = new Set<string>([root]);
  const queue = [root];
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const ch of childrenByParent.get(id) ?? []) {
      if (!out.has(ch)) {
        out.add(ch);
        queue.push(ch);
      }
    }
  }
  return [...out];
}

/** Meilisearch: товар матчится, если любой id из scope есть в массиве categoryIds документа. */
export function meilisearchCategoryScopeFilter(scopeIds: string[]): string | null {
  const ids = scopeIds.map((x) => x.trim()).filter(Boolean);
  if (!ids.length) return null;
  if (ids.length === 1) return `categoryIds = "${ids[0]}"`;
  return `(${ids.map((id) => `categoryIds = "${id}"`).join(' OR ')})`;
}
