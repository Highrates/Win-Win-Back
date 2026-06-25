import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { SOURCING_MAX_PRODUCTS } from '../sourcing-limits.constants';
import { parseCreateSourcingRequestPayload } from './create-sourcing-request.dto';

describe('parseCreateSourcingRequestPayload', () => {
  it('принимает валидный payload', () => {
    const dto = parseCreateSourcingRequestPayload(
      JSON.stringify({
        title: 'Подбор дивана',
        products: [{ name: 'Диван', quantity: 2, unit: 'шт' }],
      }),
    );
    expect(dto.title).toBe('Подбор дивана');
    expect(dto.products).toHaveLength(1);
    expect(dto.products[0]?.quantity).toBe(2);
  });

  it('отклоняет больше 50 товаров', () => {
    const products = Array.from({ length: SOURCING_MAX_PRODUCTS + 1 }, (_, i) => ({
      name: `Товар ${i + 1}`,
    }));
    expect(() =>
      parseCreateSourcingRequestPayload(JSON.stringify({ title: 'Заявка', products })),
    ).toThrow(BadRequestException);
  });

  it('отклоняет пустое название заявки', () => {
    expect(() =>
      parseCreateSourcingRequestPayload(
        JSON.stringify({ title: '   ', products: [{ name: 'Стул' }] }),
      ),
    ).toThrow(BadRequestException);
  });

  it('отклоняет слишком длинный title', () => {
    expect(() =>
      parseCreateSourcingRequestPayload(
        JSON.stringify({
          title: 'x'.repeat(201),
          products: [{ name: 'Стул' }],
        }),
      ),
    ).toThrow(BadRequestException);
  });

  it('отклоняет произвольную unit', () => {
    expect(() =>
      parseCreateSourcingRequestPayload(
        JSON.stringify({
          title: 'Заявка',
          products: [{ name: 'Стул', unit: 'ящик' }],
        }),
      ),
    ).toThrow(BadRequestException);
  });
});
