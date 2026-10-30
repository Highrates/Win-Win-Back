import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { join } from 'path';
/** Namespace import: Nest CJS emit uses `exceljs.default` for default import, but exceljs has no `.default`. */
import * as ExcelJS from 'exceljs';
import {
  cellToInt,
  cellToNumber,
  cellToText,
} from './pi-excel-map';
import type { PiExcelExportLine, PiExcelLinePatch, PiExcelParseResult } from './pi-excel.types';

const HEADER_ROW = 11;
const DATA_START_ROW = 12;
/** Columns A..T */
const COL = {
  no: 1,
  photo: 2,
  model: 4,
  qty: 5,
  price: 6,
  sum: 7,
  description: 9,
  size: 10,
  netWeight: 15,
  grossWeight: 16,
  totalWeight: 17,
  volumeUnit: 18,
  totalVolume: 19,
  matchKey: 20,
} as const;

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const MAX_BYTES = 10 * 1024 * 1024;

@Injectable()
export class PiExcelService {
  private readonly logger = new Logger(PiExcelService.name);

  resolveTemplatePath(): string {
    const candidates = [
      join(process.cwd(), 'assets', 'pi-invoice-template.xlsx'),
      join(process.cwd(), 'backend', 'assets', 'pi-invoice-template.xlsx'),
      join(__dirname, '..', '..', '..', 'assets', 'pi-invoice-template.xlsx'),
    ];
    for (const p of candidates) {
      if (existsSync(p)) return p;
    }
    throw new BadRequestException('PI Excel шаблон не найден на сервере');
  }

