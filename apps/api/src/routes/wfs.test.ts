import { describe, expect, it } from 'vitest';
import { aggregateWfsActualQuantities, attachWfsFeePreviews, filterWfsShipmentItemRows, groupWfsShipmentItems, resolveWfsReceipt, wfsHistoryDateBounds, wfsShipmentIdentity } from './wfs.js';
import express from 'express';
import { authRouter } from './auth.js';
import { wfsRouter, filterVisibleWfsRows } from './wfs.js';

describe('resolveWfsReceipt', () => {
  it('keeps receipt status unknown when no matching receiving log exists', () => {
    expect(resolveWfsReceipt(152, undefined)).toEqual({
      actualShippedQty: 152,
      actualReceivedQty: undefined,
      fullyReceived: undefined,
    });
  });

  it('marks a shipment fully received when received units reach shipped units', () => {
    expect(resolveWfsReceipt(152, 152)).toEqual({
      actualShippedQty: 152,
      actualReceivedQty: 152,
      fullyReceived: true,
    });
  });

  it('marks a shipment partially received when receiving logs are below shipped units', () => {
    expect(resolveWfsReceipt(152, 76)).toEqual({
      actualShippedQty: 152,
      actualReceivedQty: 76,
      fullyReceived: false,
    });
  });

  it('only aggregates receiving corrections that include a shipment id', () => {
    const result = aggregateWfsActualQuantities(
      [{ shipmentNumber: ' 0965327wfb ', sku: 'XLD-QJ-002', quantity: '152' }],
      [
        { shipmentId: '0965327WFB', sku: 'XLD-QJ-002', changedUnits: 100, reasonDescription: 'Received' },
        { shipmentId: '0965327WFB', sku: 'XLD-QJ-002', changedUnits: 52, reasonDescription: 'Receiving Correction' },
        { shipmentId: '0965327WFB', sku: 'XLD-QJ-002', changedUnits: 1, reasonDescription: 'Received' },
        { shipmentId: '', sku: 'XLD-QJ-002', changedUnits: 999, reasonDescription: 'Received' },
        { shipmentId: '0965327WFB', sku: 'XLD-QJ-002', changedUnits: 999, reasonDescription: 'Shipped to Customer' },
      ],
    );
    expect(result.shippedByKey.get('0965327WFB:XLD-QJ-002')).toBe(152);
    expect(result.receivedByKey.get('0965327WFB:XLD-QJ-002')).toBe(153);
  });
});

