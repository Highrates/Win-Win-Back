import { describe, expect, it } from 'vitest';
import { isProductMinimallyFilled, isSoftValidProductLink } from './product-validation';

describe('isProductMinimallyFilled', () => {
  it('false when all fields empty', () => {
    expect(isProductMinimallyFilled({})).toBe(false);
    expect(isProductMinimallyFilled({ name: '  ', referenceCount: 0 })).toBe(false);
  });

  it('true when any signal present', () => {
    expect(isProductMinimallyFilled({ name: 'Стул' })).toBe(true);
    expect(isProductMinimallyFilled({ description: 'Описание' })).toBe(true);
    expect(isProductMinimallyFilled({ productLink: 'https://shop.test/item' })).toBe(true);
    expect(isProductMinimallyFilled({ referenceCount: 1 })).toBe(true);
  });
});

describe('isSoftValidProductLink', () => {
  it('accepts empty', () => {
    expect(isSoftValidProductLink('')).toBe(true);
    expect(isSoftValidProductLink(undefined)).toBe(true);
  });

  it('accepts host with dot', () => {
    expect(isSoftValidProductLink('shop.example.com/item')).toBe(true);
    expect(isSoftValidProductLink('https://shop.example.com')).toBe(true);
  });

  it('rejects invalid urls', () => {
    expect(isSoftValidProductLink('not a url')).toBe(false);
    expect(isSoftValidProductLink('localhost')).toBe(false);
  });
});
