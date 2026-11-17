#!/usr/bin/env ts-node
/**
 * Фаза 0: отчёт по папке products_to_add — матч Excel ↔ фото, без записи в БД.
 *
 * Usage (из backend/):
 *   npm run catalog:products-to-add-report
 *   npm run catalog:products-to-add-report -- --dir ../products_to_add
 *   npm run catalog:products-to-add-report -- --out ../products_to_add/_report
 */
import * as fs from 'fs';
import * as path from 'path';
import * as ExcelJS from 'exceljs';

type PhotoKind = 'white' | 'detail' | 'material';

type PhotoFile = {
  kind: PhotoKind;
  fileName: string;
  relPath: string;
  articleKey: string;
  articleNorm: string;
  seq: number | null;
};

type ExcelRow = {
  excelRow: number;
  articleRaw: string;
  articleClean: string;
  articleNorm: string;
  nameRaw: string | null;
  nameRu: string | null;
  categoryRaw: string | null;
  boxDimsMm: string | null;
  weightGrossKg: string | null;
  weightNetKg: string | null;
  volumeM3: string | null;
  priceSample: string | null;
  notes: string[];
};

function arg(name: string): string | undefined {
  const p = `--${name}=`;
  return process.argv.find((a) => a.startsWith(p))?.slice(p.length);
}

