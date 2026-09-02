import { describe, expect, it, vi, beforeEach } from 'vitest';
import { UserRole } from '@prisma/client';
import { AssistantToolsService } from './assistant-tools.service';

describe('AssistantToolsService', () => {
  const orders = {
    getDashboardStatusSummaryForAdmin: vi.fn(),
    findManyForAdmin: vi.fn(),
  };
  const catalogAdmin = { listProductsForAdmin: vi.fn() };
  const sourcing = { getDashboardStatusSummaryForAdmin: vi.fn() };
  const users = {
    getDashboardSignupSummaryForAdmin: vi.fn(),
    countPendingPartnerApplicationsForAdmin: vi.fn(),
  };
  const productQa = { getStaffQaPendingSummary: vi.fn() };
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
    );
  });

  it('listToolDefs включает Wupapa tools', () => {
    const names = svc.listToolDefs().map((t) => t.function.name);
    expect(names).toEqual([
      'get_orders_dashboard',
      'list_orders',
      'get_sourcing_summary',
      'search_products',
      'get_qa_pending_summary',
      'get_signup_summary',
      'get_partner_applications_pending',
    ]);
  });

  it('фильтрует tools по ACL', () => {
    const names = svc.listToolDefs({ ...acl, sections: ['dashboard'] }).map((t) => t.function.name);
    expect(names).toEqual(['get_orders_dashboard']);
  });

  it('get_orders_dashboard делегирует в OrdersService', async () => {
    orders.getDashboardStatusSummaryForAdmin.mockResolvedValue({
      new: 1,
      active: 2,
      completed: 3,
      byStatus: [],
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
});
