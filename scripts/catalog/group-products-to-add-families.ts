#!/usr/bin/env ts-node
/**
 * Группировка full-pack SKU из products_to_add в «семейство → варианты»
 * (без записи в БД). Нужен предварительно отчёт фазы 0.
 *
 * Usage (из backend/):
 *   npm run catalog:products-to-add-families
 *   npm run catalog:products-to-add-families -- --dir ../products_to_add
 */
import * as fs from 'fs';
import * as path from 'path';
import * as ExcelJS from 'exceljs';

type NormalizedProduct = {
  excelRow: number;
  sku: string;
  skuNorm: string;
  brandGuess: string | null;
  nameRu: string | null;
  nameRaw: string | null;
  categoryRaw: string | null;
  boxDimsMm: string | null;
  weightGrossKg: string | null;
  weightNetKg: string | null;
  volumeM3: string | null;
  priceSample: string | null;
  notes: string[];
  photos: { white: string[]; detail: string[]; material: string[] };
  importReady: 'full' | 'partial' | 'no-photos';
};

type VariantDraft = {
  sku: string;
  excelRow: number;
  nameRu: string | null;
  categoryRaw: string | null;
  boxDimsMm: string | null;
  weightGrossKg: string | null;
  weightNetKg: string | null;
  volumeM3: string | null;
  priceSample: string | null;
  frameColor: string | null;
  upholsteryColor: string | null;
  upholsteryMaterial: string | null;
  baseMaterial: string | null;
  photos: NormalizedProduct['photos'];
};

