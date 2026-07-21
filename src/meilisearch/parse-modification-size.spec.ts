import { describe, expect, it } from 'vitest';
import {
  parseModificationSizeLabel,
  sizeLabelMatchesRange,
} from './parse-modification-size';

describe('parseModificationSizeLabel', () => {
  it('берёт часть до · и сохраняет единицу', () => {
    expect(parseModificationSizeLabel('2700 × 1156 × 830 см · левый')).toBe(
      '2700 × 1156 × 830 см',
    );
  });

  it('принимает мм и м', () => {
    expect(parseModificationSizeLabel('800 × 600 мм')).toBe('800 × 600 мм');
    expect(parseModificationSizeLabel('2,4 м · высокий')).toBe('2,4 м');
  });

  it('принимает габариты без единицы', () => {
    expect(parseModificationSizeLabel('2400x1200')).toBe('2400x1200');
    expect(parseModificationSizeLabel('2000 × 800 · левый')).toBe('2000 × 800');
  });

  it('сравнивает первое число с диапазоном', () => {
    expect(sizeLabelMatchesRange('2400x1200', 2000, 2500)).toBe(true);
    expect(sizeLabelMatchesRange('2400x1200', 2500, undefined)).toBe(false);
    expect(sizeLabelMatchesRange('2400x1200', undefined, 2000)).toBe(false);
  });

  it('отбрасывает без единицы или без цифры', () => {
    expect(parseModificationSizeLabel('левый угол')).toBeNull();
    expect(parseModificationSizeLabel('большой')).toBeNull();
    expect(parseModificationSizeLabel('')).toBeNull();
  });
});