function csvEscape(value: string | number | boolean | null | undefined): string {
  const s = value == null ? '' : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function row(cols: (string | number | boolean | null | undefined)[]): string {
  return cols.map(csvEscape).join(',');
}

function cellText(value: ExcelJS.CellValue): string | null {
  if (value == null || value === '') return null;
  if (typeof value === 'object') {
    if ('richText' in value && Array.isArray((value as ExcelJS.CellRichTextValue).richText)) {
      const t = (value as ExcelJS.CellRichTextValue).richText.map((x) => x.text).join('').trim();
      return t || null;
    }
    if ('text' in value && typeof (value as ExcelJS.CellHyperlinkValue).text === 'string') {
      const t = String((value as ExcelJS.CellHyperlinkValue).text).trim();
      return t || null;
    }
    if ('result' in value) {
      const r = (value as ExcelJS.CellFormulaValue).result;
      if (r == null || r === '') return null;
      return String(r).trim() || null;
    }
    return null;
  }
  return String(value).trim() || null;
}

/** Normalize article for matching photos ↔ Excel. */
function normArticle(raw: string): string {
  return raw
    .split('\n')[0]!
    .replace(/（[^）]*）/g, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/缺少资料|视频无法下载/g, '')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function stripChineseParen(name: string): string {
  return name
    .replace(/（[^）]*）/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function guessBrand(name: string | null): string | null {
  if (!name) return null;
  const m = name.match(/\b(FALTO|SIHOO|RUPROFI|ZERO)\b/i);
  return m ? m[1]!.toUpperCase() : null;
}

const PHOTO_DIRS: { kind: PhotoKind; folder: string; prefix: RegExp }[] = [
  { kind: 'white', folder: 'Главное фото на белом фоне03', prefix: /^ZT=/i },
  { kind: 'detail', folder: 'Детальные интерьерные фото03', prefix: /^CJT=/i },
  { kind: 'material', folder: 'Фото материалов изделия03', prefix: /^YS=/i },
];

function parsePhotoFileName(fileName: string, kind: PhotoKind, folder: string): PhotoFile | null {
  if (!/\.jpe?g$/i.test(fileName)) return null;
  const bare = fileName.replace(/\.(jpe?g)$/i, '');
  // ZT=SKU 0101  or  ZT=SKU 0101 0102  or  CJT=SKU0101 (missing space)
  const m =
    /^(?:ZT|CJT|YS)=(.+?)\s+(\d{3,4})(?:\s+\d{3,4})*$/i.exec(bare) ||
    /^(?:ZT|CJT|YS)=(.+?)(\d{4})$/i.exec(bare);
  if (!m) {
    // fallback: strip prefix only
    const stripped = bare.replace(/^(?:ZT|CJT|YS)=/i, '').trim();
    if (!stripped) return null;
    return {
      kind,
      fileName,
      relPath: path.join(folder, fileName),
      articleKey: stripped,
      articleNorm: normArticle(stripped),
      seq: null,
    };
  }
  const articleKey = m[1]!.trim();
  const seq = Number.parseInt(m[2]!, 10);
  return {
    kind,
    fileName,
    relPath: path.join(folder, fileName),
    articleKey,
    articleNorm: normArticle(articleKey),
    seq: Number.isFinite(seq) ? seq : null,
  };
}

function scanPhotos(rootDir: string): {
  files: PhotoFile[];
  byNorm: Map<string, PhotoFile[]>;
  missingFolders: string[];
} {
  const files: PhotoFile[] = [];
  const missingFolders: string[] = [];
  for (const def of PHOTO_DIRS) {
    const abs = path.join(rootDir, def.folder);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
      missingFolders.push(def.folder);
      continue;
    }
    for (const name of fs.readdirSync(abs)) {
      const parsed = parsePhotoFileName(name, def.kind, def.folder);
      if (parsed) files.push(parsed);
    }
  }
  const byNorm = new Map<string, PhotoFile[]>();
  for (const f of files) {
    const list = byNorm.get(f.articleNorm) ?? [];
    list.push(f);
    byNorm.set(f.articleNorm, list);
  }
  for (const [, list] of byNorm) {
    list.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
      return (a.seq ?? 0) - (b.seq ?? 0) || a.fileName.localeCompare(b.fileName);
    });
  }
  return { files, byNorm, missingFolders };
}

async function parseExcel(xlsxPath: string): Promise<ExcelRow[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(xlsxPath);
  const ws = wb.getWorksheet('TDSheet') ?? wb.worksheets[0];
  if (!ws) throw new Error('В Excel нет листа TDSheet');

  const out: ExcelRow[] = [];
  const maxRow = ws.rowCount || 0;
  for (let r = 11; r <= maxRow; r++) {
    const articleRaw = cellText(ws.getCell(r, 2).value);
    if (!articleRaw) continue;
    if (/品名|货号|артикул/i.test(articleRaw) && articleRaw.length < 40) continue;

    const articleClean = articleRaw.split('\n')[0]!.trim();
    if (!articleClean) continue;

    const notes: string[] = [];
    if (articleRaw.includes('\n')) notes.push('article-multiline');
    if (/缺少资料/.test(articleRaw)) notes.push('missing-docs-cn');
    if (/视频无法下载/.test(articleRaw)) notes.push('video-fail-cn');

    const nameRaw = cellText(ws.getCell(r, 4).value);
    if (nameRaw && /[\u4e00-\u9fff]/.test(nameRaw)) notes.push('name-has-cn');

    const prices = [56, 58, 60, 62, 64, 66]
      .map((c) => cellText(ws.getCell(r, c).value))
      .filter(Boolean) as string[];

    out.push({
      excelRow: r,
      articleRaw,
      articleClean,
      articleNorm: normArticle(articleClean),
      nameRaw,
      nameRu: nameRaw ? stripChineseParen(nameRaw) : null,
      categoryRaw: cellText(ws.getCell(r, 50).value),
      boxDimsMm: cellText(ws.getCell(r, 5).value),
      weightGrossKg: cellText(ws.getCell(r, 6).value),
      weightNetKg: cellText(ws.getCell(r, 7).value),
      volumeM3: cellText(ws.getCell(r, 8).value),
      priceSample: prices[0] ?? null,
      notes,
    });
  }
  return out;
}

function countKind(files: PhotoFile[], kind: PhotoKind): number {
  return files.filter((f) => f.kind === kind).length;
}

async function main() {
  const repoRoot = path.resolve(process.cwd(), '..');
  const dir = path.resolve(arg('dir') ?? path.join(repoRoot, 'products_to_add'));
  const outDir = path.resolve(arg('out') ?? path.join(dir, '_report'));

  if (!fs.existsSync(dir)) {
    throw new Error(`Папка не найдена: ${dir}`);
  }

  const xlsxCandidates = fs
    .readdirSync(dir)
    .filter((f) => /\.xlsx$/i.test(f) && !f.startsWith('~$'));
  if (xlsxCandidates.length === 0) {
    throw new Error(`В ${dir} нет .xlsx`);
  }
  const xlsxPath = path.join(dir, xlsxCandidates[0]!);

  console.log(`dir:   ${dir}`);
  console.log(`xlsx:  ${xlsxPath}`);
  console.log(`out:   ${outDir}`);

  const excelRows = await parseExcel(xlsxPath);
  const photos = scanPhotos(dir);

  fs.mkdirSync(outDir, { recursive: true });

  const matchRows: Record<string, string | number | boolean>[] = [];
  let fullPack = 0;
  let anyPhoto = 0;
  let noPhoto = 0;

  for (const e of excelRows) {
    const files = photos.byNorm.get(e.articleNorm) ?? [];
    const white = countKind(files, 'white');
    const detail = countKind(files, 'detail');
    const material = countKind(files, 'material');
    const hasWhite = white > 0;
    const hasDetail = detail > 0;
    const hasMaterial = material > 0;
    const hasAny = files.length > 0;
    const hasFull = hasWhite && hasDetail && hasMaterial;
    if (hasFull) fullPack++;
    else if (hasAny) anyPhoto++;
    else noPhoto++;

    const importReady = hasFull ? 'full' : hasAny ? 'partial' : 'no-photos';

    matchRows.push({
      excelRow: e.excelRow,
      article: e.articleClean,
      articleNorm: e.articleNorm,
      brandGuess: guessBrand(e.nameRu) ?? '',
      nameRu: e.nameRu ?? '',
      categoryRaw: e.categoryRaw ?? '',
      boxDimsMm: e.boxDimsMm ?? '',
      weightGrossKg: e.weightGrossKg ?? '',
      weightNetKg: e.weightNetKg ?? '',
      volumeM3: e.volumeM3 ?? '',
      priceSample: e.priceSample ?? '',
      whiteCount: white,
      detailCount: detail,
      materialCount: material,
      photoTotal: files.length,
      importReady,
      notes: e.notes.join('|'),
      whiteFiles: files
        .filter((f) => f.kind === 'white')
        .map((f) => f.fileName)
        .join(';'),
      detailFiles: files
        .filter((f) => f.kind === 'detail')
        .map((f) => f.fileName)
        .join(';'),
      materialFiles: files
        .filter((f) => f.kind === 'material')
        .map((f) => f.fileName)
        .join(';'),
    });
  }

  const excelNorms = new Set(excelRows.map((e) => e.articleNorm));
  const orphanKeys = [...photos.byNorm.entries()]
    .filter(([norm]) => !excelNorms.has(norm))
    .map(([norm, files]) => ({
      articleNorm: norm,
      articleKey: files[0]?.articleKey ?? norm,
      whiteCount: countKind(files, 'white'),
      detailCount: countKind(files, 'detail'),
      materialCount: countKind(files, 'material'),
      files: files.map((f) => f.relPath).join(';'),
    }));

  const matchCsvPath = path.join(outDir, 'match-report.csv');
  const matchHeader = [
    'excelRow',
    'article',
    'articleNorm',
    'brandGuess',
    'nameRu',
    'categoryRaw',
    'boxDimsMm',
    'weightGrossKg',
    'weightNetKg',
    'volumeM3',
    'priceSample',
    'whiteCount',
    'detailCount',
    'materialCount',
    'photoTotal',
    'importReady',
    'notes',
    'whiteFiles',
    'detailFiles',
    'materialFiles',
  ];
  const matchCsv = [
    matchHeader.join(','),
    ...matchRows.map((r) => row(matchHeader.map((h) => r[h]))),
  ].join('\n');
  fs.writeFileSync(matchCsvPath, matchCsv, 'utf8');

  const orphanCsvPath = path.join(outDir, 'orphan-photos.csv');
  const orphanHeader = [
    'articleNorm',
    'articleKey',
    'whiteCount',
    'detailCount',
    'materialCount',
    'files',
  ];
  const orphanCsv = [
    orphanHeader.join(','),
    ...orphanKeys.map((o) =>
      row([
        o.articleNorm,
        o.articleKey,
        o.whiteCount,
        o.detailCount,
        o.materialCount,
        o.files,
      ]),
    ),
  ].join('\n');
  fs.writeFileSync(orphanCsvPath, orphanCsv, 'utf8');

  const categories = new Map<string, number>();
  const brands = new Map<string, number>();
  for (const e of excelRows) {
    const cat = e.categoryRaw?.split('\n')[0]?.trim() || '(пусто)';
    categories.set(cat, (categories.get(cat) ?? 0) + 1);
    const b = guessBrand(e.nameRu) ?? '(неизвестно)';
    brands.set(b, (brands.get(b) ?? 0) + 1);
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    sourceDir: dir,
    xlsx: path.basename(xlsxPath),
    missingPhotoFolders: photos.missingFolders,
    excelSkuCount: excelRows.length,
    photoFileCount: photos.files.length,
    photoArticleKeys: photos.byNorm.size,
    match: {
      fullPack,
      partialPhotos: anyPhoto,
      noPhotos: noPhoto,
      orphanPhotoKeys: orphanKeys.length,
    },
    brands: Object.fromEntries([...brands.entries()].sort((a, b) => b[1] - a[1])),
    categories: Object.fromEntries([...categories.entries()].sort((a, b) => b[1] - a[1])),
    outputs: {
      matchReportCsv: matchCsvPath,
      orphanPhotosCsv: orphanCsvPath,
      summaryJson: path.join(outDir, 'summary.json'),
      readyFullCsv: path.join(outDir, 'ready-full-pack.csv'),
    },
    nextStepHint:
      'Пилот фазы 1: брать только importReady=full из match-report.csv / ready-full-pack.csv',
  };

  fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8');

  const ready = matchRows.filter((r) => r.importReady === 'full');
  const readyCsv = [
    matchHeader.join(','),
    ...ready.map((r) => row(matchHeader.map((h) => r[h]))),
  ].join('\n');
  fs.writeFileSync(path.join(outDir, 'ready-full-pack.csv'), readyCsv, 'utf8');

  // Normalized JSON for later import (no DB writes)
  const normalized = excelRows.map((e) => {
    const files = photos.byNorm.get(e.articleNorm) ?? [];
    return {
      excelRow: e.excelRow,
      sku: e.articleClean,
      skuNorm: e.articleNorm,
      brandGuess: guessBrand(e.nameRu),
      nameRu: e.nameRu,
      nameRaw: e.nameRaw,
      categoryRaw: e.categoryRaw,
      boxDimsMm: e.boxDimsMm,
      weightGrossKg: e.weightGrossKg,
      weightNetKg: e.weightNetKg,
      volumeM3: e.volumeM3,
      priceSample: e.priceSample,
      notes: e.notes,
      photos: {
        white: files.filter((f) => f.kind === 'white').map((f) => f.relPath),
        detail: files.filter((f) => f.kind === 'detail').map((f) => f.relPath),
        material: files.filter((f) => f.kind === 'material').map((f) => f.relPath),
      },
      importReady:
        countKind(files, 'white') > 0 &&
        countKind(files, 'detail') > 0 &&
        countKind(files, 'material') > 0
          ? 'full'
          : files.length > 0
            ? 'partial'
            : 'no-photos',
    };
  });
  fs.writeFileSync(
    path.join(outDir, 'normalized-products.json'),
    JSON.stringify(normalized, null, 2),
    'utf8',
  );

  console.log('');
  console.log('=== SUMMARY ===');
  console.log(`Excel SKU:           ${excelRows.length}`);
  console.log(`Photo files:         ${photos.files.length}`);
  console.log(`Photo article keys:  ${photos.byNorm.size}`);
  console.log(`Full pack (W+D+M):   ${fullPack}`);
  console.log(`Partial photos:      ${anyPhoto}`);
  console.log(`No photos:           ${noPhoto}`);
  console.log(`Orphan photo keys:   ${orphanKeys.length}`);
  if (photos.missingFolders.length) {
    console.log(`Missing folders:     ${photos.missingFolders.join(', ')}`);
  }
  console.log('');
  console.log('Wrote:');
  console.log(`  ${matchCsvPath}`);
  console.log(`  ${orphanCsvPath}`);
  console.log(`  ${path.join(outDir, 'ready-full-pack.csv')}`);
  console.log(`  ${path.join(outDir, 'summary.json')}`);
  console.log(`  ${path.join(outDir, 'normalized-products.json')}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
