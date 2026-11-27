import assert from 'node:assert/strict';
import {mysqlWfsHistorySource} from '../apps/api/src/routes/wfs.js';
import {renderWfsProductImage} from '../apps/web/src/pages/WfsPage.js';
try {
 const rows=await mysqlWfsHistorySource()('shipments','default','10001133528','2026-11-01','2026-11-18');
 const shipment:any=rows.find(r=>r.shipmentId==='4296958WFB');assert(shipment);
 assert.equal(shipment.items.length,2);
 for(const item of shipment.items){assert(item.itemDesc?.length>10);assert(/^https?:\/\//.test(item.imageUrl));assert(renderWfsProductImage(item.imageUrl).includes('<img'));assert.equal(item.itemQty,60);assert.equal(item.actualShippedQty,undefined);}
 console.log(JSON.stringify({shipmentId:shipment.shipmentId,items:shipment.items.map((i:any)=>({sku:i.sku,description:!!i.itemDesc,image:!!i.imageUrl,planned:i.itemQty,actualShipped:i.actualShippedQty??null,actualReceived:i.actualReceivedQty??null})),verified:true}));
}catch(e){console.error(e instanceof Error?e.message:String(e));process.exitCode=1;}
process.exit(process.exitCode??0);
