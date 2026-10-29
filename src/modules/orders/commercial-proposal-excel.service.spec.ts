import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { CommercialProposalStatus, OrderStatus } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommercialProposalService } from './commercial-proposal.service';

describe('CommercialProposalService.importExcelToDraft', () => {
  let prisma: Record<string, any>;
  let piExcel: {
    assertXlsxUpload: ReturnType<typeof vi.fn>;
    parseWorkbook: ReturnType<typeof vi.fn>;
  };
  let pricingAdmin: { loadDefaultProfileCalcContext: ReturnType<typeof vi.fn> };
  let svc: CommercialProposalService;
  let putDraftSpy: ReturnType<typeof vi.spyOn>;

  const draftLines = [
    {
      id: 'line-1',
      sourceOrderItemId: 'oi-1',
      sortOrder: 0,
      productId: 'p1',
      productVariantId: null,
      quantity: 2,
      unit: 'шт',
      snapshot: { productName: 'Chair', weightKg: 10, volumeLiters: 0.2 },
      offerUnitPrice: 5000,
      discountPercent: null,
      deliveryEta: null,
      lineNote: null,
    },
    {
      id: 'line-2',
      sourceOrderItemId: null,
      sortOrder: 1,
      productId: 'p2',
      productVariantId: null,
      quantity: 1,
      unit: 'шт',
      snapshot: { productName: 'Table', weightKg: 20, volumeLiters: 0.5 },
      offerUnitPrice: 8000,
      discountPercent: null,
      deliveryEta: null,
      lineNote: null,
    },
  ];

  beforeEach(() => {
    prisma = {
      order: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'ord1',
          status: OrderStatus.PENDING_APPROVAL,
          items: [],
        }),
      },
      commercialProposal: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'draft-1',
          orderId: 'ord1',
          versionNumber: 0,
          status: CommercialProposalStatus.DRAFT,
          publishedAt: null,
          publishedByUserId: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          lines: draftLines,
        }),
        findUniqueOrThrow: vi.fn(),
      },
      commercialProposalLine: {
        deleteMany: vi.fn(),
        create: vi.fn(),
      },
      product: { findFirst: vi.fn().mockResolvedValue({ id: 'p1' }) },
      productVariant: { findFirst: vi.fn() },
      $transaction: vi.fn(async (fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma)),
    };

    piExcel = {
      assertXlsxUpload: vi.fn().mockReturnValue(Buffer.from('xlsx')),
      parseWorkbook: vi.fn().mockResolvedValue({
        invoiceNoHint: null,
        emptyMatchKeyRows: [],
        lines: [
          {
            excelRow: 12,
            no: 1,
            matchKey: 'OI:oi-1',
            quantity: 3,
            unitPrice: 100,
            description: null,
            productSizeMm: null,
            weightKg: 10,
            volumeM3: 0.2,
            modelName: 'Chair',
          },
          {
            excelRow: 13,
            no: 99,
            matchKey: 'KL:stale-published-id',
            quantity: 1,
            unitPrice: 50,
            description: null,
            productSizeMm: null,
            weightKg: null,
            volumeM3: null,
            modelName: 'Ghost',
          },
        ],
      }),
    };

    pricingAdmin = {
      loadDefaultProfileCalcContext: vi.fn().mockResolvedValue({
        ok: true,
        calcIn: {
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
        },
      }),
    };

    svc = new CommercialProposalService(
      prisma as never,
      { emitOrderStatusChangedSideEffects: vi.fn() } as never,
      {
        getResolved: vi.fn().mockResolvedValue({ kpMaxLineDiscountPercent: 30 }),
      } as never,
      piExcel as never,
      { get: vi.fn() } as never,
      pricingAdmin as never,
    );

    putDraftSpy = vi.spyOn(svc, 'putDraft').mockImplementation(async (_id, lines) => ({
      id: 'draft-1',
      orderId: 'ord1',
      versionNumber: 0,
      status: 'DRAFT' as const,
      publishedAt: null,
      publishedByUserId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lines: lines.map((l, i) => ({
        id: `saved-${i}`,
        sourceOrderItemId: l.sourceOrderItemId ?? null,
        sortOrder: l.sortOrder,
        productId: l.productId,
        productVariantId: l.productVariantId ?? null,
        quantity: l.quantity,
        unit: l.unit,
        snapshot: l.snapshot ?? null,
        offerUnitPrice: l.offerUnitPrice,
        discountPercent: l.discountPercent ?? null,
        deliveryEta: l.deliveryEta ?? null,
        lineNote: l.lineNote ?? null,
      })),
    }));
  });

  it('merge-only onto existing draft: mode=merged, does not call initDraft', async () => {
    const initSpy = vi.spyOn(svc, 'initDraft');
    const result = await svc.importExcelToDraft('ord1', {
      buffer: Buffer.from('x'),
      originalname: 'a.xlsx',
      mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    } as Express.Multer.File);

    expect(initSpy).not.toHaveBeenCalled();
    expect(result.mode).toBe('merged');
    expect(result.draftCreated).toBe(false);
    expect(result.updatedCount).toBe(1);
    expect(result.unmatchedCount).toBe(1);
    expect(result.unmatched?.[0]).toMatch(/KL:stale-published-id|строка Excel 13/);
    expect(putDraftSpy).toHaveBeenCalled();
    const savedLines = putDraftSpy.mock.calls[0]![1];
    expect(savedLines[0]!.quantity).toBe(3);
    expect(savedLines[1]!.quantity).toBe(1); // unmatched line unchanged
    expect(savedLines[0]!.offerUnitPrice).toBeGreaterThan(0); // CNY→RUB
  });

  it('creates draft once when missing, then merges (mode=created)', async () => {
    prisma.commercialProposal.findFirst
      .mockResolvedValueOnce(null) // getDraft → not found
      .mockResolvedValue({
        id: 'draft-new',
        orderId: 'ord1',
        versionNumber: 0,
        status: CommercialProposalStatus.DRAFT,
        publishedAt: null,
        publishedByUserId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        lines: draftLines,
      });

    const initSpy = vi.spyOn(svc, 'initDraft').mockResolvedValue({
      id: 'draft-new',
      orderId: 'ord1',
      versionNumber: 0,
      status: 'DRAFT',
      publishedAt: null,
      publishedByUserId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lines: draftLines as never,
    });

    // ensureDraftForExcelImport: getDraft throws
    vi.spyOn(svc, 'getDraft').mockRejectedValueOnce(new NotFoundException('no draft'));

    const result = await svc.importExcelToDraft('ord1', {
      buffer: Buffer.from('x'),
      originalname: 'a.xlsx',
      mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    } as Express.Multer.File);

    expect(initSpy).toHaveBeenCalledTimes(1);
    expect(result.mode).toBe('created');
    expect(result.draftCreated).toBe(true);
  });

  it('fails when zero rows match', async () => {
    piExcel.parseWorkbook.mockResolvedValue({
      invoiceNoHint: null,
      emptyMatchKeyRows: [],
      lines: [
        {
          excelRow: 12,
          no: 99,
          matchKey: 'OI:nobody',
          quantity: 1,
          unitPrice: 1,
          description: null,
          productSizeMm: null,
          weightKg: null,
          volumeM3: null,
          modelName: null,
        },
      ],
    });

    await expect(
      svc.importExcelToDraft('ord1', {
        buffer: Buffer.from('x'),
        originalname: 'a.xlsx',
        mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      } as Express.Multer.File),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(putDraftSpy).not.toHaveBeenCalled();
  });

  it('dryRun returns changes without putDraft', async () => {
    const result = await svc.importExcelToDraft(
      'ord1',
      {
        buffer: Buffer.from('x'),
        originalname: 'a.xlsx',
        mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      } as Express.Multer.File,
      { dryRun: true },
    );

    expect(result.dryRun).toBe(true);
    expect(result.draft).toBeNull();
    expect(result.draftUpdatedAt).toBeTruthy();
    expect(result.updatedCount).toBe(1);
    expect(Array.isArray(result.changes)).toBe(true);
    expect(result.changes.some((c) => c.fields.some((f) => f.field === 'quantity'))).toBe(true);
    expect(result.changes.some((c) => c.fields.some((f) => f.field === 'unitPriceCny'))).toBe(
      true,
    );
    expect(putDraftSpy).not.toHaveBeenCalled();
  });

  it('putDraft rejects stale expectedUpdatedAt', async () => {
    putDraftSpy.mockRestore();
    await expect(
      svc.putDraft(
        'ord1',
        [
          {
            sourceOrderItemId: 'oi-1',
            sortOrder: 0,
            productId: 'p1',
            productVariantId: null,
            quantity: 1,
            unit: 'шт',
            snapshot: { productName: 'Chair', weightKg: 10, volumeLiters: 0.2 },
            offerUnitPrice: 5000,
            discountPercent: null,
            deliveryEta: null,
            lineNote: null,
          },
        ],
        { expectedUpdatedAt: '2000-01-01T00:00:00.000Z' },
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('dryRun without draft uses virtual lines and does not initDraft', async () => {
    prisma.commercialProposal.findFirst.mockResolvedValue(null);
    vi.spyOn(svc, 'getDraft').mockRejectedValue(new NotFoundException('no draft'));
    const initSpy = vi.spyOn(svc, 'initDraft');

    prisma.order.findUnique.mockResolvedValue({
      id: 'ord1',
      status: OrderStatus.PENDING_APPROVAL,
      items: [
        {
          id: 'oi-1',
          productId: 'p1',
          productVariantId: null,
          quantity: 2,
          unit: 'шт',
          price: { toString: () => '5000' } as never,
          sortOrder: 0,
          snapshot: { productName: 'Chair', weightKg: 10, volumeLiters: 0.2 },
          product: { id: 'p1', name: 'Chair' },
        },
      ],
    });

    const result = await svc.importExcelToDraft(
      'ord1',
      {
        buffer: Buffer.from('x'),
        originalname: 'a.xlsx',
        mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      } as Express.Multer.File,
      { dryRun: true },
    );

    expect(initSpy).not.toHaveBeenCalled();
    expect(result.mode).toBe('created');
    expect(result.draftCreated).toBe(false);
    expect(result.dryRun).toBe(true);
    expect(result.updatedCount).toBe(1);
    expect(putDraftSpy).not.toHaveBeenCalled();
  });
});
