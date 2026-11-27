import { expect, it } from 'vitest';
import { inventoryTransit } from './inventory-transit.js';
it('counts repeated sync versions of 0582801WFB once while retaining distinct purchase batches', () => {
 const shipment = {storeId:'10001133528', sku:'XMDK-NSB-001', shipmentId:'0582801WFB', shippedAt:'2026-08-20', contractNumber:'PO260708012', purchaseBatchNumber:'PP260706002', inboundNumber:'QT10003174'};
 const result = inventoryTransit([
 {...shipment, id:'old', quantity:'4000', receivedAt:'2026-11-04T04:04:37Z'},
 {...shipment, id:'new', quantity:'4032', receivedAt:'2026-11-09T04:00:59Z'},
 ], []);
 expect(result.get('10001133528:XMDK-NSB-001')?.details[0].shipped).toBe(4032);
 const split = inventoryTransit([
 {...shipment, id:'one', quantity:'100'},
 {...shipment, id:'two', purchaseBatchNumber:'PP-OTHER', quantity:'100'},
 ], []);
 expect(split.get('10001133528:XMDK-NSB-001')?.quantity).toBe(200);
});
it('keeps a signed head-freight shipment in transit until WFS receipt logs confirm full receipt', () => {
 const result = inventoryTransit([
  {id:'old-1',storeId:'10001133528',sku:'SKU-1',shipmentId:'5041115WFA',shippedAt:'2026-01-24',quantity:'300',signedStatus:'已签收'},
  {id:'old-2',storeId:'10001133528',sku:'SKU-2',shipmentId:'5040971WFA',shippedAt:'2026-01-27',quantity:'352',signedStatus:'已签收'},
 ], []);
 expect(result.get('10001133528:SKU-1')?.quantity).toBe(300);
 expect(result.get('10001133528:SKU-2')?.quantity).toBe(352);
});
it('subtracts signed receipt corrections per store SKU shipment, not across shipments', () => {
 const heads = [
 {id:'1',storeId:'a',sku:' sku ',shipmentId:'s1',shippedAt:'2026-11-01',quantity:'100'},
 {id:'2',storeId:'a',sku:'SKU',shipmentId:'s1',shippedAt:'2026-11-02',quantity:'100'},
 {id:'3',storeId:'a',sku:'SKU',shipmentId:'s2',shippedAt:'2026-11-01',quantity:'20'},
 {id:'4',storeId:'b',sku:'SKU',shipmentId:'s1',shippedAt:'2026-11-01',quantity:'30'},
 {id:'5',storeId:'a',sku:'SKU',shipmentId:'s3',shippedAt:'',quantity:'900'},
 ];
 const receipts = [
 {storeId:'a',sku:'SKU',shipmentId:'S1',changedUnits:60,reasonDescription:'Received'},
 {storeId:'a',sku:'SKU',shipmentId:'s1',changedUnits:-5,reasonDescription:'Receiving Correction'},
 {storeId:'a',sku:'SKU',shipmentId:'s2',changedUnits:40,reasonDescription:'Received'},
 {storeId:'a',sku:'SKU',shipmentId:'s1',changedUnits:400,reasonDescription:'Adjustment'},
 ];
 const result = inventoryTransit([...heads, heads[0]], receipts);
 expect(result.get('a:SKU')?.quantity).toBe(145);
 expect(result.get('a:SKU')?.details).toHaveLength(2);
 expect(result.get('b:SKU')?.quantity).toBe(30);
});
it('keeps missing shipment or invalid quantity as review-only and never guesses a store', () => {
 const result = inventoryTransit([
 {id:'1',storeId:'a',sku:'SKU',shippedAt:'2026-11-01',quantity:'10'},
 {id:'2',storeId:'a',sku:'SKU',shipmentId:'s1',shippedAt:'2026-11-01',quantity:'bad'},
 {id:'3',storeId:null,sku:'SKU',shipmentId:'s1',shippedAt:'2026-11-01',quantity:'20'},
 ], []);
 expect(result.get('a:SKU')?.quantity).toBe(0);
 expect(result.get('a:SKU')?.details.every(row => row.needsReview)).toBe(true);
 expect(result.size).toBe(1);
});
