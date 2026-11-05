/** Normalized row ready to write into the KP PI template (cols A–N). */
export type PiExcelExportLine = {
  /** 1-based line number written to col A */
  no: number;
  /** Match key written to col N (OI:/SL:/FX:/N: — avoid KL published ids) */
  matchKey: string;
  /** Product name — col C «Наименование» */
  modelName: string;
  /** Brand — col D «Бренд» */
  brand?: string | null;
  quantity: number;
  /** Unit price for col H — CNY (¥) when known; null → leave cell empty */
  unitPrice: number | null;
  description?: string | null;
  /** Product size text for col E, e.g. "730*550*540" */
  productSizeMm?: string | null;
  /** Unit gross weight kg for col J */
  weightKg?: number | null;
  /** Unit volume m³ for col L */
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
  /** Raw col N match key */
  matchKey: string | null;
  quantity: number | null;
  /** Col H — CNY for PI workflow */
  unitPrice: number | null;
  description: string | null;
  productSizeMm: string | null;
  /** Col J gross weight kg */
  weightKg: number | null;
  volumeM3: number | null;
  /** Name from col C — informational for orders; used when adding sourcing lines */
  modelName: string | null;
  /** Brand from col D — informational */
  brand: string | null;
};

export type PiExcelParseResult = {
  invoiceNoHint: string | null;
  lines: PiExcelLinePatch[];
  /** Excel row numbers where col N (match key) was empty — fragile fallback to No. */
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
  /** Human-readable unmatched reasons (incl. already-matched collisions). */
  unmatched: string[];
  /** Excel rows with no draft target — candidates to append as new KP lines (sourcing). */
  unmatchedPatches: PiExcelLinePatch[];
};
