import ExcelJS from 'exceljs';

export type TargetRow = Record<string, unknown> & { month?: unknown; target?: unknown; sku?: unknown; productName?: unknown; owner?: unknown; year?: unknown; quantityTarget?: unknown; amountTarget?: unknown; estimatedDailySales?: unknown; salesDays?: unknown; previousDailySales?: unknown; previousAveragePrice?: unknown; stock?: unknown; inbound?: unknown; createdAt?: unknown; updatedAt?: unknown };

export type MonthlyTargetRow = Record<string, unknown> & {
  month?: unknown; storeId?: unknown; sku?: unknown; itemId?: unknown; productName?: unknown; ownerName?: unknown;
  inventoryQuantity?: unknown; lastMonthUnits?: unknown; lastMonthDays?: unknown; lastMonthAvgDailySales?: unknown;
  lastMonthAvgPrice?: unknown; expectedDailySales?: unknown; sellingDays?: unknown; quantityTarget?: unknown;
  amountTarget?: unknown; missingReasons?: unknown; formulaVersion?: unknown; status?: unknown;
};

const headers = ['SKU', '品名', '负责人', '年份', '月份', '数量目标', '金额目标', '预计日销(件)', '销售天数', '上月日均销量', '上月均价', '在库库存', '在途货件', '创建时间', '更新时间'];
const cellValue = (value: ExcelJS.CellValue): unknown => {
  if (value == null) return null;
  if (typeof value === 'object' && 'text' in value) return value.text;
  if (typeof value === 'object' && 'result' in value) return value.result;
  if (value instanceof Date || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  return null;
};

const monthlyHeaders = ['月份', '店铺', 'SKU', 'Item ID', '品名', '负责人', '在库库存', '上月销量', '上月天数', '上月日均销量', '上月均价', '预计日销', '销售天数', '数量目标', '金额目标', '缺失原因', '公式版本', '状态'];
const formulaValue = (cell: ExcelJS.Cell): { value: unknown; formula?: string } => {
  const raw = cell.value as ExcelJS.CellValue & { formula?: string; result?: unknown };
  if (raw && typeof raw === 'object' && 'formula' in raw) return { value: raw.result ?? null, formula: typeof raw.formula === 'string' ? raw.formula : undefined };
  return { value: cellValue(cell.value) };
};

export async function parseTargetWorkbook(input: Buffer): Promise<Array<Record<string, unknown>>> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(input);
  const sheet = workbook.worksheets[0];
  if (!sheet) return [];
  const headerValues = sheet.getRow(1).values as ExcelJS.CellValue[];
  const columnNames = headerValues.slice(1).map((value: ExcelJS.CellValue) => String(cellValue(value) ?? '').trim());
  const values: Array<Record<string, unknown>> = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const record = Object.fromEntries(columnNames.map((name: string, index: number) => [name, cellValue(row.getCell(index + 1).value)]));
    if (Object.values(record).some((value) => value != null && value !== '')) values.push(record);
  });
  return values.map((row) => ({
    sku: row.SKU ?? row.sku, productName: row['品名'] ?? row.productName, owner: row['负责人'] ?? row.owner,
    year: row['年份'] ?? row.year, month: row['月份'] ?? row.month ?? row.Month ?? row.MONTH,
    quantityTarget: row['数量目标'] ?? row.quantityTarget, amountTarget: row['金额目标'] ?? row.amountTarget,
    target: row.target ?? row.Target ?? row.TARGET ?? row['金额目标'] ?? row['数量目标'],
    estimatedDailySales: row['预计日销(件)'] ?? row.estimatedDailySales, salesDays: row['销售天数'] ?? row.salesDays,
    previousDailySales: row['上月日均销量'] ?? row.previousDailySales, previousAveragePrice: row['上月均价'] ?? row.previousAveragePrice,
    stock: row['在库库存'] ?? row.stock, inbound: row['在途货件'] ?? row.inbound,
    createdAt: row['创建时间'] ?? row.createdAt, updatedAt: row['更新时间'] ?? row.updatedAt,
  }));
}

