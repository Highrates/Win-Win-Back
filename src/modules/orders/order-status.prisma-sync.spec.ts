import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { OrderStatus } from '@prisma/client';
import {
  ORDER_STATUS_DRAFT,
  ORDER_STATUS_FLOW,
} from '@win-win/order-status';

/** Значения enum `OrderStatus` из `schema.prisma` (источник для `prisma generate`). */
function orderStatusCodesFromPrismaSchema(): string[] {
  const schemaPath = join(__dirname, '../../../prisma/schema.prisma');
  const text = readFileSync(schemaPath, 'utf8');
  const block = text.match(/enum OrderStatus \{([\s\S]*?)\n\}/);
  if (!block) throw new Error('enum OrderStatus not found in schema.prisma');
  return block[1]
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, '').trim())
    .filter(Boolean);
}

describe('OrderStatus: Prisma schema ↔ @win-win/order-status', () => {
  it('schema.prisma и shared-пакет содержат один и тот же набор кодов', () => {
    const fromSchema = new Set(orderStatusCodesFromPrismaSchema());
    const fromPackage = new Set<string>([ORDER_STATUS_DRAFT, ...ORDER_STATUS_FLOW]);

    expect(fromSchema).toEqual(fromPackage);
  });

  it('сгенерированный Prisma OrderStatus совпадает с пакетом', () => {
    const prismaEnum = new Set<string>(Object.values(OrderStatus));
    const fromPackage = new Set<string>([ORDER_STATUS_DRAFT, ...ORDER_STATUS_FLOW]);
    expect(prismaEnum).toEqual(fromPackage);
  });
});
