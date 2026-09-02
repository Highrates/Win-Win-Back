import { NotFoundException } from '@nestjs/common';
import { AuditAction, OrderStatus } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrdersService } from './orders.service';

function buildService() {
  const prisma = {
    order: {
      findUnique: vi.fn(),
      findMany: vi.fn(async () => []),
      count: vi.fn(async () => 0),
      update: vi.fn(),
      groupBy: vi.fn(async () => []),
    },
    chatConversation: {
      findMany: vi.fn(async () => []),
    },
  };
  const audit = { log: vi.fn(async () => undefined) };
  const mail = { sendOrderSubmittedStaff: vi.fn(async () => undefined) };
  const orderChat = {
    unreadCustomerCountsForStaffOrders: vi.fn(async () => ({})),
    onOrderStatusChanged: vi.fn(async () => undefined),
    purgeOrderChatMediaForOrder: vi.fn(async () => undefined),
  };
  const config = { get: vi.fn(() => undefined) };
  const referrals = { ensureRewardsForCompletedOrder: vi.fn(async () => undefined) };
  const orderProgramSnapshots = {};
  const tierPricing = {};

  const service = new OrdersService(
    prisma as never,
    audit as never,
    mail as never,
    orderChat as never,
    config as never,
    referrals as never,
    orderProgramSnapshots as never,
    tierPricing as never,
  );

  return { service, prisma, audit, orderChat };
}

describe('OrdersService.updateStatus', () => {
  it('same-status PATCH: 200 без audit и без onOrderStatusChanged', async () => {
    const existing = {
      id: 'ord1',
      status: OrderStatus.IN_TRANSIT,
      items: [],
    };
    const { service, prisma, audit, orderChat } = buildService();
    prisma.order.findUnique
      .mockResolvedValueOnce({ status: OrderStatus.IN_TRANSIT })
      .mockResolvedValueOnce(existing);

    const out = await service.updateStatus('ord1', OrderStatus.IN_TRANSIT);

    expect(out).toBe(existing);
    expect(prisma.order.update).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
    expect(orderChat.onOrderStatusChanged).not.toHaveBeenCalled();
  });

  it('валидный переход: update + audit + onOrderStatusChanged', async () => {
    const updated = {
      id: 'ord1',
      status: OrderStatus.COMPLETED,
      items: [],
    };
    const { service, prisma, audit, orderChat } = buildService();
    prisma.order.findUnique.mockResolvedValue({ status: OrderStatus.RECEIVED });
    prisma.order.update.mockResolvedValue(updated);

    const out = await service.updateStatus('ord1', OrderStatus.COMPLETED);

    expect(out).toBe(updated);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.UPDATE,
        entityType: 'Order',
        entityId: 'ord1',
        metadata: expect.objectContaining({
          from: OrderStatus.RECEIVED,
          to: OrderStatus.COMPLETED,
        }),
      }),
    );
    expect(orderChat.onOrderStatusChanged).toHaveBeenCalledWith('ord1', OrderStatus.COMPLETED);
  });

  it('неизвестный заказ → NotFoundException', async () => {
    const { service, prisma } = buildService();
    prisma.order.findUnique.mockResolvedValue(null);

    await expect(service.updateStatus('missing', OrderStatus.COMPLETED)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('OrdersService.findManyForAdmin', () => {
  it('hasChatMessages: true когда есть ChatConversation по orderId', async () => {
    const { service, prisma } = buildService();
    prisma.order.findMany.mockResolvedValue([
      {
        id: 'ord-a',
        status: OrderStatus.PENDING_APPROVAL,
        createdAt: new Date(),
        user: { id: 'u1', email: 'a@test.com', phone: null, profile: null },
        items: [],
      },
      {
        id: 'ord-b',
        status: OrderStatus.PENDING_APPROVAL,
        createdAt: new Date(),
        user: { id: 'u2', email: 'b@test.com', phone: null, profile: null },
        items: [],
      },
    ]);
    prisma.order.count.mockResolvedValue(2);
    prisma.chatConversation.findMany.mockResolvedValue([{ orderId: 'ord-a' }]);

    const out = await service.findManyForAdmin(1, 20);

    expect(out.items[0]?.hasChatMessages).toBe(true);
    expect(out.items[1]?.hasChatMessages).toBe(false);
  });
});

describe('OrdersService.getDashboardStatusSummaryForAdmin', () => {
  it('считает new и active', async () => {
    const { service, prisma } = buildService();
    prisma.order.count
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(2);

    const out = await service.getDashboardStatusSummaryForAdmin();

    expect(out).toEqual({ new: 3, active: 2 });
    expect(prisma.order.count).toHaveBeenCalledTimes(2);
  });
});

describe('OrdersService.findManyForAdmin period filter', () => {
  it('передаёт createdAt в where при from/to', async () => {
    const { service, prisma } = buildService();
    prisma.order.findMany.mockResolvedValue([]);
    prisma.order.count.mockResolvedValue(0);
    prisma.chatConversation.findMany.mockResolvedValue([]);

    const from = '2026-09-01T00:00:00.000Z';
    const to = '2026-09-02T00:00:00.000Z';
    await service.findManyForAdmin(1, 20, undefined, undefined, 'new', undefined, { from, to });

    const where = prisma.order.findMany.mock.calls[0]?.[0]?.where;
    expect(where).toEqual(
      expect.objectContaining({
        AND: expect.arrayContaining([
          expect.objectContaining({
            createdAt: { gte: new Date(from), lt: new Date(to) },
          }),
        ]),
      }),
    );
  });
});
