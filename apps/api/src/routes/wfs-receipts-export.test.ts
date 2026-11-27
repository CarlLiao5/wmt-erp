import ExcelJS from 'exceljs';
import express from 'express';
import { expect, it } from 'vitest';
import { authRouter } from './auth.js';
import { wfsReceiptRows, wfsReceiptWorkbook, wfsRouter } from './wfs.js';

const rows = [
  { id: '1', storeId: 'store-a', shipmentId: 'SHIP-1', sku: 'SKU-1', gtin: '', changedUnits: 12, transactionTime: new Date('2026-11-10T12:00:00Z'), fcId: null, fcName: 'LAX2', transactionLocation: null, reasonCode: 'RECEIVED', reasonDescription: 'Received', transactionType: 'INBOUND', createdAt: new Date() },
  { id: '2', storeId: 'store-a', shipmentId: 'SHIP-1', sku: 'SKU-1', gtin: '', changedUnits: -1, transactionTime: new Date('2026-11-11T12:00:00Z'), fcId: null, fcName: 'LAX2', transactionLocation: null, reasonCode: 'RECEIVING_CORRECTION', reasonDescription: 'Receiving Correction', transactionType: 'ADJUSTMENT', createdAt: new Date() },
  { id: '3', storeId: 'store-a', shipmentId: 'SHIP-1', sku: 'SKU-2', gtin: '', changedUnits: 8, transactionTime: null, fcId: null, fcName: null, transactionLocation: null, reasonCode: null, reasonDescription: 'Shipped to Customer', transactionType: null, createdAt: new Date() },
  { id: '4', storeId: 'store-a', shipmentId: 'SHIP-2', sku: 'SKU-1', gtin: '', changedUnits: 20, transactionTime: null, fcId: null, fcName: null, transactionLocation: null, reasonCode: null, reasonDescription: 'Received', transactionType: null, createdAt: new Date() },
];

it('selects only receipt log rows for the requested shipment and creates a readable workbook', async () => {
  const selected = wfsReceiptRows(rows, 'store-a', 'SHIP-1');
  expect(selected.map((row) => row.id)).toEqual(['1', '2']);
  const buffer = await wfsReceiptWorkbook('SHIP-1', selected);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0]!;
  expect(sheet.getRow(1).values).toEqual([undefined, '货件号', 'SKU', 'GTIN', '上架数量', '仓库节点', '仓库名称', '交易时间', '交易位置', '类型', '原因代码', '原因']);
  expect(sheet.rowCount).toBe(3);
  expect(sheet.getRow(2).getCell(4).value).toBe(12);
  expect(sheet.getRow(3).getCell(4).value).toBe(-1);
});

it('exports only visible SKU receipts within the authenticated tenant and requested store shipment', async () => {
  const originalMysqlUrl = process.env.MYSQL_URL;
  const originalDefaultTenantId = process.env.DEFAULT_TENANT_ID;
  delete process.env.MYSQL_URL;
  process.env.DEFAULT_TENANT_ID = 'tenant-a';
  const calls: unknown[][] = [];
  const app = express();
  app.use(express.json(), authRouter());
  app.use(wfsRouter(async () => [], () => ({ tenantId: 'tenant-a', role: 'member', storeIds: new Set(), skus: new Set(['store-a:SKU-1']) }), async (...args) => { calls.push(args); return rows; }));
  const server = app.listen(0);
  const address = server.address() as { port: number };
  try {
    const login = await fetch(`http://127.0.0.1:${address.port}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@example.com', password: 'admin123' }) });
    const cookie = login.headers.get('set-cookie')?.split(';')[0] ?? '';
    const response = await fetch(`http://127.0.0.1:${address.port}/wfs/shipments/SHIP-1/receipts/export?storeId=store-a`, { headers: { cookie } });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('spreadsheetml');
    expect(calls).toEqual([['tenant-a', 'store-a', 'SHIP-1']]);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()));
    expect(workbook.worksheets[0]!.rowCount).toBe(3);
    expect(workbook.worksheets[0]!.getColumn(1).values).toEqual([, '货件号', 'SHIP-1', 'SHIP-1']);
    expect(workbook.worksheets[0]!.getColumn(2).values).toEqual([, 'SKU', 'SKU-1', 'SKU-1']);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (originalMysqlUrl === undefined) delete process.env.MYSQL_URL; else process.env.MYSQL_URL = originalMysqlUrl;
    if (originalDefaultTenantId === undefined) delete process.env.DEFAULT_TENANT_ID; else process.env.DEFAULT_TENANT_ID = originalDefaultTenantId;
  }
});
