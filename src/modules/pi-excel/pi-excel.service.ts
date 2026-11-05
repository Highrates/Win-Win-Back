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

/** KP template «шаблон кп с формулами»: header row 3, data from row 4, cols A–N. */
const HEADER_ROW = 3;
const DATA_START_ROW = 4;
const TITLE_CELL = 'A2';
const COL = {
  no: 1,
  photo: 2,
  model: 3,
  brand: 4,
  size: 5,
  description: 6,
  qty: 7,
  price: 8,
  sum: 9,
  grossWeight: 10,
  totalWeight: 11,
  volumeUnit: 12,
  totalVolume: 13,
  matchKey: 14,
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
    const invoiceParts = [
      opts.invoiceNo?.trim() ? `#${opts.invoiceNo.trim()}` : null,
      entity ? `[${entity}]` : null,
      currency ? `(${currency})` : null,
    ].filter(Boolean);
    ws.getCell(TITLE_CELL).value = invoiceParts.length
      ? `INVOICE ${invoiceParts.join(' ')}`
      : 'INVOICE';

    const lines = opts.lines;
    let row = DATA_START_ROW;
    for (const line of lines) {
      ws.getCell(row, COL.no).value = line.no;
      ws.getCell(row, COL.model).value = line.modelName;
      if (line.brand?.trim()) ws.getCell(row, COL.brand).value = line.brand.trim();
      ws.getCell(row, COL.qty).value = line.quantity;
      // Missing price/dims/weight/volume → leave cells blank (export must not fail).
      if (line.unitPrice != null && Number.isFinite(line.unitPrice)) {
        ws.getCell(row, COL.price).value = line.unitPrice;
        ws.getCell(row, COL.sum).value = { formula: `G${row}*H${row}` };
      }
      if (line.description) ws.getCell(row, COL.description).value = line.description;
      if (line.productSizeMm) ws.getCell(row, COL.size).value = line.productSizeMm;
      if (line.weightKg != null) {
        ws.getCell(row, COL.grossWeight).value = line.weightKg;
        ws.getCell(row, COL.totalWeight).value = { formula: `G${row}*J${row}` };
      }
      if (line.volumeM3 != null) {
        ws.getCell(row, COL.volumeUnit).value = line.volumeM3;
        ws.getCell(row, COL.totalVolume).value = { formula: `L${row}*G${row}` };
      }
      const matchCell = ws.getCell(row, COL.matchKey);
      matchCell.value = line.matchKey;
      // Duplicate key in cell note — survives if col N is cleared by suppliers
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
    try {
      ws.mergeCells(totalRow, COL.no, totalRow, COL.description);
    } catch {
      /* already merged / out of range — still write label */
    }
    ws.getCell(totalRow, COL.no).value = 'Всего';
    if (lines.length > 0) {
      const first = DATA_START_ROW;
      const last = totalRow - 1;
      ws.getCell(totalRow, COL.sum).value = { formula: `SUM(I${first}:I${last})` };
      ws.getCell(totalRow, COL.totalWeight).value = { formula: `SUM(K${first}:K${last})` };
      ws.getCell(totalRow, COL.totalVolume).value = { formula: `SUM(M${first}:M${last})` };
    }

    // Hide match-key column; key also lives in cell notes.
    ws.getColumn(COL.matchKey).hidden = true;
    const headerN = ws.getCell(HEADER_ROW, COL.matchKey);
    if (!headerN.value) headerN.value = '№ в письме / match';

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
        `Ожидается шаблон КП (заголовок No. в строке ${HEADER_ROW})`,
      );
    }

    const invoiceNoHint = extractInvoiceHint(ws.getCell(TITLE_CELL).value);

    const lines: PiExcelLinePatch[] = [];
    const emptyMatchKeyRows: number[] = [];
    // No fixed line cap — scan the used range (and a generous floor for sparse sheets).
    const maxRow = Math.max(
      ws.actualRowCount || 0,
      ws.rowCount || 0,
      DATA_START_ROW + 10_000,
    );

    for (let r = DATA_START_ROW; r <= maxRow; r++) {
      const noRaw = ws.getCell(r, COL.no).value;
      const noText = cellToText(excelCellPrimitive(noRaw));
      if (noText && /всего|total|sum/i.test(noText)) break;

      const matchKey = cellToText(excelCellPrimitive(ws.getCell(r, COL.matchKey).value));
      const modelName = cellToText(excelCellPrimitive(ws.getCell(r, COL.model).value));
      const brand = cellToText(excelCellPrimitive(ws.getCell(r, COL.brand).value));
      const qty = cellToInt(excelCellPrimitive(ws.getCell(r, COL.qty).value));
      const unitPrice = cellToNumber(excelCellPrimitive(ws.getCell(r, COL.price).value));
      const description = cellToText(excelCellPrimitive(ws.getCell(r, COL.description).value));
      const productSizeMm = cellToText(excelCellPrimitive(ws.getCell(r, COL.size).value));
      const gross = cellToNumber(excelCellPrimitive(ws.getCell(r, COL.grossWeight).value));
      const volumeM3 = cellToNumber(excelCellPrimitive(ws.getCell(r, COL.volumeUnit).value));
      const no = cellToInt(excelCellPrimitive(noRaw));

      // Skip empty continuation rows
      const hasSignal =
        no != null ||
        matchKey != null ||
        (modelName != null && (qty != null || unitPrice != null));
      if (!hasSignal) {
        if (lines.length > 0 && !modelName && qty == null && unitPrice == null && !matchKey) {
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

      if (no == null && matchKey == null && (modelName == null || (qty == null && unitPrice == null))) {
        continue;
      }

      if (!matchKey) emptyMatchKeyRows.push(r);

      // Prefer note text if cell N cleared but comment still holds the key
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
        weightKg: gross != null && gross > 0 ? gross : null,
        volumeM3: volumeM3 != null && volumeM3 > 0 ? volumeM3 : null,
        modelName,
        brand,
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
  const m =
    /(?:INVOICE\s*#?\s*|Invoice No\.?:|Номер инвойса\.?:)\s*(.+)/i.exec(t) ||
    /#([A-Za-z0-9_-]+)/.exec(t);
  return m?.[1]?.trim() || t.trim() || null;
}

function guessImageExt(url: string, buf: Buffer): 'png' | 'jpeg' | 'gif' {
  const lower = url.toLowerCase();
  if (lower.includes('.png') || (buf[0] === 0x89 && buf[1] === 0x50)) return 'png';
  if (lower.includes('.gif') || (buf[0] === 0x47 && buf[1] === 0x49)) return 'gif';
  return 'jpeg';
}
