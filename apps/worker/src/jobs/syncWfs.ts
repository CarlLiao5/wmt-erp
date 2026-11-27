import { syncInventoryLogPages } from './syncInventoryLogs.js';
import {archiveInventoryHealth} from '../../../../packages/db/src/normalization/inventory-health.js';
import { syncWfsShipmentCatalog, type ShipmentSyncMode } from './syncWfsShipments.js';
import { createHash, randomUUID } from 'node:crypto';
import { createDb, inventorySnapshots, rawPayloads, skus, sql, wfsInventoryLogs } from '../../../../packages/db/index.js';
import { getInventoryHealth, listWfsInventoryLog, listWfsShipmentItems, listWfsShipments, type WalmartConnection } from '@walmart-erp/walmart-client';
import { inventoryLogQuery, inventoryLogRawPayload, normalizeWfsInventory } from './syncInventory.js';
export interface WfsSyncWindow { tenantId:string; storeId:string; from:string; to:string; batchId?:string; shipmentMode?:ShipmentSyncMode; }

export async function syncWfsShipmentsToDatabase(window:Pick<WfsSyncWindow,'tenantId'|'storeId'>, connection:WalmartConnection) {
  return syncWfsShipmentCatalog({...window,mode:'full'},connection);
}
export async function syncWfsToDatabase(window:WfsSyncWindow, connection:WalmartConnection) {
  const { db, pool } = createDb(); let received=0; let normalized=0; const now=new Date();
  // A new invocation is a new historical snapshot batch. Retries must pass the
  // same batchId explicitly; falling back to the time window would overwrite
  // prior runs that cover the same period.
  const batchId = window.batchId ?? randomUUID();
  try {
    const shipmentResult = await syncWfsShipmentCatalog({tenantId:window.tenantId,storeId:window.storeId,mode:window.shipmentMode??'full',now},connection);
    const health = new Map<string, any>(); const inventoryPayloads: any[] = [];
    for await (const payload of getInventoryHealth(connection, { limit:'50' })) {
      const correlationId = randomUUID();
      inventoryPayloads.push(payload);
      await archiveInventoryHealth(payload,{tenantId:window.tenantId,storeId:window.storeId,sourceId:correlationId,capturedAt:now});
      const rows=normalizeWfsInventory(payload,{tenantId:window.tenantId,storeId:window.storeId,now});
      for (const row of rows) {
        if (!health.has(row.sku)) health.set(row.sku, { ...row, gtin: row.gtin ?? '' });
        const skuId = `${window.storeId}:${row.sku}`;
        await db.insert(skus).values({ id: skuId, tenantId: row.tenantId, storeId: row.storeId, externalId: row.sku, gtin: row.gtin ?? null, itemId: row.itemId ?? null, title: row.productName ?? null, createdAt: now, updatedAt: now }).onDuplicateKeyUpdate({ set: { gtin: sql`COALESCE(NULLIF(VALUES(${skus.gtin}), ''), ${skus.gtin})`, itemId: sql`COALESCE(NULLIF(VALUES(${skus.itemId}), ''), ${skus.itemId})`, title: sql`COALESCE(NULLIF(VALUES(${skus.title}), ''), ${skus.title})`, updatedAt: now } });
      }
    }
    // The WFS inventory endpoint is the single source for WFS node quantities,
    // product metadata and age. Do not call the legacy fulfillment inventory endpoint.
    for (const payload of inventoryPayloads) {
      received += 1;
      const rows=normalizeWfsInventory(payload,{tenantId:window.tenantId,storeId:window.storeId,now}).flatMap(row => { const meta=health.get(row.sku); return [{...row, productName:meta?.productName ?? row.productName, firstInStockDate:meta?.firstInStockDate ?? row.firstInStockDate, ageDistribution:meta?.ageDistribution ?? row.ageDistribution, gtin:meta?.gtin}]; });
      for (const row of rows) { normalized += 1; const skuId=`${row.storeId}:${row.sku}`; const idempotencyKey = `${window.storeId}:${batchId}:${row.sku}:${row.nodeId}`; const snapshotId = createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 36); await db.insert(skus).values({id:skuId,tenantId:row.tenantId,storeId:row.storeId,externalId:row.sku,itemId:String((row as any).itemId ?? '') || null,createdAt:now,updatedAt:now}).onDuplicateKeyUpdate({set:{updatedAt:now}}); await db.insert(inventorySnapshots).values({id:snapshotId,tenantId:row.tenantId,storeId:row.storeId,skuId,nodeId:row.nodeId,quantity:String(row.quantity),occurredAt:row.occurredAt,idempotencyKey}).onDuplicateKeyUpdate({set:{quantity:String(row.quantity),occurredAt:row.occurredAt,idempotencyKey}}); }
    }
    const inventoryLogs = await syncInventoryLogPages([...health.values()], window, {
      fetch: async query => (await listWfsInventoryLog(connection, query)).data,
      archive: async (row, offset, payload) => {
        const rawLog = inventoryLogRawPayload({ tenantId: window.tenantId, storeId: window.storeId, sku: row.sku, gtin: row.gtin, offset, capturedAt: now, payload });
        await db.insert(rawPayloads).values({ ...rawLog, payload: payload as any, httpStatus: 200 });
      },
      save: async (row, log) => { const gtin = row.gtin; await db.insert(wfsInventoryLogs).values({ id: String(log.id), tenantId: window.tenantId, storeId: window.storeId, sku: row.sku, gtin, fcId: log.fcId ? String(log.fcId) : null, fcName: log.fcName ?? null, changedUnits: Number(log.changedUnits ?? 0), transactionTime: log.transactionTime ? new Date(log.transactionTime) : null, transactionLocation: log.transactionLocation ?? null, reasonCode: log.transactionReasonCode ?? null, reasonDescription: log.transactionReasonDesc ?? null, transactionType: log.transactionType ?? null, shipmentId: log.shipmentId ?? null, createdAt: now }).onDuplicateKeyUpdate({ set: { fcName: log.fcName ?? null, changedUnits: Number(log.changedUnits ?? 0), transactionTime: log.transactionTime ? new Date(log.transactionTime) : null } }); },
    });
    if (inventoryLogs.failures.length) throw new Error('Inventory log sync incomplete: ' + JSON.stringify({pages:inventoryLogs.pages,rows:inventoryLogs.rows,failedSkus:inventoryLogs.failures.length,failures:inventoryLogs.failures,skippedSkus:inventoryLogs.skippedSkus}));
    return { resource:'inventory', received, normalized, inventoryLogs, shipments:shipmentResult.shipments, shipmentItems:shipmentResult.items, shipmentMode:shipmentResult.mode, cursor:randomUUID(), correlationIds:[] };
  } finally { await pool.end(); }
}
