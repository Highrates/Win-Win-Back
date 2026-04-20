import { describe, expect, it, vi } from 'vitest';
import { CatalogAdminService } from './catalog-admin.service';

describe('CatalogAdminService', () => {
  it('делегирует listProductsForAdmin в CatalogProductAdminService', async () => {
    const listProductsForAdmin = vi.fn().mockResolvedValue([{ id: '1' }]);
    const svc = new CatalogAdminService(
      {} as never,
      {} as never,
      {} as never,
      { listProductsForAdmin } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const r = await svc.listProductsForAdmin('диван');
    expect(listProductsForAdmin).toHaveBeenCalledWith('диван');
    expect(r).toEqual([{ id: '1' }]);
  });

  it('делегирует recalculateAllFormulaProductPrices в CatalogVariantPricingService', async () => {
    const recalculateAllFormulaProductPrices = vi.fn().mockResolvedValue(undefined);
    const svc = new CatalogAdminService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { recalculateAllFormulaProductPrices } as never,
      {} as never,
      {} as never,
    );
    await svc.recalculateAllFormulaProductPrices();
    expect(recalculateAllFormulaProductPrices).toHaveBeenCalledTimes(1);
  });
});
