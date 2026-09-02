import { describe, expect, it } from 'vitest';
import {
  filterAssistantToolNames,
  staffCanUseAssistantTool,
} from './assistant-tool-acl';

describe('assistant-tool-acl', () => {
  it('superadmin проходит любой tool', () => {
    expect(staffCanUseAssistantTool('list_orders', [], true)).toBe(true);
  });

  it('orders tool требует section orders', () => {
    expect(staffCanUseAssistantTool('list_orders', ['assistant', 'dashboard'], false)).toBe(
      false,
    );
    expect(
      staffCanUseAssistantTool('list_orders', ['assistant', 'dashboard', 'orders'], false),
    ).toBe(true);
  });

  it('qa pending требует catalog', () => {
    expect(staffCanUseAssistantTool('get_qa_pending_summary', ['orders'], false)).toBe(false);
    expect(staffCanUseAssistantTool('get_qa_pending_summary', ['catalog'], false)).toBe(true);
  });

  it('filterAssistantToolNames отсекает лишнее', () => {
    const names = [
      'get_orders_dashboard',
      'list_orders',
      'search_products',
      'get_signup_summary',
    ];
    expect(filterAssistantToolNames(names, ['dashboard', 'assistant'], false)).toEqual([
      'get_orders_dashboard',
    ]);
    expect(
      filterAssistantToolNames(names, ['dashboard', 'catalog', 'orders', 'clients'], false),
    ).toEqual(['get_orders_dashboard', 'list_orders', 'search_products', 'get_signup_summary']);
  });
});