  assertXlsxUpload(file: Express.Multer.File | undefined): Buffer {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Файл не передан');
    }
    if (file.buffer.byteLength > MAX_BYTES) {
      throw new BadRequestException('Файл Excel слишком большой (макс. 10 МБ)');
    }
    const name = (file.originalname || '').toLowerCase();
    const mime = (file.mimetype || '').toLowerCase();
    const okExt = name.endsWith('.xlsx');
    const okMime =
      !mime ||
      mime === XLSX_MIME ||
      mime === 'application/octet-stream' ||
      mime === 'application/zip';
    if (!okExt || !okMime) {
      throw new BadRequestException('Нужен файл .xlsx');
    }
    return file.buffer;
  }

  async buildWorkbook(opts: {
    lines: PiExcelExportLine[];
    invoiceNo?: string | null;
    /** Entity tag in invoice header, e.g. ORDER / SOURCING */
    entityLabel?: string | null;
    /** Price column currency — PI workflow is always CNY */
    currencyLabel?: string | null;
    /** Optional absolute/relative image fetch */
    fetchImage?: (url: string) => Promise<Buffer | null>;
  }): Promise<Buffer> {
    const templatePath = this.resolveTemplatePath();
    const templateBuf = await readFile(templatePath);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(templateBuf as unknown as ExcelJS.Buffer);

    const ws = wb.getWorksheet('Sheet1') ?? wb.worksheets[0];
    if (!ws) throw new BadRequestException('В шаблоне нет листа');

    const currency = (opts.currencyLabel?.trim() || 'CNY (¥)').trim();
    const entity = opts.entityLabel?.trim();

    if (opts.invoiceNo?.trim() || entity) {
      const f6 = ws.getCell('F6');
      const prev = typeof f6.value === 'string' ? f6.value : 'Invoice No.:  \nНомер инвойса.: ';
      const base = prev.includes('Invoice No')
        ? prev.replace(/\s*$/, '')
        : 'Invoice No.:  \nНомер инвойса.: ';
      const parts = [opts.invoiceNo?.trim(), entity ? `[${entity}]` : null].filter(Boolean);
      f6.value = `${base} ${parts.join(' ')}`;
    }

    // Explicit currency next to payment/delivery block (F8 area is busy; use F9 label strip)
    const f9 = ws.getCell('F9');
    const f9Prev = typeof f9.value === 'string' ? f9.value : '';
    if (!/Currency|Валюта/i.test(f9Prev)) {
      f9.value = `Currency / Валюта цены (col F): ${currency}${f9Prev ? `\n${f9Prev}` : ''}`;
    } else {
      f9.value = f9Prev.replace(
        /Currency\s*\/\s*Валюта[^\n]*/i,
        `Currency / Валюта цены (col F): ${currency}`,
      );
    }

    const lines = opts.lines;
    let row = DATA_START_ROW;
    for (const line of lines) {
      ws.getCell(row, COL.no).value = line.no;
      ws.getCell(row, COL.model).value = line.modelName;
      ws.getCell(row, COL.qty).value = line.quantity;
      // Missing price/dims/weight/volume → leave cells blank (export must not fail).
      if (line.unitPrice != null && Number.isFinite(line.unitPrice)) {
        ws.getCell(row, COL.price).value = line.unitPrice;
        ws.getCell(row, COL.sum).value = { formula: `E${row}*F${row}` };
      }
      if (line.description) ws.getCell(row, COL.description).value = line.description;
      if (line.productSizeMm) ws.getCell(row, COL.size).value = line.productSizeMm;
      if (line.weightKg != null) {
        ws.getCell(row, COL.netWeight).value = line.weightKg;
        ws.getCell(row, COL.grossWeight).value = line.weightKg;
        ws.getCell(row, COL.totalWeight).value = { formula: `E${row}*P${row}` };
      }
      if (line.volumeM3 != null) {
        ws.getCell(row, COL.volumeUnit).value = line.volumeM3;
        // Narrow mapping: pack count (N) empty → total volume = qty × unit volume
        ws.getCell(row, COL.totalVolume).value = { formula: `E${row}*R${row}` };
      }
      const matchCell = ws.getCell(row, COL.matchKey);
      matchCell.value = line.matchKey;
      // Duplicate key in cell note — survives if col T is cleared by suppliers
      matchCell.note = {
        texts: [{ text: `Wupapa match key (do not delete):\n${line.matchKey}` }],
      };

      if (line.imageUrl && opts.fetchImage) {
        try {
          const img = await opts.fetchImage(line.imageUrl);
          if (img?.length) {
            const ext = guessImageExt(line.imageUrl, img);
            const imageId = wb.addImage({
              buffer: img as unknown as ExcelJS.Buffer,
              extension: ext,
            });
            ws.addImage(imageId, {
              tl: { col: COL.photo - 1, row: row - 1 },
              ext: { width: 64, height: 64 },
              editAs: 'oneCell',
            });
            const rd = ws.getRow(row);
            if (!rd.height || rd.height < 50) rd.height = 50;
          }
        } catch (e) {
          this.logger.warn(`PI excel image skip: ${line.imageUrl} — ${(e as Error).message}`);
        }
      }

      row += 1;
    }

    const totalRow = row;
    ws.getCell(totalRow, COL.no).value = 'Всего';
    if (lines.length > 0) {
      const first = DATA_START_ROW;
      const last = totalRow - 1;
      ws.getCell(totalRow, COL.qty).value = { formula: `SUM(E${first}:E${last})` };
      ws.getCell(totalRow, COL.sum).value = { formula: `SUM(G${first}:G${last})` };
      ws.getCell(totalRow, COL.totalWeight).value = { formula: `SUM(Q${first}:Q${last})` };
      ws.getCell(totalRow, COL.totalVolume).value = { formula: `SUM(S${first}:S${last})` };
    }

    // Hide match-key column so suppliers don't "clean" it; key also lives in cell notes.
    ws.getColumn(COL.matchKey).hidden = true;
    const headerT = ws.getCell(HEADER_ROW, COL.matchKey);
    if (!headerT.value) headerT.value = '№ в письме / match';

    // Soft sheet protect: keep qty/price (+ PI fill cols) editable; lock match key / formulas.
    // Empty password — suppliers can unprotect if needed, but casual unhide of T is harder.
    const unlockCols = [
      COL.qty,
      COL.price,
      COL.description,
      COL.size,
      COL.netWeight,
      COL.grossWeight,
      COL.volumeUnit,
    ] as const;
    for (let r = DATA_START_ROW; r < totalRow; r++) {
      for (const c of unlockCols) {
        ws.getCell(r, c).protection = { locked: false };
      }
      ws.getCell(r, COL.matchKey).protection = { locked: true };
    }
    try {
      await ws.protect('', {
        selectLockedCells: true,
        selectUnlockedCells: true,
        formatCells: false,
        formatColumns: false,
        formatRows: false,
        insertColumns: false,
        insertRows: true,
        insertHyperlinks: false,
        deleteColumns: false,
        deleteRows: false,
        sort: false,
        autoFilter: false,
        pivotTables: false,
      });
    } catch (e) {
      this.logger.warn(`PI excel sheet protect skipped: ${(e as Error).message}`);
    }

    const out = await wb.xlsx.writeBuffer();
    return Buffer.from(out);
  }

  async parseWorkbook(buf: Buffer): Promise<PiExcelParseResult> {
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(buf as unknown as ExcelJS.Buffer);
    } catch {
      throw new BadRequestException('Не удалось прочитать Excel (.xlsx)');
    }
    const ws = wb.getWorksheet('Sheet1') ?? wb.worksheets[0];
    if (!ws) throw new BadRequestException('В файле нет листа');

    const headerNo = String(ws.getCell(HEADER_ROW, COL.no).value ?? '').trim().toLowerCase();
    if (!headerNo.includes('no')) {
      throw new BadRequestException(
        `Ожидается шаблон PI (заголовок No. в строке ${HEADER_ROW})`,
      );
    }

    const invoiceNoHint = extractInvoiceHint(ws.getCell('F6').value);

    const lines: PiExcelLinePatch[] = [];
    const emptyMatchKeyRows: number[] = [];
    const maxRow = Math.max(ws.actualRowCount || 0, ws.rowCount || 0, DATA_START_ROW + 200);

    for (let r = DATA_START_ROW; r <= maxRow; r++) {
      const noRaw = ws.getCell(r, COL.no).value;
      const noText = cellToText(excelCellPrimitive(noRaw));
      if (noText && /всего|total|sum/i.test(noText)) break;

      const matchKey = cellToText(excelCellPrimitive(ws.getCell(r, COL.matchKey).value));
      const modelName = cellToText(excelCellPrimitive(ws.getCell(r, COL.model).value));
      const qty = cellToInt(excelCellPrimitive(ws.getCell(r, COL.qty).value));
      const unitPrice = cellToNumber(excelCellPrimitive(ws.getCell(r, COL.price).value));
      const description = cellToText(excelCellPrimitive(ws.getCell(r, COL.description).value));
      const productSizeMm = cellToText(excelCellPrimitive(ws.getCell(r, COL.size).value));
      const gross = cellToNumber(excelCellPrimitive(ws.getCell(r, COL.grossWeight).value));
      const net = cellToNumber(excelCellPrimitive(ws.getCell(r, COL.netWeight).value));
      const volumeM3 = cellToNumber(excelCellPrimitive(ws.getCell(r, COL.volumeUnit).value));
      const no = cellToInt(excelCellPrimitive(noRaw));

      // Skip empty continuation rows (multi-box packaging without No./match)
      const hasSignal =
        no != null ||
        matchKey != null ||
        (modelName != null && (qty != null || unitPrice != null));
      if (!hasSignal) {
        // stop if long empty streak after we already have lines
        if (lines.length > 0 && !modelName && qty == null && unitPrice == null && !matchKey) {
          // peek a few more empty rows then stop
          let empty = true;
          for (let k = 0; k < 3 && r + k <= maxRow; k++) {
            const peekNo = cellToText(excelCellPrimitive(ws.getCell(r + k, COL.no).value));
            const peekModel = cellToText(excelCellPrimitive(ws.getCell(r + k, COL.model).value));
            const peekKey = cellToText(excelCellPrimitive(ws.getCell(r + k, COL.matchKey).value));
            if (peekNo || peekModel || peekKey) {
              empty = false;
              break;
            }
          }
          if (empty) break;
        }
        continue;
      }

      // Multi-row packaging: row without No. and without match/model price — skip
      if (no == null && matchKey == null && (modelName == null || (qty == null && unitPrice == null))) {
        continue;
      }

      if (!matchKey) emptyMatchKeyRows.push(r);

      // Prefer note text if cell T cleared but comment still holds the key
      let resolvedKey = matchKey;
      if (!resolvedKey) {
        const note = ws.getCell(r, COL.matchKey).note;
        const noteText =
          typeof note === 'string'
            ? note
            : Array.isArray((note as { texts?: { text?: string }[] })?.texts)
              ? ((note as { texts: { text?: string }[] }).texts || []).map((t) => t.text || '').join('')
              : null;
        const fromNote = noteText ? /((?:OI|KL|SL|FX|N):[^\s]+)/i.exec(noteText) : null;
        if (fromNote?.[1]) resolvedKey = fromNote[1];
      }

      lines.push({
        excelRow: r,
        no,
        matchKey: resolvedKey,
        quantity: qty,
        unitPrice,
        description,
        productSizeMm,
        weightKg: gross != null && gross > 0 ? gross : net != null && net > 0 ? net : null,
        volumeM3: volumeM3 != null && volumeM3 > 0 ? volumeM3 : null,
        modelName,
      });
    }

    if (lines.length === 0) {
      throw new BadRequestException('В Excel нет строк позиций');
    }

    return { invoiceNoHint, lines, emptyMatchKeyRows };
  }
}

