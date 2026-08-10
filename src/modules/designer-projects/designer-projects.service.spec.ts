import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DesignerProjectsService } from './designer-projects.service';

describe('DesignerProjectsService.validateLinesProducts', () => {
  const prisma = {
    product: { findMany: vi.fn() },
    productVariant: { findMany: vi.fn() },
  };
  let service: DesignerProjectsService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new DesignerProjectsService(prisma as never, {} as never);
  });

  const line = (productId: string, productVariantId?: string) => ({
    roomKey: '__winwin_default_room__',
    productId,
    productVariantId,
    quantity: 1,
    unit: 'шт',
  });

  it('allows inactive products that were already on the project', async () => {
    prisma.product.findMany.mockResolvedValue([
      { id: 'dead', isActive: false },
      { id: 'alive', isActive: true },
    ]);

    await expect(
      service['validateLinesProducts']([line('dead'), line('alive')], {
        allowInactiveProductIds: new Set(['dead']),
      }),
    ).resolves.toBeUndefined();
  });

  it('rejects inactive products that are newly added', async () => {
    prisma.product.findMany.mockResolvedValue([
      { id: 'alive', isActive: true },
      { id: 'new-dead', isActive: false },
    ]);

    await expect(
      service['validateLinesProducts']([line('alive'), line('new-dead')], {
        allowInactiveProductIds: new Set(['alive']),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('still requires active products when no grandfather set is passed (create)', async () => {
    prisma.product.findMany.mockResolvedValue([{ id: 'dead', isActive: false }]);

    await expect(service['validateLinesProducts']([line('dead')])).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('allows inactive variants already on the project', async () => {
    prisma.product.findMany.mockResolvedValue([{ id: 'p1', isActive: true }]);
    prisma.productVariant.findMany.mockResolvedValue([
      { id: 'v-dead', productId: 'p1', isActive: false },
    ]);

    await expect(
      service['validateLinesProducts']([line('p1', 'v-dead')], {
        allowInactiveProductIds: new Set(['p1']),
        allowInactiveVariantIds: new Set(['v-dead']),
      }),
    ).resolves.toBeUndefined();
  });
});
