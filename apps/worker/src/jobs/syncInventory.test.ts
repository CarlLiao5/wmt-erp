import { describe, expect, it } from 'vitest';
import { normalizeWfsInventory, inventoryLogQuery, inventoryRisk, inventoryLogRawPayload } from './syncInventory.js';

it('keeps the Walmart Item ID distinct from the inventory product identifier',()=>{
 const rows=normalizeWfsInventory({itemInformation:{sku:'SKU',itemID:'123',productId:'00012345678901'},inventoryData:{availableUnits:0}},{tenantId:'t',storeId:'s'});
 expect(rows[0]).toMatchObject({itemId:'123',gtin:'00012345678901'});
 expect(normalizeWfsInventory({itemInformation:{sku:'SKU',productId:'00012345678901'},inventoryData:{}},{tenantId:'t',storeId:'s'})[0].itemId).toBeUndefined();
});

it('builds an auditable raw payload record for each inventory-log page', () => {
  expect(inventoryLogRawPayload({ storeId: 'store-1', tenantId: 'tenant-1', sku: 'SKU-1', gtin: 'GTIN-1', offset: 50, capturedAt: new Date('2026-11-17T00:00:00Z'), payload: { inventoryLog: [{ id: 'L1' }] } })).toMatchObject({
    tenantId: 'tenant-1', storeId: 'store-1', resource: 'wfs-inventory-log', externalId: 'store-1:GTIN-1:50', payload: { inventoryLog: [{ id: 'L1' }] },
  });
});
describe('WFS inventory normalization', () => {
  it('normalizes WFS node quantities and keeps only WFS rows', () => {
    const rows = normalizeWfsInventory({ inventory: [{ sku: 'SKU-1', fulfillmentType: 'WFS', nodeId: 'FC-1', quantity: 7, reservedQuantity: 2 }] }, { storeId: 's', tenantId: 't', now: new Date('2026-10-05T00:00:00Z') });
    expect(rows).toEqual([expect.objectContaining({ storeId: 's', tenantId: 't', sku: 'SKU-1', nodeId: 'FC-1', quantity: 7, reservedQuantity: 2, fulfillmentType: 'WFS' })]);
    const walmartRow = normalizeWfsInventory({ payload: { inventory: [{ itemInformation: { sku: 'SKU-X' }, inventoryData: { availableUnits: 4, reservedUnits: 1, onhandUnits: 5 } }] } }, { storeId: 's', tenantId: 't' }); expect(walmartRow[0]).toMatchObject({ sku: 'SKU-X', quantity: 4, reservedQuantity: 1 });
    expect(normalizeWfsInventory({ inventory: [{ sku: 'SKU-2', fulfillmentType: 'SELLER', quantity: 9 }] }, { storeId: 's', tenantId: 't' })).toEqual([]);
  });
  it('maps WFS fulfillment type without a ship node to WFS and preserves age buckets', () => {
    const rows = normalizeWfsInventory({ sku:'SKU-AGE', shipNodes:[{shipNode:null, shipNodeType:'WFSFulfilled', availToSellQty:3}], inventoryAge:{'0To90days':1,'365PlusDays':2} }, {storeId:'s',tenantId:'t'});
    expect(rows[0]).toMatchObject({nodeId:'WFS', ageDistribution:{'0To90days':1,'365PlusDays':2}});
  });
  it('classifies stockout and overstock risk', () => { expect(inventoryRisk({ quantity: 0, reservedQuantity: 0 })).toBe('stockout'); expect(inventoryRisk({ quantity: 100, reservedQuantity: 0, threshold: 20 })).toBe('overstock'); expect(inventoryRisk({ quantity: 5, reservedQuantity: 2, threshold: 20 })).toBe('normal'); });
  it('builds a date-bounded inventory-log query for the current sync window', () => {
    expect(inventoryLogQuery({ from: '2026-10-01T00:00:00Z', to: '2026-10-16T23:59:59Z' }, '123', 50)).toEqual({ gtin: '123', startDate: '2026-10-01', endDate: '2026-10-16', offset: 50, limit: 50 });
  });
});
