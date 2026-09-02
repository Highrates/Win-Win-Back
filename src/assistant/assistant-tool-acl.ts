import type { AdminSectionId } from '@win-win/admin-sections';

/**
 * Секция(и), нужные для tool. Несколько = достаточно любой (OR).
 * `assistant` сам по себе tools не даёт — только доступ к API чата.
 */
export const ASSISTANT_TOOL_SECTIONS: Record<string, AdminSectionId | AdminSectionId[]> = {
  get_orders_dashboard: 'dashboard',
  list_orders: 'orders',
  get_sourcing_summary: 'orders',
  search_products: 'catalog',
  get_qa_pending_summary: 'catalog',
  get_signup_summary: 'clients',
  get_partner_applications_pending: 'applications',
};

export function staffCanUseAssistantTool(
  toolName: string,
  sections: readonly string[],
  isSuperAdmin: boolean,
): boolean {
  if (isSuperAdmin) return true;
  const need = ASSISTANT_TOOL_SECTIONS[toolName];
  if (!need) return false;
  const required = Array.isArray(need) ? need : [need];
  const set = new Set(sections);
  return required.some((s) => set.has(s));
}

export function filterAssistantToolNames(
  toolNames: readonly string[],
  sections: readonly string[],
  isSuperAdmin: boolean,
): string[] {
  return toolNames.filter((name) =>
    staffCanUseAssistantTool(name, sections, isSuperAdmin),
  );
}
