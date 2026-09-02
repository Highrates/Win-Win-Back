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
    const r = await svc.listProductsForAdmin('диван', 2, 50, 'catalog', {
      brandId: 'b1',
    });
    expect(listProductsForAdmin).toHaveBeenCalledWith('диван', 2, 50, 'catalog', {
      brandId: 'b1',
    });
    expect(r).toEqual([{ id: '1' }]);
  });

  it('делегирует getDashboardCatalogSummary в CatalogProductAdminService', async () => {
    const getDashboardCatalogSummary = vi.fn().mockResolvedValue({
      noModifications: 1,
      noVariants: 2,
      activeEmpty: 3,
      elementEmptyPool: 4,
      compositeIncomplete: 5,
    });
    const svc = new CatalogAdminService(
      {} as never,
      {} as never,
      {} as never,
      { getDashboardCatalogSummary } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const r = await svc.getDashboardCatalogSummary();
    expect(getDashboardCatalogSummary).toHaveBeenCalledTimes(1);
    expect(r.noModifications).toBe(1);
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
