/**
 * Генератор Excel-шаблона для китайского офиса (intake каталога).
 *
 * Одна строка = один артикул (SKU / вариант).
 * Цена только в юанях (¥). Фото — в отдельных папках, в имени файла артикул.
 *
 *   npm run catalog:intake-template
 *
 * Выход: products_to_add/WUPAPA_catalog_intake_CN_RU.xlsx
 */
import * as path from 'path';
import * as fs from 'fs';
import ExcelJS from 'exceljs';

type Col = {
  key: string;
  cn: string;
  ru: string;
  width: number;
  group: 'id' | 'variant' | 'price' | 'pack' | 'size' | 'spec' | 'extra';
  example?: string | number;
};

const COLS: Col[] = [
  // —— идентификация ——
  { key: 'sku', cn: '货号', ru: 'Артикул', width: 22, group: 'id', example: 'FDM02-W-BLUE' },
  { key: 'brand', cn: '品牌', ru: 'Бренд', width: 12, group: 'id', example: 'FALTO' },
  {
    key: 'model',
    cn: '型号 / 系列',
    ru: 'Модель / семейство',
    width: 16,
    group: 'id',
    example: 'ORTO',
  },
  {
    key: 'name_cn',
    cn: '中文品名',
    ru: 'Название (CN)',
    width: 28,
    group: 'id',
    example: '儿童椅 ORTO',
  },
  {
    key: 'name_ru',
    cn: '俄文品名',
    ru: 'Название (RU)',
    width: 32,
    group: 'id',
    example: 'Детское кресло FALTO ORTO',
  },
  {
    key: 'category',
    cn: '产品分类',
    ru: 'Категория',
    width: 16,
    group: 'id',
    example: 'Детское кресло',
  },

  // —— вариант (материалы / цвета) ——
  {
    key: 'upholstery_material',
    cn: '面料材质',
    ru: 'Материал обивки',
    width: 14,
    group: 'variant',
    example: 'Сетка',
  },
  {
    key: 'upholstery_color',
    cn: '面料颜色',
    ru: 'Цвет обивки',
    width: 14,
    group: 'variant',
    example: 'Синий',
  },
  {
    key: 'frame_color',
    cn: '框架颜色',
    ru: 'Цвет каркаса',
    width: 14,
    group: 'variant',
    example: 'Белый',
  },
  {
    key: 'base_material',
    cn: '五星脚材质',
    ru: 'Материал крестовины',
    width: 14,
    group: 'variant',
    example: 'Металл',
  },

  // —— цена ——
  {
    key: 'price_cny',
    cn: '采购价（¥）',
    ru: 'Цена закупки, ¥',
    width: 14,
    group: 'price',
    example: 850,
  },

  // —— упаковка / логистика ——
  {
    key: 'box_l_mm',
    cn: '包装长 mm',
    ru: 'Коробка Д, мм',
    width: 12,
    group: 'pack',
    example: 700,
  },
  {
    key: 'box_w_mm',
    cn: '包装宽 mm',
    ru: 'Коробка Ш, мм',
    width: 12,
    group: 'pack',
    example: 600,
  },
  {
    key: 'box_h_mm',
    cn: '包装高 mm',
    ru: 'Коробка В, мм',
    width: 12,
    group: 'pack',
    example: 470,
  },
  {
    key: 'weight_gross_kg',
    cn: '毛重 kg',
    ru: 'Вес брутто, кг',
    width: 12,
    group: 'pack',
    example: 20.5,
  },
  {
    key: 'weight_net_kg',
    cn: '净重 kg',
    ru: 'Вес нетто, кг',
    width: 12,
    group: 'pack',
    example: 18,
  },
  {
    key: 'volume_m3',
    cn: '包装体积 m³',
    ru: 'Объём коробки, м³',
    width: 12,
    group: 'pack',
    example: 0.2,
  },

  // —— габариты изделия ——
  {
    key: 'user_height',
    cn: '适用身高 cm',
    ru: 'Рост пользователя, см',
    width: 14,
    group: 'size',
    example: '120-160',
  },
  {
    key: 'user_weight_kg',
    cn: '推荐承重 kg',
    ru: 'Вес пользователя, кг',
    width: 12,
    group: 'size',
    example: 80,
  },
  {
    key: 'chair_h_min_cm',
    cn: '座椅高度 min cm',
    ru: 'Высота кресла мин, см',
    width: 12,
    group: 'size',
    example: 90,
  },
  {
    key: 'chair_h_max_cm',
    cn: '座椅高度 max cm',
    ru: 'Высота кресла макс, см',
    width: 12,
    group: 'size',
    example: 110,
  },
  {
    key: 'chair_w_cm',
    cn: '座椅宽度 cm',
    ru: 'Ширина кресла, см',
    width: 12,
    group: 'size',
    example: 60,
  },
  {
    key: 'unfolded_l_cm',
    cn: '展开长度 cm',
    ru: 'Длина в разложенном, см',
    width: 12,
    group: 'size',
  },
  {
    key: 'ottoman_cm',
    cn: '脚踏尺寸 cm',
    ru: 'Размер оттоманки, см',
    width: 12,
    group: 'size',
  },
  {
    key: 'back_h_min_cm',
    cn: '靠背高度 min cm',
    ru: 'Высота спинки мин, см',
    width: 12,
    group: 'size',
  },
  {
    key: 'back_h_max_cm',
    cn: '靠背高度 max cm',
    ru: 'Высота спинки макс, см',
    width: 12,
    group: 'size',
  },
  {
    key: 'back_w_cm',
    cn: '靠背宽度 cm',
    ru: 'Ширина спинки, см',
    width: 12,
    group: 'size',
  },
  {
    key: 'seat_h_min_cm',
    cn: '座面高度 min cm',
    ru: 'Высота сиденья мин, см',
    width: 12,
    group: 'size',
  },
  {
    key: 'seat_h_max_cm',
    cn: '座面高度 max cm',
    ru: 'Высота сиденья макс, см',
    width: 12,
    group: 'size',
  },
  {
    key: 'seat_w_cm',
    cn: '座面宽度 cm',
    ru: 'Ширина сиденья, см',
    width: 12,
    group: 'size',
  },
  {
    key: 'seat_d_min_cm',
    cn: '座面深度 min cm',
    ru: 'Глубина сиденья мин, см',
    width: 12,
    group: 'size',
  },
  {
    key: 'seat_d_max_cm',
    cn: '座面深度 max cm',
    ru: 'Глубина сиденья макс, см',
    width: 12,
    group: 'size',
  },
  {
    key: 'arm_h_min_cm',
    cn: '扶手高度 min cm',
    ru: 'Высота подлокотника мин, см',
    width: 12,
    group: 'size',
  },
  {
    key: 'arm_h_max_cm',
    cn: '扶手高度 max cm',
    ru: 'Высота подлокотника макс, см',
    width: 12,
    group: 'size',
  },
  {
    key: 'base_size_cm',
    cn: '五星脚尺寸 cm',
    ru: 'Размер крестовины, см',
    width: 12,
    group: 'size',
  },
  {
    key: 'headrest_h_min_cm',
    cn: '头枕高度 min cm',
    ru: 'Высота подголовника мин, см',
    width: 12,
    group: 'size',
  },
  {
    key: 'headrest_h_max_cm',
    cn: '头枕高度 max cm',
    ru: 'Высота подголовника макс, см',
    width: 12,
    group: 'size',
  },

  // —— характеристики ——
  {
    key: 'headrest',
    cn: '头枕',
    ru: 'Подголовник',
    width: 14,
    group: 'spec',
    example: '2D',
  },
  {
    key: 'backrest',
    cn: '靠背',
    ru: 'Спинка',
    width: 22,
    group: 'spec',
    example: 'регулируется по высоте',
  },
  {
    key: 'lumbar_pressure',
    cn: '腰托支撑',
    ru: 'Поясничный упор (давление)',
    width: 14,
    group: 'spec',
  },
  {
    key: 'lumbar_type',
    cn: '腰托类型',
    ru: 'Тип поясничного упора',
    width: 14,
    group: 'spec',
  },
  {
    key: 'seat',
    cn: '座面',
    ru: 'Сиденье',
    width: 18,
    group: 'spec',
  },
  {
    key: 'armrest',
    cn: '扶手',
    ru: 'Подлокотник',
    width: 12,
    group: 'spec',
    example: '3D',
  },
  {
    key: 'mechanism',
    cn: '底盘机构',
    ru: 'Механизм',
    width: 18,
    group: 'spec',
    example: 'Синхромеханизм',
  },
  {
    key: 'tilt_positions',
    cn: '倾仰档位数',
    ru: 'Кол-во фиксаций отклонения',
    width: 12,
    group: 'spec',
    example: 4,
  },
  {
    key: 'tilt_angles',
    cn: '靠背倾仰角度',
    ru: 'Углы отклонения спинки',
    width: 14,
    group: 'spec',
  },
  {
    key: 'gaslift',
    cn: '气压杆',
    ru: 'Газлифт',
    width: 12,
    group: 'spec',
    example: '3 класс',
  },
  {
    key: 'wheels',
    cn: '滚轮',
    ru: 'Колёса',
    width: 22,
    group: 'spec',
    example: '60 мм, полиуретан',
  },

  // —— доп. ——
  {
    key: 'feature_1',
    cn: '特性1',
    ru: 'Особенность 1',
    width: 22,
    group: 'extra',
  },
  {
    key: 'feature_2',
    cn: '特性2',
    ru: 'Особенность 2',
    width: 22,
    group: 'extra',
  },
  {
    key: 'feature_3',
    cn: '特性3',
    ru: 'Особенность 3',
    width: 22,
    group: 'extra',
  },
  {
    key: 'country',
    cn: '生产国',
    ru: 'Страна изготовитель',
    width: 12,
    group: 'extra',
    example: 'Китай',
  },
  {
    key: 'notes',
    cn: '备注',
    ru: 'Комментарий',
    width: 28,
    group: 'extra',
  },
];