export async function targetWorkbook(rows: TargetRow[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Targets');
  sheet.addRow(headers);
  for (const row of rows) sheet.addRow([row.sku ?? '', row.productName ?? '', row.owner ?? '', row.year ?? '', row.month ?? '', row.quantityTarget ?? '', row.amountTarget ?? row.target ?? '', row.estimatedDailySales ?? '', row.salesDays ?? '', row.previousDailySales ?? '', row.previousAveragePrice ?? '', row.stock ?? '', row.inbound ?? '', row.createdAt ?? '', row.updatedAt ?? '']);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

export async function targetMonthlyWorkbook(rows: MonthlyTargetRow[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Monthly Targets');
  sheet.addRow(monthlyHeaders);
  rows.forEach((row, index) => {
    const excelRow = index + 2;
    const quantity = Number(row.quantityTarget);
    const amount = Number(row.amountTarget);
    sheet.addRow([
      row.month ?? '', row.storeId ?? '', row.sku ?? '', row.itemId ?? '', row.productName ?? '', row.ownerName ?? '',
      row.inventoryQuantity ?? '', row.lastMonthUnits ?? '', row.lastMonthDays ?? '', row.lastMonthAvgDailySales ?? '', row.lastMonthAvgPrice ?? '',
      row.expectedDailySales ?? '', row.sellingDays ?? '',
      { formula: `=M${excelRow}*L${excelRow}`, result: Number.isFinite(quantity) ? quantity : null },
      { formula: `=K${excelRow}*N${excelRow}`, result: Number.isFinite(amount) ? amount : null },
      Array.isArray(row.missingReasons) ? row.missingReasons.join('；') : row.missingReasons ?? '', row.formulaVersion ?? '', row.status ?? '',
    ]);
  });
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

export async function parseMonthlyTargetWorkbook(input: Buffer): Promise<Array<MonthlyTargetRow & { quantityTargetFormula?: string; amountTargetFormula?: string }>> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(input);
  const sheet = workbook.worksheets[0];
  if (!sheet) return [];
  const headerValues = sheet.getRow(1).values as ExcelJS.CellValue[];
  const columns = headerValues.slice(1).map((value) => String(cellValue(value) ?? '').trim());
  const keyMap: Record<string, keyof MonthlyTargetRow> = {
    '月份': 'month', '店铺': 'storeId', 'SKU': 'sku', 'Item ID': 'itemId', '品名': 'productName', '负责人': 'ownerName',
    '在库库存': 'inventoryQuantity', '上月销量': 'lastMonthUnits', '上月天数': 'lastMonthDays', '上月日均销量': 'lastMonthAvgDailySales',
    '上月均价': 'lastMonthAvgPrice', '预计日销': 'expectedDailySales', '销售天数': 'sellingDays', '数量目标': 'quantityTarget',
    '金额目标': 'amountTarget', '缺失原因': 'missingReasons', '公式版本': 'formulaVersion', '状态': 'status',
  };
  const rows: Array<MonthlyTargetRow & { quantityTargetFormula?: string; amountTargetFormula?: string }> = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const record: MonthlyTargetRow & { quantityTargetFormula?: string; amountTargetFormula?: string } = {};
    columns.forEach((column, index) => {
      const key = keyMap[column];
      if (!key) return;
      const parsed = formulaValue(row.getCell(index + 1));
      record[key] = parsed.value;
      if (key === 'quantityTarget' && parsed.formula) record.quantityTargetFormula = parsed.formula;
      if (key === 'amountTarget' && parsed.formula) record.amountTargetFormula = parsed.formula;
    });
    if (Object.values(record).some((value) => value != null && value !== '')) rows.push(record);
  });
  return rows;
}
