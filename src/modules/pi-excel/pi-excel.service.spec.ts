import { describe, expect, it } from 'vitest';
import { PiExcelService } from './pi-excel.service';

describe('PiExcelService round-trip', () => {
  const svc = new PiExcelService();

  it('fills template and parses match keys back', async () => {
    const buf = await svc.buildWorkbook({
      invoiceNo: 'TEST-0001',
      lines: [
        {
          no: 1,
          matchKey: 'OI:order-item-1',
          modelName: 'Стул A',
          quantity: 5,
          unitPrice: 290,
          description: 'пластик',
          productSizeMm: '730*550*540',
          weightKg: 7.5,
          volumeM3: 0.289,
        },
        {
          no: 2,
          matchKey: 'KL:kp-line-2',
          modelName: 'Стул B',
          quantity: 3,
          unitPrice: 100,
          description: null,
          productSizeMm: null,
          weightKg: null,
          volumeM3: 0.1,
        },
      ],
    });
    expect(buf.byteLength).toBeGreaterThan(1000);

    const parsed = await svc.parseWorkbook(buf);
    expect(parsed.lines).toHaveLength(2);
    expect(parsed.lines[0]).toMatchObject({
      no: 1,
      matchKey: 'OI:order-item-1',
      quantity: 5,
      unitPrice: 290,
      weightKg: 7.5,
      volumeM3: 0.289,
      productSizeMm: '730*550*540',
    });
    expect(parsed.lines[1]).toMatchObject({
      no: 2,
      matchKey: 'KL:kp-line-2',
      quantity: 3,
      unitPrice: 100,
      volumeM3: 0.1,
    });
  });

  it('volume m³ round-trip preserves known value 0.289', async () => {
    const known = 0.289;
    const buf = await svc.buildWorkbook({
      lines: [
        {
          no: 1,
          matchKey: 'OI:vol-1',
          modelName: 'Vol',
          quantity: 1,
          unitPrice: 1,
          volumeM3: known,
        },
      ],
    });
    const parsed = await svc.parseWorkbook(buf);
    expect(parsed.lines[0]!.volumeM3).toBe(known);
  });

  it('skips price/sum and weight cells when values are null', async () => {
    const ExcelJS = (await import('exceljs')).default;
    const buf = await svc.buildWorkbook({
      lines: [
        {
          no: 1,
          matchKey: 'OI:blank-price',
          modelName: 'No price',
          quantity: 2,
          unitPrice: null,
          weightKg: null,
          volumeM3: null,
          productSizeMm: null,
        },
      ],
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ExcelJS.Buffer);
    const ws = wb.getWorksheet('Sheet1')!;
    expect(ws.getCell('F12').value).toBeNull();
    expect(ws.getCell('G12').value).toBeNull();
    expect(ws.getCell('O12').value).toBeNull();
    expect(ws.getCell('R12').value).toBeNull();
    expect(ws.getCell('D12').value).toBe('No price');
    expect(ws.getCell('E12').value).toBe(2);
  });

  it('narrow mode total volume formula is E*R (not N*R)', async () => {
    const ExcelJS = (await import('exceljs')).default;
    const buf = await svc.buildWorkbook({
      currencyLabel: 'CNY (¥)',
      entityLabel: 'ORDER',
      invoiceNo: 'ABC',
      lines: [
        {
          no: 1,
          matchKey: 'OI:1',
          modelName: 'A',
          quantity: 5,
          unitPrice: 10,
          volumeM3: 0.2,
        },
      ],
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ExcelJS.Buffer);
    const ws = wb.getWorksheet('Sheet1')!;
    const s12 = ws.getCell('S12').value as { formula?: string };
    expect(s12.formula).toBe('E12*R12');
    const f9 = String(ws.getCell('F9').value ?? '');
    expect(f9).toMatch(/CNY/);
  });

  it('rejects corrupted / non-xlsx buffer', async () => {
    await expect(svc.parseWorkbook(Buffer.from('not-an-xlsx'))).rejects.toThrow(/прочитать|xlsx/i);
  });

  it('assertXlsxUpload rejects missing file', () => {
    expect(() => svc.assertXlsxUpload(undefined)).toThrow(/не передан/i);
  });
});