describe('WFS SKU visibility', () => {
  it('keeps only visible SKU rows and recomputes shipment totals from them', () => {
    const result = filterVisibleWfsRows([{
      storeId: 'store-a', shipmentId: 'ship-1', status: 'Created', shipmentUnits: 500, receivedUnits: 450,
      items: [
        { sku: 'SKU-1', itemQty: 4, actualShippedQty: 4, actualReceivedQty: 3 },
        { storeId: 'store-b', sku: 'SKU-1', itemQty: 100, actualShippedQty: 100, actualReceivedQty: 100 },
        { sku: 'SKU-2', itemQty: 496, actualShippedQty: 496, actualReceivedQty: 447 },
      ],
    }], { role: 'member', storeIds: new Set(), skus: new Set(['store-a:SKU-1']) }, 'shipments');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ shipmentId: 'ship-1', items: [{ sku: 'SKU-1' }], shipmentUnits: 4, receivedUnits: 3, actualShippedUnits: 4, actualReceivedUnits: 3, fullyReceived: false });
  });

  it('keeps matching head-freight rows only for visible SKUs', () => {
    const result = filterVisibleWfsRows([{
      storeId: 'store-a', shipmentId: 'ship-1', items: [{ sku: 'SKU-1' }, { sku: 'SKU-2' }],
      tracking: { inboundNumber: 'IN-1', brand: 'forwarder', currentStatusText: '运输中', events: [{ info: '已出库' }] },
      headFreightItems: [
        { sku: 'SKU-1', quantity: 4, inboundNumber: 'IN-1' },
        { sku: 'SKU-2', quantity: 8, inboundNumber: 'IN-1' },
      ],
    }], { role: 'member', storeIds: new Set(), skus: new Set(['store-a:SKU-1']) }, 'shipments');
    expect(result[0]?.headFreightItems).toEqual([{ sku: 'SKU-1', quantity: 4, inboundNumber: 'IN-1' }]);
    expect(result[0]?.tracking).toMatchObject({ inboundNumber: 'IN-1', events: [{ info: '已出库' }] });
  });

  it('attaches WFS head-freight records to the corresponding store and shipment', async () => {
    const { attachWfsHeadFreight } = await import('./wfs.js');
    const rows = attachWfsHeadFreight([{ storeId: 'store-a', shipmentId: 'SHIP-1' }], [
      { storeId: 'store-a', shipmentNumber: ' ship-1 ', sku: 'SKU-1', quantity: 4, inboundNumber: 'IN-1' },
      { storeId: 'store-b', shipmentNumber: 'SHIP-1', sku: 'SKU-2', quantity: 8, inboundNumber: 'IN-2' },
      { storeId: 'store-a', shipmentNumber: 'OTHER', sku: 'SKU-3', quantity: 3, inboundNumber: 'IN-3' },
    ]);
    expect(rows[0]?.headFreightItems).toEqual([{ sku: 'SKU-1', quantity: 4, inboundNumber: 'IN-1' }]);
  });

  it('omits shipments without visible SKU detail and all un-attributed member reconciliations', () => {
    const rows = [{ storeId: 'store-a', shipmentId: 'ship-1', items: [{ sku: 'SKU-2' }] }];
    const scope = { role: 'member' as const, storeIds: new Set<string>(), skus: new Set(['store-a:SKU-1']) };
    expect(filterVisibleWfsRows(rows, scope, 'shipments')).toEqual([]);
    expect(filterVisibleWfsRows([{ storeId: 'store-a', id: 'r1', amount: 123 }], scope, 'reconciliations')).toEqual([]);
  });

  it('hidesTotalsWithInvisibleSkuLines', () => {
    const rows = [{ storeId: 'store-a', shipmentId: 'ship-1', items: [{ sku: 'SKU-1' }, { sku: 'SKU-2' }], feePreviews: [{ previewType: 'inbound', totalNetTransferCharge: '175', items: [{ sku: 'SKU-1', netTransferCharge: '75' }, { sku: 'SKU-2', netTransferCharge: '100' }] }] }];
    const member = filterVisibleWfsRows(rows, { role: 'member', storeIds: new Set(), skus: new Set(['store-a:SKU-1']) }, 'shipments');
    expect(member[0]?.feePreviews).toEqual([{ previewType: 'inbound', totalNetTransferCharge: null, items: [{ sku: 'SKU-1', netTransferCharge: '75' }] }]);
    const admin = filterVisibleWfsRows(rows, { role: 'admin', storeIds: new Set(), skus: new Set() }, 'shipments');
    expect(admin[0]?.feePreviews).toEqual(rows[0].feePreviews);
  });

  it('applies visibility to the authenticated WFS route', async () => {
    const originalMysqlUrl = process.env.MYSQL_URL;
    delete process.env.MYSQL_URL;
    const app = express(); app.use(express.json()); app.use(authRouter());
    const calls:any[]=[];
    app.use(wfsRouter(async (...args) => {calls.push(args);const [kind]=args;return kind === 'shipments' ? [{ storeId: 'store-a', shipmentId: 'ship-1', items: [{ sku: 'SKU-1' }, { sku: 'SKU-2' }] }] : [];}, () => ({ tenantId: 'default', role: 'member', storeIds: new Set(), skus: new Set(['store-a:SKU-1']) })));
    const server = await new Promise<import('node:http').Server>((resolve) => { const instance = app.listen(0, () => resolve(instance)); });
    try {
      const address = server.address(); if (!address || typeof address === 'string') throw new Error('address');
      const base = `http://127.0.0.1:${address.port}`;
      const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@example.com', password: 'admin123' }) });
      const cookie = login.headers.get('set-cookie')?.split(';')[0] ?? '';
      const response = await fetch(`${base}/wfs/shipments`, { headers: { cookie } });
      expect((await response.json()).data.rows[0].items.map((item: { sku: string }) => item.sku)).toEqual(['SKU-1']);
      const summary=await fetch(`${base}/wfs/shipments?view=summary`,{headers:{cookie}});expect(summary.status).toBe(200);expect(calls.at(-1)?.[5]).toBe('summary');
      const invalid=await fetch(`${base}/wfs/shipments?shipmentId=ship-1`,{headers:{cookie}});expect(invalid.status).toBe(400);
      const detail=await fetch(`${base}/wfs/shipments?storeId=store-a&shipmentId=ship-1`,{headers:{cookie}});expect(detail.status).toBe(200);expect(calls.at(-1)?.[6]).toBe('ship-1');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      if (originalMysqlUrl === undefined) delete process.env.MYSQL_URL; else process.env.MYSQL_URL = originalMysqlUrl;
    }
  });
});

