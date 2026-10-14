import { describe, expect, it } from 'vitest';
import {
  isValidRussianBankAccount,
  isValidRussianBic,
  isValidRussianInn,
  isValidRussianPhone,
} from './russian-bank-requisites';

describe('isValidRussianInn', () => {
  it('принимает валидный 10-значный ИНН', () => {
    expect(isValidRussianInn('7707083893')).toBe(true);
  });

  it('принимает валидный 12-значный ИНН', () => {
    expect(isValidRussianInn('500100732259')).toBe(true);
  });

  it('отклоняет неверную контрольную сумму', () => {
    expect(isValidRussianInn('7707083894')).toBe(false);
    expect(isValidRussianInn('123')).toBe(false);
  });
});

describe('isValidRussianBic', () => {
  it('принимает 9 цифр', () => {
    expect(isValidRussianBic('044525225')).toBe(true);
  });

  it('отклоняет другую длину', () => {
    expect(isValidRussianBic('04452522')).toBe(false);
  });
});

describe('isValidRussianBankAccount', () => {
  it('пустой счёт — ok', () => {
    expect(isValidRussianBankAccount('', '044525225')).toBe(true);
  });

  it('принимает счёт с верным ключом', () => {
    expect(isValidRussianBankAccount('40817810099910004316', '044525225')).toBe(true);
  });

  it('отклоняет счёт без валидного ключа', () => {
    expect(isValidRussianBankAccount('40817810099910004312', '044525225')).toBe(false);
  });
});

describe('isValidRussianPhone', () => {
  it('пустой — ok', () => {
    expect(isValidRussianPhone('')).toBe(true);
    expect(isValidRussianPhone('   ')).toBe(true);
  });

  it('принимает +7 / 8 / 10 цифр мобильного', () => {
    expect(isValidRussianPhone('+7 900 111-22-33')).toBe(true);
    expect(isValidRussianPhone('89001112233')).toBe(true);
    expect(isValidRussianPhone('9001112233')).toBe(true);
  });

  it('отклоняет слишком короткий / немобильный 10-значный', () => {
    expect(isValidRussianPhone('12345')).toBe(false);
    expect(isValidRussianPhone('4951234567')).toBe(false);
  });
});
