import { describe, expect, it, vi, beforeEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { CommercialProposalStatus, Prisma } from '@prisma/client';
import { SourcingCommercialProposalService } from './sourcing-commercial-proposal.service';
import type { PricingProfileCalcInput } from '../catalog/pricing-calculation';

const calcIn: PricingProfileCalcInput = {
  containerType: '40',
  cnyRate: 11.5,
  usdRate: 79,
  eurRate: 91,
  transferCommissionPct: 4,
  customsAdValoremPct: 10,
  customsWeightPct: 8,
  vatPct: 22,
  markupPct: 25,
  agentRub: 50000,
  warehousePortUsd: 950,
  fobUsd: 4000,
  portMskRub: 280000,
  extraLogisticsRub: 141000,
};

describe('SourcingCommercialProposalService pricing flow', () => {
  let prisma: Record<string, unknown>;
  let pricingAdmin: { loadDefaultProfileCalcContext: ReturnType<typeof vi.fn> };
  let svc: SourcingCommercialProposalService;

  beforeEach(() => {
    pricingAdmin = {
      loadDefaultProfileCalcContext: vi.fn().mockResolvedValue({
        ok: true,
        calcIn,
        profileUpdatedAt: new Date('2026-07-01T12:00:00.000Z'),
      }),
    };

    const lineUpdate = vi.fn();
    const lineCreate = vi.fn();
    const lineDeleteMany = vi.fn();
    const proposalUpdate = vi.fn();
    const proposalCreate = vi.fn();
    const lineFindMany = vi.fn().mockResolvedValue([
      {
        id: 'line-1',
        sourceSourcingRequestItemId: null,
        sortOrder: 0,
        productName: 'Товар',
        description: null,
        quantity: 1,
        unit: 'шт',
        costPriceCny: new Prisma.Decimal('5000.00'),
        grossWeightKg: new Prisma.Decimal('30.000'),
        volumeM3: new Prisma.Decimal('0.150000'),
        offerUnitPrice: new Prisma.Decimal('40000.00'),
        deliveryEta: null,
        images: [],
      },
    ]);

    prisma = {
      sourcingRequest: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'req-1',
          status: 'IN_PROGRESS',
          items: [],
        }),
        update: vi.fn(),
      },
      sourcingCommercialProposal: {
        findFirst: vi.fn(),
        findUniqueOrThrow: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
        aggregate: vi.fn().mockResolvedValue({ _max: { versionNumber: 0 } }),
        update: proposalUpdate,
        create: proposalCreate,
      },
      sourcingCommercialProposalLine: {
        deleteMany: lineDeleteMany,
        create: lineCreate,
        update: lineUpdate,
        findMany: lineFindMany,
      },
      sourcingRequestItem: { findMany: vi.fn().mockResolvedValue([]) },
      $transaction: vi.fn(async (fn: (tx: Record<string, unknown>) => Promise<unknown>) => fn(prisma)),
    };

    svc = new SourcingCommercialProposalService(prisma as never, pricingAdmin as never);
  });

  it('putDraft: budget → reverse → save → offerUnitPrice (один load профиля)', async () => {
    (prisma.sourcingCommercialProposal as { findFirst: ReturnType<typeof vi.fn> }).findFirst.mockResolvedValue({
      id: 'draft-1',
    });
    (prisma.sourcingCommercialProposal as { findUniqueOrThrow: ReturnType<typeof vi.fn> }).findUniqueOrThrow.mockResolvedValue({
      id: 'draft-1',
      sourcingRequestId: 'req-1',
      versionNumber: 0,
      status: CommercialProposalStatus.DRAFT,
      publishedAt: null,
      publishedByUserId: null,
      pricingProfileUpdatedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      lines: [],
    });

    await svc.putDraft('req-1', [
      {
        sortOrder: 0,
        productName: 'Товар',
        costPriceCny: 5000,
        grossWeightKg: 30,
        volumeM3: 0.15,
        quantity: 1,
        unit: 'шт',
      },
    ]);

    expect(pricingAdmin.loadDefaultProfileCalcContext).toHaveBeenCalledOnce();
    const lineCreate = (prisma.sourcingCommercialProposalLine as { create: ReturnType<typeof vi.fn> }).create;
    expect(lineCreate).toHaveBeenCalledOnce();
    const createArg = lineCreate.mock.calls[0]![0].data;
    expect(Number(createArg.costPriceCny)).toBe(5000);
    expect(Number(createArg.offerUnitPrice)).toBeGreaterThan(0);
  });

  it('publish: отклоняет строку без ¥', async () => {
    (prisma.sourcingCommercialProposal as { findFirst: ReturnType<typeof vi.fn> }).findFirst.mockResolvedValue({
      id: 'draft-1',
      lines: [
        {
          id: 'line-1',
          productName: 'Товар',
          costPriceCny: new Prisma.Decimal('0.00'),
          grossWeightKg: new Prisma.Decimal('30.000'),
          volumeM3: new Prisma.Decimal('0.150000'),
          sourceSourcingRequestItemId: null,
        },
      ],
    });

    await expect(svc.publish('req-1', 'staff-1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('publish: фиксирует snapshot offerUnitPrice и pricingProfileUpdatedAt', async () => {
    const findFirst = (prisma.sourcingCommercialProposal as { findFirst: ReturnType<typeof vi.fn> }).findFirst;
    findFirst.mockImplementation(async (args: { where?: { versionNumber?: number }; include?: unknown }) => {
      const draftLine = {
        id: 'line-1',
        productName: 'Товар',
        costPriceCny: new Prisma.Decimal('5000.00'),
        grossWeightKg: new Prisma.Decimal('30.000'),
        volumeM3: new Prisma.Decimal('0.150000'),
        sourceSourcingRequestItemId: null,
      };
      if (args?.where?.versionNumber === 0 && args.include) {
        return { id: 'draft-1', lines: [draftLine] };
      }
      if (args?.where?.versionNumber === 0) {
        return { id: 'draft-1', updatedAt: new Date(), _count: { lines: 1 } };
      }
      return null;
    });

    const result = await svc.publish('req-1', 'staff-1');
    expect(result.versionNumber).toBe(1);
    const lineUpdate = (prisma.sourcingCommercialProposalLine as { update: ReturnType<typeof vi.fn> }).update;
    expect(lineUpdate).toHaveBeenCalled();
    const proposalUpdate = (prisma.sourcingCommercialProposal as { update: ReturnType<typeof vi.fn> }).update;
    expect(proposalUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          pricingProfileUpdatedAt: new Date('2026-07-01T12:00:00.000Z'),
          status: CommercialProposalStatus.PUBLISHED,
        }),
      }),
    );
  });
});