it('joinsPreviewsByTenantStoreAndShipment', () => {
  const rows = attachWfsFeePreviews([
    { storeId: 'store-a', shipmentId: 'SHIP-1', shipToAddress: { fcId: '4093', fcName: 'Rogers' } },
    { storeId: 'store-b', shipmentId: 'SHIP-1', shipToAddress: { fcId: '1234', fcName: 'Other FC' } },
  ], {
    tenantId: 'tenant-a',
    runs: [
      { id: 'run-a', tenantId: 'tenant-a', storeId: 'store-a', shipmentId: 'SHIP-1', status: 'succeeded', lastAttemptAt: new Date('2026-11-01'), lastSuccessAt: new Date('2026-11-01') },
      { id: 'run-b', tenantId: 'tenant-a', storeId: 'store-b', shipmentId: 'SHIP-1', status: 'failed', lastAttemptAt: new Date('2026-11-02'), lastSuccessAt: new Date('2026-10-30') },
      { id: 'run-other-tenant', tenantId: 'tenant-b', storeId: 'store-a', shipmentId: 'SHIP-1', status: 'succeeded' },
    ],
    options: [
      { id: 'option-a', runId: 'run-a', tenantId: 'tenant-a', storeId: 'store-a', shipmentId: 'SHIP-1', previewType: 'inbound', shipNode: '4093', totalNetTransferCharge: '175', currency: 'USD' },
      { id: 'option-a-alt', runId: 'run-a', tenantId: 'tenant-a', storeId: 'store-a', shipmentId: 'SHIP-1', previewType: 'inbound', shipNode: '9999', totalNetTransferCharge: '999', currency: 'USD' },
      { id: 'option-b', runId: 'run-b', tenantId: 'tenant-a', storeId: 'store-b', shipmentId: 'SHIP-1', previewType: 'inbound', shipNode: '4005', totalNetTransferCharge: '210', currency: 'USD' },
    ],
    items: [
      { optionId: 'option-a', tenantId: 'tenant-a', storeId: 'store-a', shipmentId: 'SHIP-1', sku: 'SKU-A', itemQuantity: 500, netTransferCharge: '175', currency: 'USD' },
      { optionId: 'option-b', tenantId: 'tenant-a', storeId: 'store-b', shipmentId: 'SHIP-1', sku: 'SKU-B', itemQuantity: 100, netTransferCharge: '210', currency: 'USD' },
    ],
  });
  expect(rows.map((row) => row.feePreviews)).toEqual([
    [{ previewType: 'inbound', shipNode: '4093', destinationName: null, totalNetTransferCharge: '175', currency: 'USD', stale: false, lastAttemptAt: new Date('2026-11-01'), lastSuccessAt: new Date('2026-11-01'), items: [{ gtin: null, sku: 'SKU-A', itemQuantity: 500, netTransferCharge: '175', unitTransferCharge: null, currency: 'USD' }] }],
    [],
  ]);
  const withoutDestination = attachWfsFeePreviews([{ storeId: 'store-a', shipmentId: 'SHIP-1' }], {
    tenantId: 'tenant-a', runs: [{ id: 'run-a', tenantId: 'tenant-a', storeId: 'store-a', shipmentId: 'SHIP-1' }],
    options: [{ id: 'option-a', runId: 'run-a', tenantId: 'tenant-a', storeId: 'store-a', shipmentId: 'SHIP-1', previewType: 'inbound', shipNode: '4093' }], items: [],
  });
  expect(withoutDestination[0]?.feePreviews).toEqual([]);
  const nameMatched = attachWfsFeePreviews([{ storeId: 'store-a', shipmentId: 'SHIP-1', shipToAddress: { fcName: 'LAX2T' } }], {
    tenantId: 'tenant-a', runs: [{ id: 'run-a', tenantId: 'tenant-a', storeId: 'store-a', shipmentId: 'SHIP-1' }],
    options: [
      { id: 'hub-4093', runId: 'run-a', tenantId: 'tenant-a', storeId: 'store-a', shipmentId: 'SHIP-1', previewType: 'inbound', shipNode: '4093', destinationName: 'California - LAX2t' },
      { id: 'hub-4005', runId: 'run-a', tenantId: 'tenant-a', storeId: 'store-a', shipmentId: 'SHIP-1', previewType: 'inbound', shipNode: '4005', destinationName: 'Indiana - IND2t' },
      { id: 'hub-2011', runId: 'run-a', tenantId: 'tenant-a', storeId: 'store-a', shipmentId: 'SHIP-1', previewType: 'inbound', shipNode: '2011', destinationName: 'New Jersey - NJ3t' },
      { id: 'wrong', runId: 'run-a', tenantId: 'tenant-a', storeId: 'store-a', shipmentId: 'SHIP-1', previewType: 'inbound', shipNode: '1234', destinationName: 'Other FC' },
    ], items: [],
  });
  expect((nameMatched[0]?.feePreviews as Array<{ shipNode: string }>)?.map((preview) => preview.shipNode)).toEqual(['4093']);
  const nonHubDestination = attachWfsFeePreviews([{ storeId: 'store-a', shipmentId: 'SHIP-1', shipToAddress: { fcName: 'MCO1' } }], {
    tenantId: 'tenant-a', runs: [{ id: 'run-a', tenantId: 'tenant-a', storeId: 'store-a', shipmentId: 'SHIP-1' }],
    options: [{ id: 'wrong-route', runId: 'run-a', tenantId: 'tenant-a', storeId: 'store-a', shipmentId: 'SHIP-1', previewType: 'inbound', shipNode: '4005' }], items: [],
  });
  expect(nonHubDestination[0]?.feePreviews).toEqual([]);
});

