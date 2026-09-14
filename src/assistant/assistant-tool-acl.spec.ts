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

  it('partner rewards: applications или settings', () => {
    expect(
      staffCanUseAssistantTool('get_partner_rewards_pending_summary', ['clients'], false),
    ).toBe(false);
    expect(
      staffCanUseAssistantTool('get_partner_rewards_pending_summary', ['applications'], false),
    ).toBe(true);
    expect(
      staffCanUseAssistantTool('get_partner_rewards_pending_summary', ['settings'], false),
    ).toBe(true);
  });

  it('funnel_lite: dashboard или orders', () => {
    expect(staffCanUseAssistantTool('funnel_lite', ['clients'], false)).toBe(false);
    expect(staffCanUseAssistantTool('funnel_lite', ['dashboard'], false)).toBe(true);
    expect(staffCanUseAssistantTool('funnel_lite', ['orders'], false)).toBe(true);
  });

  it('chat unread и content_gaps по секциям', () => {
    expect(
      staffCanUseAssistantTool('get_orders_chat_unread_summary', ['orders'], false),
    ).toBe(true);
    expect(staffCanUseAssistantTool('content_gaps', ['catalog'], false)).toBe(true);
    expect(staffCanUseAssistantTool('get_qa_unread_summary', ['catalog'], false)).toBe(true);
    expect(staffCanUseAssistantTool('list_sourcing_requests', ['orders'], false)).toBe(true);
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
