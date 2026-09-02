import { describe, expect, it } from 'vitest';
import {
  parseProductAdminHygieneFilter,
  pickAdminListPrice,
  productAdminHygieneWhere,
} from './catalog-product-admin.service';

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

describe('productAdminHygieneWhere', () => {
  it('parse принимает только известные ключи', () => {
    expect(parseProductAdminHygieneFilter('no_modifications')).toBe('no_modifications');
    expect(parseProductAdminHygieneFilter('ACTIVE_EMPTY')).toBe('active_empty');
    expect(parseProductAdminHygieneFilter('unknown')).toBeUndefined();
  });

  it('no_modifications — нет модификаций', () => {
    expect(productAdminHygieneWhere('no_modifications')).toEqual({
      modifications: { none: {} },
    });
  });

  it('no_variants — есть модификации, нет вариантов', () => {
    expect(productAdminHygieneWhere('no_variants')).toEqual({
      AND: [{ modifications: { some: {} } }, { variants: { none: {} } }],
    });
  });

  it('active_empty — активен и (нет модов или нет вариантов)', () => {
    expect(productAdminHygieneWhere('active_empty')).toEqual({
      isActive: true,
      OR: [{ modifications: { none: {} } }, { variants: { none: {} } }],
    });
  });

  it('element_empty_pool — элемент без availabilities', () => {
    expect(productAdminHygieneWhere('element_empty_pool')).toEqual({
      elements: { some: { availabilities: { none: {} } } },
    });
  });

  it('composite_incomplete — есть элементы и дыра в пуле или вариантах', () => {
    expect(productAdminHygieneWhere('composite_incomplete')).toEqual({
      AND: [
        { elements: { some: {} } },
        {
          OR: [
            { elements: { some: { availabilities: { none: {} } } } },
            { variants: { none: {} } },
          ],
        },
      ],
    });
  });
});