const GROUP_FILL: Record<Col['group'], string> = {
  id: '1F4E79',
  variant: '2E7D32',
  price: 'C62828',
  pack: '6A1B9A',
  size: '0277BD',
  spec: 'EF6C00',
  extra: '546E7A',
};

const GROUP_LABEL: Record<Col['group'], { cn: string; ru: string }> = {
  id: { cn: '识别', ru: 'Идентификация' },
  variant: { cn: '材质颜色', ru: 'Вариант' },
  price: { cn: '价格', ru: 'Цена' },
  pack: { cn: '包装物流', ru: 'Упаковка' },
  size: { cn: '尺寸', ru: 'Габариты' },
  spec: { cn: '配置', ru: 'Характеристики' },
  extra: { cn: '其他', ru: 'Прочее' },
};

function styleHeaderCell(
  cell: ExcelJS.Cell,
  text: string,
  fillHex: string,
  opts?: { bold?: boolean; italic?: boolean; size?: number },
) {
  cell.value = text;
  cell.font = {
    name: 'Arial',
    size: opts?.size ?? 10,
    bold: opts?.bold ?? true,
    italic: opts?.italic,
    color: { argb: 'FFFFFFFF' },
  };
  cell.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: `FF${fillHex}` },
  };
  cell.alignment = {
    vertical: 'middle',
    horizontal: 'center',
    wrapText: true,
  };
  cell.border = {
    top: { style: 'thin', color: { argb: 'FFCCCCCC' } },
    left: { style: 'thin', color: { argb: 'FFCCCCCC' } },
    bottom: { style: 'thin', color: { argb: 'FFCCCCCC' } },
    right: { style: 'thin', color: { argb: 'FFCCCCCC' } },
  };
}

