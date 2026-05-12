import { describe, expect, it } from 'vitest';
import { orderItemSnapshotMetaRows } from './meta-rows';

describe('orderItemSnapshotMetaRows', () => {
  it('returns modification and element rows', () => {
    const rows = orderItemSnapshotMetaRows({
      modificationLabel: '  200×90  ',
      elementMaterialRows: [
        { elementLabel: 'Обивка', materialColorLabel: 'Кожа чёрная' },
        { elementLabel: '', materialColorLabel: 'Дуб' },
      ],
    });
    expect(rows).toEqual([
      { label: 'Модификация', value: '200×90' },
      { label: 'Обивка', value: 'Кожа чёрная' },
      { label: 'Элемент', value: 'Дуб' },
    ]);
  });

  it('respects custom labels', () => {
    const rows = orderItemSnapshotMetaRows(
      { modificationLabel: 'L', elementMaterialRows: [{ elementLabel: 'A', materialColorLabel: 'B' }] },
      { modification: '配置', elementFallback: '部件' },
    );
    expect(rows[0]).toEqual({ label: '配置', value: 'L' });
    expect(rows[1]).toEqual({ label: 'A', value: 'B' });
  });

  it('handles null and non-objects', () => {
    expect(orderItemSnapshotMetaRows(null)).toEqual([]);
    expect(orderItemSnapshotMetaRows([])).toEqual([]);
  });
});
