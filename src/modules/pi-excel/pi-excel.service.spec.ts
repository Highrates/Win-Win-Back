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
          brand: 'balandis',
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
      brand: 'balandis',
      modelName: 'Стул A',
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
    const ExcelJS = await import('exceljs');
    const ExcelNS = (ExcelJS as { default?: typeof ExcelJS } & typeof ExcelJS).default ?? ExcelJS;
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
    const wb = new ExcelNS.Workbook();
    await wb.xlsx.load(buf as unknown as ExcelJS.Buffer);
    const ws = wb.getWorksheet('Sheet1')!;
    // H4 = price, I4 = sum, J4 = weight, L4 = volume (data starts at row 4)
    expect(ws.getCell('H4').value).toBeNull();
    expect(ws.getCell('I4').value).toBeNull();
    expect(ws.getCell('J4').value).toBeNull();
    expect(ws.getCell('L4').value).toBeNull();
    expect(ws.getCell('C4').value).toBe('No price');
    expect(ws.getCell('G4').value).toBe(2);
  });

  it('row formulas are G*H / G*J / L*G and totals SUM I/K/M', async () => {
    const ExcelJS = await import('exceljs');
    const ExcelNS = (ExcelJS as { default?: typeof ExcelJS } & typeof ExcelJS).default ?? ExcelJS;
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
          weightKg: 2,
          volumeM3: 0.2,
        },
      ],
    });
    const wb = new ExcelNS.Workbook();
    await wb.xlsx.load(buf as unknown as ExcelJS.Buffer);
    const ws = wb.getWorksheet('Sheet1')!;
    expect((ws.getCell('I4').value as { formula?: string }).formula).toBe('G4*H4');
    expect((ws.getCell('K4').value as { formula?: string }).formula).toBe('G4*J4');
    expect((ws.getCell('M4').value as { formula?: string }).formula).toBe('L4*G4');
    expect((ws.getCell('I5').value as { formula?: string }).formula).toBe('SUM(I4:I4)');
    expect(String(ws.getCell('A2').value ?? '')).toMatch(/INVOICE/);
    expect(String(ws.getCell('A2').value ?? '')).toMatch(/ABC/);
  });

  it('rejects corrupted / non-xlsx buffer', async () => {
    await expect(svc.parseWorkbook(Buffer.from('not-an-xlsx'))).rejects.toThrow(/прочитать|xlsx/i);
  });

  it('assertXlsxUpload rejects missing file', () => {
    expect(() => svc.assertXlsxUpload(undefined)).toThrow(/не передан/i);
  });
});