async function main() {
  const repoRoot = path.resolve(process.cwd(), '..');
  const outDir = path.resolve(repoRoot, 'products_to_add');
  const outPath = path.join(outDir, 'WUPAPA_catalog_intake_CN_RU.xlsx');
  fs.mkdirSync(outDir, { recursive: true });

  const wb = new ExcelJS.Workbook();
  wb.creator = 'WUPAPA';
  wb.created = new Date();

  // ─── Sheet: Products ───
  const ws = wb.addWorksheet('Products', {
    views: [{ state: 'frozen', xSplit: 1, ySplit: 4 }],
    properties: { defaultRowHeight: 18 },
  });

  // Row 1: group labels (merged)
  let col = 1;
  while (col <= COLS.length) {
    const group = COLS[col - 1]!.group;
    let end = col;
    while (end < COLS.length && COLS[end]!.group === group) end++;
    const label = GROUP_LABEL[group];
    if (end > col) {
      ws.mergeCells(1, col, 1, end);
    }
    styleHeaderCell(ws.getCell(1, col), `${label.cn} / ${label.ru}`, GROUP_FILL[group], {
      size: 9,
    });
    col = end + 1;
  }
  ws.getRow(1).height = 22;

  // Row 2: Chinese
  // Row 3: Russian
  // Row 4: field key (for import script)
  for (let i = 0; i < COLS.length; i++) {
    const c = COLS[i]!;
    const fill = GROUP_FILL[c.group];
    styleHeaderCell(ws.getCell(2, i + 1), c.cn, fill, { size: 10 });
    styleHeaderCell(ws.getCell(3, i + 1), c.ru, fill, { size: 9, bold: false });
    const keyCell = ws.getCell(4, i + 1);
    keyCell.value = c.key;
    keyCell.font = { name: 'Consolas', size: 8, color: { argb: 'FF666666' } };
    keyCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFF5F5F5' },
    };
    keyCell.alignment = { vertical: 'middle', horizontal: 'center' };
    keyCell.border = {
      top: { style: 'thin', color: { argb: 'FFDDDDDD' } },
      left: { style: 'thin', color: { argb: 'FFDDDDDD' } },
      bottom: { style: 'thin', color: { argb: 'FFDDDDDD' } },
      right: { style: 'thin', color: { argb: 'FFDDDDDD' } },
    };
    ws.getColumn(i + 1).width = c.width;
  }
  ws.getRow(2).height = 24;
  ws.getRow(3).height = 28;
  ws.getRow(4).height = 16;

  // Example row
  const exampleRow = ws.getRow(5);
  for (let i = 0; i < COLS.length; i++) {
    const c = COLS[i]!;
    const cell = exampleRow.getCell(i + 1);
    if (c.example !== undefined) cell.value = c.example;
    cell.font = { name: 'Arial', size: 10, italic: true, color: { argb: 'FF888888' } };
    cell.alignment = { vertical: 'middle', wrapText: true };
  }
  exampleRow.height = 20;

  // Empty data rows with light borders
  for (let r = 6; r <= 55; r++) {
    const row = ws.getRow(r);
    for (let i = 1; i <= COLS.length; i++) {
      const cell = row.getCell(i);
      cell.border = {
        top: { style: 'hair', color: { argb: 'FFEEEEEE' } },
        left: { style: 'hair', color: { argb: 'FFEEEEEE' } },
        bottom: { style: 'hair', color: { argb: 'FFEEEEEE' } },
        right: { style: 'hair', color: { argb: 'FFEEEEEE' } },
      };
      // price column highlight
      if (COLS[i - 1]!.key === 'price_cny') {
        cell.numFmt = '¥#,##0.00';
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFFFF8E1' },
        };
      }
      if (COLS[i - 1]!.key === 'sku') {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFE3F2FD' },
        };
      }
    }
  }

  // Data validation hints on brand / country
  ws.dataValidations.add('B6:B200', {
    type: 'list',
    allowBlank: true,
    formulae: ['"FALTO,SIHOO"'],
    showErrorMessage: false,
  });

  // ─── Sheet: Photos ───
  const ph = wb.addWorksheet('Photos', {
    properties: { defaultRowHeight: 18 },
  });
  ph.getColumn(1).width = 18;
  ph.getColumn(2).width = 36;
  ph.getColumn(3).width = 42;
  ph.getColumn(4).width = 48;

  const photoHeaders = [
    ['类型 Type', '文件夹 Folder', '文件名规则 File name', '说明 Note'],
    [
      '白底主图 / На белом',
      '01_white',
      'ZT={货号} 0101.jpg',
      '主图，白底。同一货号多张：0101, 0102… / Главные на белом фоне',
    ],
    [
      '细节图 / Детали',
      '02_detail',
      'CJT={货号} 0101.jpg',
      '场景/细节。多张按序号 / Интерьер и детали',
    ],
    [
      '材质图 / Материалы',
      '03_material',
      'YS={货号} 0101.jpg',
      '面料/材质特写 / Фото материалов и цветов',
    ],
  ];

  ph.mergeCells('A1:D1');
  ph.getCell('A1').value =
    '照片规则 Photos — 不要把图片放进 Excel / Photos go in folders, NOT inside Excel';
  ph.getCell('A1').font = { name: 'Arial', size: 12, bold: true, color: { argb: 'FF1F4E79' } };
  ph.getRow(1).height = 28;

  for (let r = 0; r < photoHeaders.length; r++) {
    const row = ph.getRow(r + 3);
    for (let c = 0; c < 4; c++) {
      const cell = row.getCell(c + 1);
      cell.value = photoHeaders[r]![c];
      cell.font = {
        name: 'Arial',
        size: r === 0 ? 10 : 10,
        bold: r === 0,
        color: { argb: r === 0 ? 'FFFFFFFF' : 'FF333333' },
      };
      if (r === 0) {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FF1F4E79' },
        };
      }
      cell.alignment = { vertical: 'middle', wrapText: true };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFCCCCCC' } },
        left: { style: 'thin', color: { argb: 'FFCCCCCC' } },
        bottom: { style: 'thin', color: { argb: 'FFCCCCCC' } },
        right: { style: 'thin', color: { argb: 'FFCCCCCC' } },
      };
    }
    row.height = r === 0 ? 22 : 40;
  }

  ph.getCell('A8').value = '示例 Examples';
  ph.getCell('A8').font = { bold: true, size: 11 };
  const examples = [
    'ZT=FDM02-W-BLUE 0101.jpg',
    'ZT=FDM02-W-BLUE 0102.jpg',
    'CJT=FDM02-W-BLUE 0101.jpg',
    'CJT=FDM02-W-BLUE 0102.jpg',
    'YS=FDM02-W-BLUE 0101.jpg',
  ];
  examples.forEach((ex, i) => {
    ph.getCell(9 + i, 1).value = ex;
    ph.getCell(9 + i, 1).font = { name: 'Consolas', size: 10 };
  });

  ph.getCell('A15').value =
    '重要 Important：货号必须与 Products 表 sku 列完全一致（大小写、连字符）。货号与序号之间有空格。\n' +
    'SKU in the filename must match the sku column exactly. Space between SKU and sequence number.';
  ph.mergeCells('A15:D17');
  ph.getCell('A15').alignment = { wrapText: true, vertical: 'top' };
  ph.getCell('A15').font = { name: 'Arial', size: 10, color: { argb: 'FFB71C1C' } };

  // ─── Sheet: Instructions ───
  const ins = wb.addWorksheet('Instructions', {
    properties: { defaultRowHeight: 20 },
  });
  ins.getColumn(1).width = 100;

  const lines: { text: string; bold?: boolean; size?: number; color?: string }[] = [
    {
      text: 'WUPAPA — 产品资料模板 / Шаблон карточек товаров',
      bold: true,
      size: 14,
      color: '1F4E79',
    },
    { text: '' },
    { text: '中文说明', bold: true, size: 12 },
    { text: '1. 在「Products」表填写：一行 = 一个货号（SKU / 颜色变体）。' },
    { text: '2. 第2行中文表头，第3行俄文表头，第4行是给脚本用的字段名（请勿改动第1–4行）。' },
    { text: '3. 第5行是示例，可删除或覆盖。从第6行开始填写真实数据。' },
    { text: '4. 价格只填人民币采购价（¥），不要填卢布或其他币种。' },
    {
      text: '5. 同一型号不同颜色/材质 → 多行，brand + model 相同，sku / 颜色 / 材质不同。',
    },
    { text: '6. 照片不要插入 Excel。放到同目录的 01_white / 02_detail / 03_material 文件夹，见「Photos」表。' },
    { text: '7. 包装尺寸请分三列填写长/宽/高（毫米），不要写成「700x600x470」一行。' },
    { text: '' },
    { text: 'Русская инструкция', bold: true, size: 12 },
    { text: '1. Лист «Products»: одна строка = один артикул (SKU / цветовой вариант).' },
    {
      text: '2. Строка 2 — китайские заголовки, строка 3 — русские, строка 4 — ключи для скрипта (не менять строки 1–4).',
    },
    { text: '3. Строка 5 — пример. Данные с строки 6.' },
    { text: '4. Цена только в юанях (¥), колонка price_cny. Без рублей и без нескольких прайсов.' },
    {
      text: '5. Одно семейство, разные цвета → несколько строк с одинаковыми brand + model, разными sku / цветом / материалом.',
    },
    {
      text: '6. Фото не вставлять в Excel. Класть в папки 01_white / 02_detail / 03_material рядом с файлом (лист Photos).',
    },
    {
      text: '7. Габариты коробки — три числа (Д/Ш/В в мм), не строка «700×600×470».',
    },
    { text: '' },
    {
      text: 'Структура папок рядом с этим файлом / Folder layout next to this file:',
      bold: true,
    },
    { text: '  WUPAPA_catalog_intake_CN_RU.xlsx' },
    { text: '  01_white/     ← ZT={SKU} 0101.jpg' },
    { text: '  02_detail/    ← CJT={SKU} 0101.jpg' },
    { text: '  03_material/  ← YS={SKU} 0101.jpg' },
  ];

  lines.forEach((line, i) => {
    const cell = ins.getCell(i + 1, 1);
    cell.value = line.text;
    cell.font = {
      name: 'Arial',
      size: line.size ?? 11,
      bold: line.bold,
      color: line.color ? { argb: `FF${line.color}` } : { argb: 'FF333333' },
    };
  });

  await wb.xlsx.writeFile(outPath);
  console.log(`Wrote: ${outPath}`);
  console.log(`Columns: ${COLS.length}`);
  console.log(`Keys: ${COLS.map((c) => c.key).join(', ')}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