type FamilyDraft = {
  familyKey: string;
  brand: string;
  productTitle: string;
  categoryRaw: string | null;
  suggestedCategorySlug: string | null;
  variantCount: number;
  variants: VariantDraft[];
  materialsNeeded: string[];
  colorsNeeded: string[];
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

function stripCn(s: string): string {
  return s
    .replace(/（[^）]*）/g, '')
    .replace(/[\u4e00-\u9fff]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanLabel(s: string | null | undefined): string | null {
  if (!s) return null;
  const t = stripCn(s)
    .replace(/\/\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  return t || null;
}

function normArticle(raw: string): string {
  return raw
    .split('\n')[0]!
    .replace(/（[^）]*）/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

const COLOR_WORDS =
  /\b(чёрный|черный|белый|серый|тёмно[-\s]?серый|темно[-\s]?серый|бежевый|коричневый|зелёный|зеленый|синий|розовый|золотой|оранжевый|жёлтый|желтый|бордовый|бордо|светлый|тёмный|темный)\b/gi;

/** Explicit SKU-prefix → family (overrides name heuristics when present). */
const SKU_FAMILY_RULES: { test: RegExp; brand: string; model: string }[] = [
  { test: /^XTR-11/i, brand: 'FALTO', model: 'X TRANS' },
  { test: /^S100C-B/i, brand: 'SIHOO', model: 'Doro S100' },
  { test: /^AU-1B-/i, brand: 'SIHOO', model: 'Doro S300' },
  { test: /^M18-/i, brand: 'SIHOO', model: 'M18' },
  { test: /^M57-/i, brand: 'SIHOO', model: 'M57' },
  { test: /^SY-1101-/i, brand: 'FALTO', model: 'ROBO' },
  { test: /^SY-1033-/i, brand: 'FALTO', model: 'Duo Gini' },
  { test: /^FDM02-W-/i, brand: 'FALTO', model: 'ORTO' },
  { test: /^02104H$/i, brand: 'FALTO', model: 'DISPATCHER ORTO' },
  { test: /^RELAX-KM-6009/i, brand: 'FALTO', model: 'Benessere' },
  { test: /^RELAX-KM-6001/i, brand: 'FALTO', model: 'Crema' },
  { test: /^RELAX-KM-6013/i, brand: 'FALTO', model: 'Titanio' },
  { test: /^4100-/i, brand: 'FALTO', model: 'Lift' },
  { test: /^4137-/i, brand: 'FALTO', model: 'Live' },
  { test: /^4092D-/i, brand: 'FALTO', model: 'Lotus Electro' },
  { test: /^7753WB-/i, brand: 'FALTO', model: 'Hana' },
  { test: /^7438W-/i, brand: 'FALTO', model: 'Lux' },
  { test: /^7829-/i, brand: 'FALTO', model: 'Piabora' },
  { test: /^7651-/i, brand: 'FALTO', model: 'Rio' },
  { test: /^7583WQ-/i, brand: 'FALTO', model: 'Valencia' },
  { test: /^7582W-/i, brand: 'FALTO', model: 'Zuel' },
  { test: /^4073WD-/i, brand: 'FALTO', model: 'Concord' },
  { test: /^S16099RWB-/i, brand: 'FALTO', model: 'Lux Electro' },
  { test: /^ZERO-4106-/i, brand: 'FALTO', model: 'Zero' },
  { test: /^FALTO-KS/i, brand: 'FALTO', model: 'Rookie' },
  { test: /^FALTO-KP/i, brand: 'FALTO', model: 'Rookie plus' },
  { test: /^FIT-BALL-/i, brand: 'FALTO', model: 'FIT BALL' },
  { test: /^2401-2Z-/i, brand: 'FALTO', model: 'SOKOA ACTIV' },
  { test: /^1802-31-/i, brand: 'FALTO', model: 'Activ S' },
  { test: /^2203-1-/i, brand: 'FALTO', model: 'SALLI Activ' },
];

function guessBrandFromName(name: string | null, sku: string): string {
  if (name) {
    const m = name.match(/\b(FALTO|Falto|SIHOO|ROBO)\b/i);
    if (m) {
      const b = m[1]!.toUpperCase();
      return b === 'ROBO' ? 'FALTO' : b;
    }
  }
  if (/^S100C-|^AU-1B-|^M18-|^M57-/i.test(sku)) return 'SIHOO';
  return 'FALTO';
}

function productKind(name: string | null, categoryRaw: string | null): string {
  const hay = `${name ?? ''} ${categoryRaw ?? ''}`.toLowerCase();
  if (/седло/.test(hay)) return 'Стул седло';
  if (/стул мобильный|мобильный/.test(hay)) return 'Стул мобильный';
  if (/детск|школьник|подростк/.test(hay)) return 'Детское кресло';
  if (/электрореклайнер/.test(hay)) return 'Кресло электрореклайнер';
  if (/реклайнер/.test(hay)) return 'Кресло реклайнер';
  if (/с подножкой/.test(hay)) return 'Кресло с подножкой';
  return 'Кресло';
}

function extractFamily(
  sku: string,
  nameRu: string | null,
  brandGuess: string | null,
): { brand: string; model: string; productTitle: string; familyKey: string } {
  const brand = (brandGuess || guessBrandFromName(nameRu, sku)).toUpperCase();

  for (const rule of SKU_FAMILY_RULES) {
    if (rule.test.test(sku)) {
      const productTitle = `${productKind(nameRu, null)} ${rule.brand} ${rule.model}`.replace(
        /\s+/g,
        ' ',
      );
      return {
        brand: rule.brand,
        model: rule.model,
        productTitle,
        familyKey: `${rule.brand}::${rule.model}`.toUpperCase(),
      };
    }
  }

  // Trailing "FALTO Model" after Chinese strip / duplicated brand tag
  if (nameRu) {
    const trailing = nameRu.match(/\b(FALTO|Falto|SIHOO)\s+([A-Za-z][A-Za-z0-9 +./-]{1,40})\s*$/);
    if (trailing) {
      const b = trailing[1]!.toUpperCase();
      const model = trailing[2]!.replace(/\s+/g, ' ').trim();
      const productTitle = `${productKind(nameRu, null)} ${b} ${model}`;
      return { brand: b, model, productTitle, familyKey: `${b}::${model}`.toUpperCase() };
    }

    // "Кресло FALTO X TRANS (....)" — take brand + model tokens before '('
    const head = nameRu.split('(')[0]!.trim();
    const m = head.match(/\b(FALTO|Falto|SIHOO|ROBO)\b\s+(.+)$/i);
    if (m) {
      let b = m[1]!.toUpperCase();
      let model = m[2]!.replace(COLOR_WORDS, '').replace(/,\s*$/, '').replace(/\s+/g, ' ').trim();
      if (b === 'ROBO') {
        b = 'FALTO';
        model = 'ROBO';
      }
      if (model) {
        const productTitle = `${productKind(nameRu, null)} ${b} ${model}`;
        return { brand: b, model, productTitle, familyKey: `${b}::${model}`.toUpperCase() };
      }
    }
  }

  // Fallback: single-SKU family
  const model = sku;
  const productTitle = (nameRu || sku).split('(')[0]!.trim();
  return {
    brand,
    model,
    productTitle,
    familyKey: `${brand}::${model}`.toUpperCase(),
  };
}

/** Rough map Excel category text → catalog v1 leaf slug (manual review later). */
function suggestCategorySlug(categoryRaw: string | null, nameRu: string | null): string | null {
  const hay = `${categoryRaw ?? ''} ${nameRu ?? ''}`.toLowerCase();
  if (/детск|школьник|подростк|robo|orto/.test(hay)) return 'office-stul'; // TBD: may need dedicated
  if (/седло|salli|activ s|fit ball|rookie|sokoa|мобильн/.test(hay)) return 'office-stul';
  if (/реклайнер|recliner|lift|zero|lux electro/.test(hay)) return 'office-kresla';
  if (/руководител|диспетчер|主管|调度/.test(hay)) return 'office-kresla';
  if (/офисн|办公椅|кресло/.test(hay)) return 'office-kresla';
  return 'office-kresla';
}

async function loadExcelExtras(
  xlsxPath: string,
): Promise<Map<string, { frame: string | null; upholstery: string | null; material: string | null; cross: string | null }>> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(xlsxPath);
  const ws = wb.getWorksheet('TDSheet') ?? wb.worksheets[0];
  if (!ws) throw new Error('Нет листа TDSheet');
  const map = new Map<
    string,
    { frame: string | null; upholstery: string | null; material: string | null; cross: string | null }
  >();
  for (let r = 11; r <= (ws.rowCount || 0); r++) {
    const art = cellText(ws.getCell(r, 2).value)?.split('\n')[0]?.trim();
    if (!art) continue;
    map.set(normArticle(art), {
      frame: cleanLabel(cellText(ws.getCell(r, 41).value)),
      upholstery: cleanLabel(cellText(ws.getCell(r, 42).value)),
      material: cleanLabel(cellText(ws.getCell(r, 43).value)),
      cross: cleanLabel(cellText(ws.getCell(r, 44).value)),
    });
  }
  return map;
}

function materialKey(material: string | null): string {
  if (!material) return 'Не указан';
  const m = material.toLowerCase();
  if (m.includes('нубук')) return 'Нубук';
  if (m.includes('кож')) return 'Кожа';
  if (m.includes('сетк') && m.includes('ткан')) return 'Сетка/ткань';
  if (m.includes('сетк')) return 'Сетка';
  if (m.includes('ткан') || m.includes('шенилл')) return 'Ткань';
  if (m.includes('эко')) return 'Экокожа';
  return material;
}

async function main() {
  const repoRoot = path.resolve(process.cwd(), '..');
  const dir = path.resolve(arg('dir') ?? path.join(repoRoot, 'products_to_add'));
  const reportDir = path.resolve(arg('out') ?? path.join(dir, '_report'));
  const normalizedPath = path.join(reportDir, 'normalized-products.json');

  if (!fs.existsSync(normalizedPath)) {
    throw new Error(
      `Нет ${normalizedPath}. Сначала: npm run catalog:products-to-add-report`,
    );
  }

  const xlsx = fs
    .readdirSync(dir)
    .filter((f) => /\.xlsx$/i.test(f) && !f.startsWith('~$'))[0];
  if (!xlsx) throw new Error(`В ${dir} нет .xlsx`);

  const all = JSON.parse(fs.readFileSync(normalizedPath, 'utf8')) as NormalizedProduct[];
  const full = all.filter((p) => p.importReady === 'full');
  const extras = await loadExcelExtras(path.join(dir, xlsx));

  const families = new Map<string, FamilyDraft>();

  for (const p of full) {
    const ex = extras.get(p.skuNorm) ?? {
      frame: null,
      upholstery: null,
      material: null,
      cross: null,
    };
    const fam = extractFamily(p.sku, p.nameRu, p.brandGuess);
    const kind = productKind(p.nameRu, p.categoryRaw);
    const productTitle = `${kind} ${fam.brand} ${fam.model}`.replace(/\s+/g, ' ').trim();

    let family = families.get(fam.familyKey);
    if (!family) {
      family = {
        familyKey: fam.familyKey,
        brand: fam.brand,
        productTitle,
        categoryRaw: p.categoryRaw,
        suggestedCategorySlug: suggestCategorySlug(p.categoryRaw, p.nameRu),
        variantCount: 0,
        variants: [],
        materialsNeeded: [],
        colorsNeeded: [],
      };
      families.set(fam.familyKey, family);
    }

    const variant: VariantDraft = {
      sku: p.sku,
      excelRow: p.excelRow,
      nameRu: p.nameRu,
      categoryRaw: p.categoryRaw,
      boxDimsMm: p.boxDimsMm,
      weightGrossKg: p.weightGrossKg,
      weightNetKg: p.weightNetKg,
      volumeM3: p.volumeM3,
      priceSample: p.priceSample,
      frameColor: ex.frame,
      upholsteryColor: ex.upholstery,
      upholsteryMaterial: ex.material,
      baseMaterial: ex.cross,
      photos: p.photos,
    };
    family.variants.push(variant);
  }

  for (const family of families.values()) {
    family.variantCount = family.variants.length;
    family.variants.sort((a, b) => a.sku.localeCompare(b.sku));
    const mats = new Set<string>();
    const cols = new Set<string>();
    for (const v of family.variants) {
      mats.add(materialKey(v.upholsteryMaterial));
      if (v.upholsteryColor) cols.add(v.upholsteryColor);
      if (v.frameColor) cols.add(`Каркас:${v.frameColor}`);
    }
    family.materialsNeeded = [...mats].sort();
    family.colorsNeeded = [...cols].sort();
    // Prefer non-null category from first variant with category
    family.categoryRaw =
      family.variants.find((v) => v.categoryRaw)?.categoryRaw ?? family.categoryRaw;
    family.suggestedCategorySlug = suggestCategorySlug(
      family.categoryRaw,
      family.variants[0]?.nameRu ?? null,
    );
  }

  const familyList = [...families.values()].sort((a, b) => {
    if (a.brand !== b.brand) return a.brand.localeCompare(b.brand);
    return a.productTitle.localeCompare(b.productTitle);
  });

  // Brand material libraries to seed
  const brandLibs = new Map<string, { materials: Map<string, Set<string>>; frameColors: Set<string> }>();
  for (const f of familyList) {
    let lib = brandLibs.get(f.brand);
    if (!lib) {
      lib = { materials: new Map(), frameColors: new Set() };
      brandLibs.set(f.brand, lib);
    }
    for (const v of f.variants) {
      const mat = materialKey(v.upholsteryMaterial);
      if (!lib.materials.has(mat)) lib.materials.set(mat, new Set());
      if (v.upholsteryColor) lib.materials.get(mat)!.add(v.upholsteryColor);
      if (v.frameColor) lib.frameColors.add(v.frameColor);
    }
  }

  const brandMaterialsPlan = [...brandLibs.entries()].map(([brand, lib]) => ({
    brand,
    elementsSuggested: [
      { name: 'Обивка', materials: [...lib.materials.entries()].map(([m, colors]) => ({ material: m, colors: [...colors].sort() })) },
      { name: 'Каркас', materials: [{ material: 'Каркас', colors: [...lib.frameColors].sort() }] },
    ],
  }));

  fs.mkdirSync(reportDir, { recursive: true });

  const familiesJsonPath = path.join(reportDir, 'families.json');
  fs.writeFileSync(
    familiesJsonPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        source: 'ready-full-pack / normalized-products.json',
        stats: {
          fullPackSkus: full.length,
          families: familyList.length,
          multiVariantFamilies: familyList.filter((f) => f.variantCount > 1).length,
          singleVariantFamilies: familyList.filter((f) => f.variantCount === 1).length,
          brands: [...new Set(familyList.map((f) => f.brand))],
        },
        brandMaterialsPlan,
        families: familyList,
      },
      null,
      2,
    ),
    'utf8',
  );

  const famCsvPath = path.join(reportDir, 'families.csv');
  const famHeader = [
    'familyKey',
    'brand',
    'productTitle',
    'variantCount',
    'skus',
    'categoryRaw',
    'suggestedCategorySlug',
    'materialsNeeded',
    'colorsNeeded',
  ];
  const famCsv = [
    famHeader.join(','),
    ...familyList.map((f) =>
      row([
        f.familyKey,
        f.brand,
        f.productTitle,
        f.variantCount,
        f.variants.map((v) => v.sku).join('|'),
        f.categoryRaw,
        f.suggestedCategorySlug,
        f.materialsNeeded.join('|'),
        f.colorsNeeded.join('|'),
      ]),
    ),
  ].join('\n');
  fs.writeFileSync(famCsvPath, famCsv, 'utf8');

  const varCsvPath = path.join(reportDir, 'family-variants.csv');
  const varHeader = [
    'familyKey',
    'brand',
    'productTitle',
    'sku',
    'upholsteryMaterial',
    'upholsteryColor',
    'frameColor',
    'baseMaterial',
    'priceSample',
    'boxDimsMm',
    'weightGrossKg',
    'volumeM3',
    'whiteCount',
    'detailCount',
    'materialPhotoCount',
  ];
  const varCsv = [
    varHeader.join(','),
    ...familyList.flatMap((f) =>
      f.variants.map((v) =>
        row([
          f.familyKey,
          f.brand,
          f.productTitle,
          v.sku,
          v.upholsteryMaterial,
          v.upholsteryColor,
          v.frameColor,
          v.baseMaterial,
          v.priceSample,
          v.boxDimsMm,
          v.weightGrossKg,
          v.volumeM3,
          v.photos.white.length,
          v.photos.detail.length,
          v.photos.material.length,
        ]),
      ),
    ),
  ].join('\n');
  fs.writeFileSync(varCsvPath, varCsv, 'utf8');

  const brandCsvPath = path.join(reportDir, 'brand-materials-plan.csv');
  const brandLines = ['brand,element,material,color'];
  for (const plan of brandMaterialsPlan) {
    for (const el of plan.elementsSuggested) {
      for (const mat of el.materials) {
        for (const color of mat.colors.length ? mat.colors : ['']) {
          brandLines.push(row([plan.brand, el.name, mat.material, color]));
        }
      }
    }
  }
  fs.writeFileSync(brandCsvPath, brandLines.join('\n'), 'utf8');

  console.log('=== FAMILIES ===');
  console.log(`Full-pack SKUs:     ${full.length}`);
  console.log(`Families (products): ${familyList.length}`);
  console.log(
    `  multi-variant:    ${familyList.filter((f) => f.variantCount > 1).length}`,
  );
  console.log(
    `  single-variant:   ${familyList.filter((f) => f.variantCount === 1).length}`,
  );
  console.log(`Brands:             ${[...new Set(familyList.map((f) => f.brand))].join(', ')}`);
  console.log('');
  for (const f of familyList) {
    console.log(
      `  [${f.brand}] ${f.productTitle} ×${f.variantCount} → ${f.variants.map((v) => v.sku).join(', ')}`,
    );
  }
  console.log('');
  console.log('Wrote:');
  console.log(`  ${familiesJsonPath}`);
  console.log(`  ${famCsvPath}`);
  console.log(`  ${varCsvPath}`);
  console.log(`  ${brandCsvPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
