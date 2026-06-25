import { describe, expect, it } from 'vitest';
import { resolveSourcingProductDisplayName, resolveSourcingProductStoredName } from './product-name';

describe('resolveSourcingProductStoredName', () => {
  it('использует явное имя', () => {
    expect(
      resolveSourcingProductStoredName({
        name: '  Диван  ',
        requestTitle: 'Лобби ЖК',
        productIndex: 0,
        productCount: 2,
      }),
    ).toBe('Диван');
  });

  it('для одного товара без name берёт title заявки', () => {
    expect(
      resolveSourcingProductStoredName({
        name: '',
        requestTitle: 'Подбор дивана',
        productIndex: 0,
        productCount: 1,
      }),
    ).toBe('Подбор дивана');
  });

  it('для нескольких товаров без name — «Товар N»', () => {
    expect(
      resolveSourcingProductStoredName({
        requestTitle: 'Комплект мебели',
        productIndex: 1,
        productCount: 3,
      }),
    ).toBe('Товар 2');
  });
});

describe('resolveSourcingProductDisplayName', () => {
  it('legacy «—» в БД → «Товар N» или title', () => {
    expect(
      resolveSourcingProductDisplayName({
        name: '—',
        requestTitle: 'Подбор дивана',
        productIndex: 0,
        productCount: 1,
      }),
    ).toBe('Подбор дивана');
    expect(
      resolveSourcingProductDisplayName({
        name: '—',
        requestTitle: 'Комплект',
        productIndex: 1,
        productCount: 2,
      }),
    ).toBe('Товар 2');
  });
});
