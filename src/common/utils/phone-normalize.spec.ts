import { describe, expect, it } from 'vitest';
import {
  normalizeEmailOrPhoneForLookup,
  normalizePhoneDigitsForLookup,
} from './phone-normalize';

describe('phone-normalize', () => {
  it('normalizePhoneDigitsForLookup: +7 и пробелы → только цифры', () => {
    expect(normalizePhoneDigitsForLookup('+7 (913) 910-32-71')).toBe('79139103271');
    expect(normalizePhoneDigitsForLookup('79139103271')).toBe('79139103271');
  });

  it('normalizePhoneDigitsForLookup: email → пусто', () => {
    expect(normalizePhoneDigitsForLookup('a@b.com')).toBe('');
  });

  it('normalizeEmailOrPhoneForLookup: email lower case', () => {
    expect(normalizeEmailOrPhoneForLookup('  User@Example.COM ')).toEqual({
      kind: 'email',
      value: 'user@example.com',
    });
  });

  it('normalizeEmailOrPhoneForLookup: phone', () => {
    expect(normalizeEmailOrPhoneForLookup('+79139103271')).toEqual({
      kind: 'phone',
      value: '79139103271',
    });
  });

  it('normalizeEmailOrPhoneForLookup: слишком короткий телефон → null', () => {
    expect(normalizeEmailOrPhoneForLookup('12345')).toBeNull();
  });
});
