import { BadRequestException } from '@nestjs/common';
import { CommercialProposalStatus, OrderStatus } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommercialProposalService } from './commercial-proposal.service';

describe('CommercialProposalService.publish', () => {
  let prisma: {
    order: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
    commercialProposal: {
      findFirst: ReturnType<typeof vi.fn>;
      aggregate: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
    };
    commercialProposalLine: { findMany: ReturnType<typeof vi.fn> };
    $transaction: ReturnType<typeof vi.fn>;
  };
  let orders: { emitOrderStatusChangedSideEffects: ReturnType<typeof vi.fn> };
  let svc: CommercialProposalService;

  beforeEach(() => {
    prisma = {
      order: {
        findUnique: vi.fn(),
        update: vi.fn(),
      },
      commercialProposal: {
        findFirst: vi.fn(),
        aggregate: vi.fn().mockResolvedValue({ _max: { versionNumber: 1 } }),
        update: vi.fn(),
        create: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
      },
      commercialProposalLine: {
        findMany: vi.fn().mockResolvedValue([
          {
            sourceOrderItemId: null,
            sortOrder: 0,
            productId: 'p1',
            productVariantId: null,
            quantity: 1,
            unit: 'шт',
            snapshot: null,
            offerUnitPrice: 100,
            discountPercent: null,
            deliveryEta: null,
            lineNote: null,
          },
        ]),
      },
      $transaction: vi.fn(async (fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma)),
    };
    orders = {
      emitOrderStatusChangedSideEffects: vi.fn(async () => undefined),
    };
    const orderSettings = {};
    svc = new CommercialProposalService(prisma as never, orders as never, orderSettings as never);

    prisma.order.findUnique
      .mockResolvedValueOnce({
        id: 'ord1',
        status: OrderStatus.APPROVED,
        items: [{ product: { id: 'p1', name: 'X' } }],
      })
      .mockResolvedValue({ status: OrderStatus.APPROVED });
  });

  it('одна tx: publish + reset decision + PROPOSAL_FORMED после APPROVED', async () => {
    prisma.commercialProposal.findFirst.mockResolvedValue({
      id: 'draft-1',
      lines: [{ id: 'l1' }],
    });

    const getSummary = vi.spyOn(svc, 'getSummary').mockResolvedValue({
      draft: null,
      published: [],
    } as never);

    await svc.publish('ord1', 'staff-1');

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.commercialProposal.update).toHaveBeenCalled();
    expect(prisma.order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ord1' },
        data: expect.objectContaining({
          customerKpDecision: null,
          customerKpDecisionAt: null,
          customerKpDecisionVersion: null,
          status: OrderStatus.PROPOSAL_FORMED,
        }),
      }),
    );
    expect(orders.emitOrderStatusChangedSideEffects).toHaveBeenCalledWith(
      'ord1',
      OrderStatus.APPROVED,
      OrderStatus.PROPOSAL_FORMED,
      expect.any(Object),
    );
    getSummary.mockRestore();
  });

  it('COMPLETED → BadRequest', async () => {
    prisma.order.findUnique.mockReset();
    prisma.order.findUnique
      .mockResolvedValueOnce({
        id: 'ord1',
        status: OrderStatus.COMPLETED,
        items: [],
      })
      .mockResolvedValue({ status: OrderStatus.COMPLETED });
    prisma.commercialProposal.findFirst.mockResolvedValue({
      id: 'draft-1',
      lines: [{ id: 'l1' }],
    });

    await expect(svc.publish('ord1', 'staff-1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('PAID / IN_TRANSIT → BadRequest (нет rewind)', async () => {
    for (const status of [OrderStatus.PAID, OrderStatus.IN_TRANSIT, OrderStatus.PENDING_PAYMENT]) {
      prisma.order.findUnique.mockReset();
      prisma.order.findUnique
        .mockResolvedValueOnce({ id: 'ord1', status, items: [] })
        .mockResolvedValue({ status });
      prisma.commercialProposal.findFirst.mockResolvedValue({
        id: 'draft-1',
        lines: [{ id: 'l1' }],
      });

      await expect(svc.publish('ord1', 'staff-1')).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
      prisma.$transaction.mockClear();
    }
  });

  it('PENDING_APPROVAL: nextOrderStatus COMPLETED → BadRequest', async () => {
    prisma.order.findUnique.mockReset();
    prisma.order.findUnique
      .mockResolvedValueOnce({
        id: 'ord1',
        status: OrderStatus.PENDING_APPROVAL,
        items: [],
      })
      .mockResolvedValue({ status: OrderStatus.PENDING_APPROVAL });
    prisma.commercialProposal.findFirst.mockResolvedValue({
      id: 'draft-1',
      lines: [{ id: 'l1' }],
    });

    await expect(
      svc.publish('ord1', 'staff-1', { nextOrderStatus: 'COMPLETED' as never }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
