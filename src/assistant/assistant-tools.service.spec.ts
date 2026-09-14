import { describe, expect, it, vi, beforeEach } from 'vitest';
import { UserRole } from '@prisma/client';
import { AssistantToolsService } from './assistant-tools.service';

describe('AssistantToolsService', () => {
  const orders = {
    getDashboardStatusSummaryForAdmin: vi.fn(),
    findManyForAdmin: vi.fn(),
    getStatusFunnelForAdmin: vi.fn(),
  };
  const catalogAdmin = {
    listProductsForAdmin: vi.fn(),
    getDashboardCatalogSummary: vi.fn(),
  };
  const sourcing = {
    getDashboardStatusSummaryForAdmin: vi.fn(),
    findManyForAdmin: vi.fn(),
  };
  const users = {
    getDashboardSignupSummaryForAdmin: vi.fn(),
    countPendingPartnerApplicationsForAdmin: vi.fn(),
  };
  const productQa = {
    getStaffQaPendingSummary: vi.fn(),
    getStaffQaUnreadSummary: vi.fn(),
  };
  const referrals = { getAdminPartnerRewardsPendingSummary: vi.fn() };
  const orderChat = {
    unreadCustomerChatSummaryForAdminBuckets: vi.fn(),
    unreadSourcingCustomerChatSummaryForAdminBuckets: vi.fn(),
  };
  let svc: AssistantToolsService;

  const acl = {
    sections: ['dashboard', 'orders', 'catalog', 'clients', 'applications'],
    isSuperAdmin: false,
    staffId: 's1',
    staffRole: UserRole.MODERATOR,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    svc = new AssistantToolsService(
      orders as never,
      catalogAdmin as never,
      sourcing as never,
      users as never,
      productQa as never,
      referrals as never,
      orderChat as never,
    );
  });

  it('listToolDefs включает Wupapa tools', () => {
    const names = svc.listToolDefs().map((t) => t.function.name);
    expect(names).toEqual([
      'get_orders_dashboard',
      'list_orders',
      'get_orders_chat_unread_summary',
      'get_sourcing_summary',
      'get_sourcing_chat_unread_summary',
      'list_sourcing_requests',
      'funnel_lite',
      'search_products',
      'content_gaps',
      'get_qa_pending_summary',
      'get_qa_unread_summary',
      'get_signup_summary',
      'get_partner_applications_pending',
      'get_partner_rewards_pending_summary',
    ]);
  });

  it('фильтрует tools по ACL', () => {
    const names = svc.listToolDefs({ ...acl, sections: ['dashboard'] }).map((t) => t.function.name);
    expect(names).toEqual(['get_orders_dashboard', 'funnel_lite']);
  });

  it('get_orders_dashboard делегирует в OrdersService', async () => {
    orders.getDashboardStatusSummaryForAdmin.mockResolvedValue({
      new: 1,
      active: 2,
    });
    const out = await svc.execute('get_orders_dashboard', '{}', acl);
    expect(out).toMatchObject({ new: 1, adminLinks: { orders: '/admin/orders' } });
  });

  it('list_orders маскирует PII', async () => {
    orders.findManyForAdmin.mockResolvedValue({
      total: 1,
      page: 1,
      limit: 20,
      items: [
        {
          id: 'o1',
          status: 'PENDING_APPROVAL',
          totalAmount: 1000,
          currency: 'RUB',
          createdAt: new Date().toISOString(),
          unreadCustomerChatCount: 0,
          hasChatMessages: false,
          customerName: 'Иван Петров',
          user: { email: 'test@example.com', phone: '+79991234567' },
        },
      ],
    });
    const out = (await svc.execute('list_orders', '{}', acl)) as {
      items: Array<{ email: string | null; phone: string | null; customerName: string | null }>;
    };
    expect(out.items[0].email).toBe('te***@example.com');
    expect(out.items[0].phone).toBe('***4567');
    expect(out.items[0].customerName).toBe('И***');
  });

  it('get_orders_chat_unread_summary делегирует в OrderChatService', async () => {
    orderChat.unreadCustomerChatSummaryForAdminBuckets.mockResolvedValue({
      total: 5,
      new: 2,
      active: 3,
      completed: 0,
    });
    const out = await svc.execute('get_orders_chat_unread_summary', '{}', acl);
    expect(out).toMatchObject({ total: 5, adminLink: '/admin/orders' });
    expect(orderChat.unreadCustomerChatSummaryForAdminBuckets).toHaveBeenCalledWith('s1');
  });

  it('content_gaps делегирует в CatalogAdminService', async () => {
    catalogAdmin.getDashboardCatalogSummary.mockResolvedValue({
      noModifications: 1,
      noVariants: 2,
      activeEmpty: 0,
      elementEmptyPool: 0,
      compositeIncomplete: 0,
    });
    const out = await svc.execute('content_gaps', '{}', acl);
    expect(out).toMatchObject({ noModifications: 1, adminLink: '/admin/catalog/products' });
  });
});