describe('WFS shipment history range', () => {
  it('loads all stored shipment history by default while retaining the reconciliation default range', () => {
    const now = Date.parse('2026-11-07T00:00:00.000Z');
    expect(wfsHistoryDateBounds('shipments', undefined, undefined, now)).toEqual({ from: undefined, to: undefined });
    expect(wfsHistoryDateBounds('reconciliations', undefined, undefined, now).from?.toISOString()).toBe('2026-10-08T00:00:00.000Z');
  });

  it('keeps explicit date filters and separates identical shipment ids by store', () => {
    expect(wfsHistoryDateBounds('shipments', '2026-01-01', '2026-01-31')).toEqual({ from: new Date('2026-01-01'), to: new Date('2026-01-31T23:59:59.999Z') });
    expect(wfsShipmentIdentity({ storeId: 'store-a', shipmentId: 'SHIP-1' })).not.toBe(wfsShipmentIdentity({ storeId: 'store-b', shipmentId: 'SHIP-1' }));
  });
});

it('groups and deduplicates WFS item payloads by store and shipment in one pass', () => {
  const grouped = groupWfsShipmentItems([
    { storeId: 'store-a', payload: { shipmentId: 'SHIP-1', sku: 'SKU-1', itemQty: 4 } },
    { storeId: 'store-a', payload: { shipmentId: 'SHIP-1', sku: 'SKU-1', itemQty: 4 } },
    { storeId: 'store-b', payload: { shipmentId: 'SHIP-1', sku: 'SKU-1', itemQty: 9 } },
    { storeId: 'store-a', payload: { shipmentId: 'SHIP-2', sku: 'SKU-2', itemQty: 2 } },
  ]);
  expect(grouped.get('store-a:SHIP-1')).toEqual([{ shipmentId: 'SHIP-1', sku: 'SKU-1', itemQty: 4, storeId: 'store-a' }]);
  expect(grouped.get('store-b:SHIP-1')).toEqual([{ shipmentId: 'SHIP-1', sku: 'SKU-1', itemQty: 9, storeId: 'store-b' }]);
  expect(grouped.get('store-a:SHIP-2')).toEqual([{ shipmentId: 'SHIP-2', sku: 'SKU-2', itemQty: 2, storeId: 'store-a' }]);
});

it('deduplicates the same SKU when volatile display fields differ', () => {
  const grouped = groupWfsShipmentItems([
    { storeId: 'store-a', payload: { shipmentId: 'SHIP-1', sku: 'SKU-1', itemQty: 4, fillRate: 10 } },
    { storeId: 'store-a', payload: { shipmentId: 'SHIP-1', sku: 'SKU-1', itemQty: 4, fillRate: 20 } },
  ]);
  expect(grouped.get('store-a:SHIP-1')).toHaveLength(1);
});

it('filters candidate WFS item payloads by exact store and shipment keys', () => {
  const rows = filterWfsShipmentItemRows([
    { storeId: 'store-a', payload: { shipmentId: 'SHIP-1', sku: 'A' } },
    { storeId: 'store-b', payload: { shipmentId: 'SHIP-1', sku: 'B' } },
    { storeId: 'store-a', payload: { inboundOrderId: 'SHIP-2', sku: 'C' } },
    { storeId: 'store-a', payload: { shipmentId: 'OTHER', sku: 'D' } },
  ], new Map([
    ['store-a', new Set(['SHIP-1', 'SHIP-2'])],
    ['store-b', new Set(['SHIP-3'])],
  ]));

  expect(rows.map((row) => (row.payload as { sku: string }).sku)).toEqual(['A', 'C']);
});