function excelCellPrimitive(value: ExcelJS.CellValue): unknown {
  if (value == null) return null;
  if (typeof value === 'object' && 'result' in (value as object)) {
    return (value as ExcelJS.CellFormulaValue).result ?? null;
  }
  if (typeof value === 'object' && 'richText' in (value as object)) {
    return ((value as ExcelJS.CellRichTextValue).richText ?? []).map((t) => t.text).join('');
  }
  if (typeof value === 'object' && 'text' in (value as object)) {
    return (value as ExcelJS.CellHyperlinkValue).text;
  }
  return value;
}

function extractInvoiceHint(value: ExcelJS.CellValue): string | null {
  const t = cellToText(excelCellPrimitive(value));
  if (!t) return null;
  const m = /(?:Invoice No\.?:|Номер инвойса\.?:)\s*(.+)/i.exec(t);
  return m?.[1]?.trim() || null;
}

function guessImageExt(url: string, buf: Buffer): 'png' | 'jpeg' | 'gif' {
  const lower = url.toLowerCase();
  if (lower.includes('.png') || (buf[0] === 0x89 && buf[1] === 0x50)) return 'png';
  if (lower.includes('.gif') || (buf[0] === 0x47 && buf[1] === 0x49)) return 'gif';
  return 'jpeg';
}
