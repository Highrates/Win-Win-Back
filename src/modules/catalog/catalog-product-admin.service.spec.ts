import { describe, expect, it } from 'vitest';
import { pickAdminListPrice } from './catalog-product-admin.service';

describe('pickAdminListPrice', () => {
  it('берёт min среди активных с price > 0, игнорируя isDefault=0', () => {
    const r = pickAdminListPrice([
      { price: { toString: () => '0' }, currency: 'RUB', isActive: true },
      { price: { toString: () => '45000' }, currency: 'RUB', isActive: true },
      { price: { toString: () => '52000' }, currency: 'RUB', isActive: true },
    ]);
    expect(r).toEqual({ price: '45000', currency: 'RUB' });
  });

  it('если нет активных с ценой — берёт min среди неактивных с price > 0', () => {
    const r = pickAdminListPrice([
      { price: { toString: () => '0' }, currency: 'RUB', isActive: true },
      { price: { toString: () => '12000' }, currency: 'RUB', isActive: false },
    ]);
    expect(r).toEqual({ price: '12000', currency: 'RUB' });
  });

  it('без вариантов — 0 RUB', () => {
    expect(pickAdminListPrice([])).toEqual({ price: '0', currency: 'RUB' });
  });
});
