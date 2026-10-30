/** Normalized row ready to write into the PI template (cols A–T). */
export type PiExcelExportLine = {
  /** 1-based line number written to col A */
  no: number;
  /** Match key written to col T (OI:/SL:/FX:/N: — avoid KL published ids) */
  matchKey: string;
  modelName: string;
  quantity: number;
  /** Unit price for col F — CNY (¥) when known; null → leave cell empty */
  unitPrice: number | null;
  description?: string | null;
  /** Product size text for col J, e.g. "730*550*540" */
  productSizeMm?: string | null;
  /** Weight kg for cols O and P */
  weightKg?: number | null;
  /** Volume m³ for col R */
  volumeM3?: number | null;
  /** Optional image URL to embed in col B */
  imageUrl?: string | null;
};

/** Parsed patch from one Excel data row after import. */
export type PiExcelLinePatch = {
  /** Original Excel row number (1-based sheet row) */
  excelRow: number;
  /** Value from col A if present */
  no: number | null;
  /** Raw col T */
  matchKey: string | null;
  quantity: number | null;
  /** Col F — CNY for PI workflow */
  unitPrice: number | null;
  description: string | null;
  productSizeMm: string | null;
  /** Prefer gross (P), else net (O) */
  weightKg: number | null;
  volumeM3: number | null;
  /** Model/name from col D — informational; merge does not rename catalog products */
  modelName: string | null;
};

export type PiExcelParseResult = {
  invoiceNoHint: string | null;
  lines: PiExcelLinePatch[];
  /** Excel row numbers where col T (match key) was empty — fragile fallback to No. */
  emptyMatchKeyRows: number[];
};

export type PiExcelFieldChange = {
  field: string;
  before: string | number | null;
  after: string | number | null;
};

export type PiExcelLineChange = {
  lineId: string;
  label: string;
  excelRow: number;
  fields: PiExcelFieldChange[];
};

export type ParsedMatchKey =
  | { kind: 'OI' | 'KL' | 'SL'; id: string }
  /** Freeform: hash only. Optional legacySortOrder from old `FX:{no}:{hash}` exports. */
  | { kind: 'FX'; hash: string; legacySortOrder?: number }
  | { kind: 'N'; n: number }
  | null;

export type PiExcelCurrency = 'CNY';

export type PiExcelMatchPair<T> = { line: T; patch: PiExcelLinePatch };

export type PiExcelMatchResult<T> = {
  pairs: PiExcelMatchPair<T>[];
  unmatched: string[];
};
