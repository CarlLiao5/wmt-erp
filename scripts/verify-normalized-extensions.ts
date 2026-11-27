import assert from 'node:assert/strict';
import {createDb} from '../packages/db/src/db.js';
import {persistOrderExtensions,orderLineExtensions} from '../packages/db/src/normalization/order-extensions.js';
import {persistInventoryHealth,latestInventoryHealth} from '../packages/db/src/normalization/inventory-health.js';
import {persistItemReport,latestItemReportFields} from '../packages/db/src/normalization/item-report.js';
const {pool}=createDb();const c=await pool.getConnection();await c.beginTransaction();
try{
 const scope={tenantId:'verify-standard',storeId:'store',sourceId:'new',capturedAt:new Date('2026-11-17T00:00:00Z')};const old={...scope,sourceId:'old',capturedAt:new Date('2026-10-01T00:00:00Z')};
 const payload={orders:[{purchaseOrderId:'PO',shippingInfo:{estimatedShipDate:1794873600000},orderLines:[{lineNumber:'1',item:{sku:'SKU'},charges:{charge:[{chargeType:'PRODUCT',chargeAmount:{amount:10,currency:'USD'}}]},orderLineStatuses:{orderLineStatus:[{status:'Shipped',trackingInfo:{trackingNumber:'TRACK'}}]}}]}]};
 await persistOrderExtensions(c,payload,scope);await persistOrderExtensions(c,payload,scope);await persistOrderExtensions(c,{orders:[{purchaseOrderId:'PO'}]},old);
 const [ship]:any=await c.query('SELECT * FROM order_shipping_details WHERE tenant_id=?',[scope.tenantId]);assert.equal(ship.length,1);assert.equal(ship[0].source_id,'new');assert.ok(ship[0].estimated_ship_at);
 const detail=await orderLineExtensions(c,scope.tenantId,[{storeId:'store',orderNumber:'PO',lineNumber:'1'}]);assert.equal(detail.get('store:PO:1')?.tracking[0].tracking_number,'TRACK');assert.equal(detail.get('store:PO:1')?.charges.length,1);assert.equal((await orderLineExtensions(c,'other',[{storeId:'store',orderNumber:'PO',lineNumber:'1'}])).size,0);
 await persistInventoryHealth(c,{itemInformation:{sku:'SKU'},inventoryData:{reservedUnits:0,inventoryAge:{'0To90days':2}}},scope);const health=await latestInventoryHealth(c,scope.tenantId);assert.equal(health.length,1);assert.equal(health[0].reservedQuantity,0);assert.equal(health[0].ageDistribution?.['0To90days'],2);
 await persistItemReport(c,[{SKU:'SKU',Price:'0','Extra Field':'kept'}],{...scope,requestId:'req'});await persistItemReport(c,[{SKU:'SKU',Price:'0','Extra Field':'kept'}],{...scope,requestId:'req'});const fields=await latestItemReportFields(c,scope.tenantId);assert.equal(fields.get('store:SKU')?.['Extra Field'],'kept');
 console.log(JSON.stringify({transactionalIntegration:'passed',idempotency:true,staleGuard:true,tenantIsolation:true,healthAndItemReadCompatibility:true,rolledBack:true}));
}finally{await c.rollback();c.release();}process.exit(0);
