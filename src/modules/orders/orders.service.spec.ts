import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { AuditAction, CommercialProposalStatus, CustomerKpDecision, OrderStatus } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrdersService } from './orders.service';

function buildService() {
  const prisma = {
    order: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(async () => []),
      count: vi.fn(async () => 0),
      update: vi.fn(),
      updateMany: vi.fn(),
      groupBy: vi.fn(async () => []),
    },
    commercialProposal: {
      findFirst: vi.fn(),
    },
    userProfile: {
      upsert: vi.fn(),
    },
    chatConversation: {
      findMany: vi.fn(async () => []),
    },
    orderDocument: {
      findMany: vi.fn(async () => [] as { kind: string; url: string }[]),
      upsert: vi.fn((args: unknown) => ({ op: 'upsert', args })),
      delete: vi.fn((args: unknown) => ({ op: 'delete', args })),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      if (typeof fn === 'function') return fn(prisma);
      return fn;
    }),
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

  it('documentUrls: дата загрузки меняется только у нового/изменённого файла, пустой url удаляет', async () => {
    const { service, prisma } = buildService();
    prisma.order.findUnique
      .mockResolvedValueOnce({ status: OrderStatus.PAID })
      .mockResolvedValueOnce({ id: 'ord1', status: OrderStatus.PAID, items: [] });
    prisma.orderDocument.findMany.mockResolvedValue([
      { kind: 'invoice', url: 'https://s3/inv.pdf' },
      { kind: 'act', url: 'https://s3/act-old.pdf' },
      { kind: 'waybill', url: 'https://s3/wb.pdf' },
    ]);

    await service.updateStatus('ord1', OrderStatus.PAID, {
      invoice: 'https://s3/inv.pdf',
      act: 'https://s3/act-new.pdf',
      waybill: '',
      contract: 'https://s3/contract.pdf',
    });

    expect(prisma.orderDocument.upsert).toHaveBeenCalledTimes(2);
    expect(prisma.orderDocument.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { orderId_kind: { orderId: 'ord1', kind: 'act' } },
        update: { url: 'https://s3/act-new.pdf', uploadedAt: expect.any(Date) },
      }),
    );
    expect(prisma.orderDocument.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: { orderId: 'ord1', kind: 'contract', url: 'https://s3/contract.pdf' },
      }),
    );
    expect(prisma.orderDocument.delete).toHaveBeenCalledWith({
      where: { orderId_kind: { orderId: 'ord1', kind: 'waybill' } },
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
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

describe('OrdersService customer KP path', () => {
  const baseOrder = {
    id: 'ord-kp',
    status: OrderStatus.PROPOSAL_FORMED,
    customerKpDecision: null,
    customerKpDecisionVersion: null,
  };

  it('assert: mismatch expectedVersion → 409', async () => {
    const { service, prisma } = buildService();
    prisma.order.findFirst.mockResolvedValue(baseOrder);
    prisma.commercialProposal.findFirst.mockResolvedValue({ versionNumber: 2 });

    await expect(
      service.recordCommercialProposalDecisionForCustomer('u1', 'ord-kp', {
        decision: 'REJECTED',
        expectedVersion: 1,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('decision: условный updateMany с expectedVersion', async () => {
    const { service, prisma } = buildService();
    prisma.order.findFirst.mockResolvedValue(baseOrder);
    prisma.commercialProposal.findFirst.mockResolvedValue({
      versionNumber: 3,
      status: CommercialProposalStatus.PUBLISHED,
    });
    prisma.order.updateMany.mockResolvedValue({ count: 1 });

    const out = await service.recordCommercialProposalDecisionForCustomer('u1', 'ord-kp', {
      decision: 'CHANGES_REQUESTED',
      expectedVersion: 3,
    });

    expect(out.customerKpDecision).toBe(CustomerKpDecision.CHANGES_REQUESTED);
    expect(out.customerKpDecisionVersion).toBe(3);
    expect(prisma.order.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          customerKpDecision: CustomerKpDecision.CHANGES_REQUESTED,
          customerKpDecisionVersion: 3,
        }),
      }),
    );
  });

  it('accept: невалидный ИНН → BadRequest', async () => {
    const { service, prisma } = buildService();
    prisma.order.findFirst.mockResolvedValue(baseOrder);
    prisma.commercialProposal.findFirst.mockResolvedValue({ versionNumber: 1 });

    await expect(
      service.acceptCommercialProposalForCustomer('u1', 'ord-kp', {
        expectedVersion: 1,
        requisites: {
          legalType: 'LLC',
          contactName: 'Иван Иванов',
          companyName: 'ООО Ромашка',
          inn: '1234567890',
        },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.order.updateMany).not.toHaveBeenCalled();
  });

  it('accept: валидные реквизиты → APPROVED + profile upsert', async () => {
    const { service, prisma } = buildService();
    prisma.order.findFirst.mockResolvedValue(baseOrder);
    prisma.commercialProposal.findFirst.mockResolvedValue({ versionNumber: 1 });
    prisma.order.updateMany.mockResolvedValue({ count: 1 });
    prisma.userProfile.upsert.mockResolvedValue({});

    const out = await service.acceptCommercialProposalForCustomer('u1', 'ord-kp', {
      expectedVersion: 1,
      requisites: {
        legalType: 'LLC',
        contactName: 'Иван Иванов',
        companyName: 'ООО Ромашка',
        inn: '7707083893',
        bankName: 'Сбер',
        bankAccount: '40817810099910004316',
        bic: '044525225',
        phone: '+7 900 111-22-33',
      },
    });

    expect(out.status).toBe(OrderStatus.APPROVED);
    expect(prisma.userProfile.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          inn: '7707083893',
          bankAccount: '40817810099910004316',
        }),
      }),
    );
    const upsertArg = prisma.userProfile.upsert.mock.calls[0]?.[0];
    expect(upsertArg.create).not.toHaveProperty('bic');
    expect(upsertArg.create).not.toHaveProperty('phone');
  });
});
