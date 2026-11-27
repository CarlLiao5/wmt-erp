import {expect,it} from 'vitest';
import {normalizeOrderExtensions} from './order-extensions.js';
import {trackingIdentity,mergeTrackingRows} from './order-tracking.js';
const scope={tenantId:'t',storeId:'s',sourceId:'page',capturedAt:new Date('2026-11-18')};
function tracking(carrierName:any,extra:any={}){return normalizeOrderExtensions({orders:[{purchaseOrderId:'PO',orderLines:[{lineNumber:'1',orderLineStatuses:{orderLineStatus:[{trackingInfo:{trackingNumber:' TRACK ',carrierName,...extra}}]}}]}]},scope).tracking[0];}
it('uses carrier text instead of object property order, shape or surrounding whitespace',()=>{
 const a=tracking({carrier:null,otherCarrier:' FedEx '});
 expect(tracking({otherCarrier:'FedEx',carrier:null}).id).toBe(a.id);
 expect(tracking({carrier:'FedEx'}).id).toBe(a.id);
 expect(tracking('FedEx').id).toBe(a.id);
 expect(a.id).toBe(trackingIdentity(a));
});
it('keeps tenants, stores, lines, tracking numbers and carriers separate',()=>{
 const row=tracking({carrier:'FedEx'});
 for(const patch of [{tenant_id:'other'},{store_id:'other'},{order_number:'other'},{line_number:'2'},{tracking_number:'other'},{carrier:'UPS'}])expect(trackingIdentity({...row,...patch})).not.toBe(row.id);
 expect(tracking({carrier:'FedEx'},{trackingURL:'new',shipDateTime:'2026-01-01'}).id).toBe(row.id);
});
it('keeps unnumbered shipments distinct by known shipping time and URL',()=>{
 const a=tracking(null,{trackingNumber:null,shipDateTime:'2026-01-01',trackingURL:'url-a'});
 expect(tracking(null,{trackingNumber:null,shipDateTime:'2026-01-02',trackingURL:'url-a'}).id).not.toBe(a.id);
 expect(tracking(null,{trackingNumber:null,shipDateTime:'2026-01-01',trackingURL:'url-b'}).id).not.toBe(a.id);
});
it('merges latest known values deterministically without losing older nonempty metadata',()=>{
 const a=tracking({carrier:'FedEx'},{trackingURL:'old'});
 const old={...a,source_id:'old',captured_at:new Date('2026-01-01'),method_code:'EXPRESS'};
 const fresh={...a,id:'legacy',source_id:'new',captured_at:new Date('2026-02-01'),tracking_url:'new',method_code:null};
 expect(mergeTrackingRows([fresh,old])).toMatchObject({id:a.id,tracking_url:'new',method_code:'EXPRESS',source_id:'new'});
 expect(mergeTrackingRows([old,fresh])).toEqual(mergeTrackingRows([fresh,old]));
});
