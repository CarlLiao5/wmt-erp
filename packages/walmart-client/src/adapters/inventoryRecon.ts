import {parseCsv} from './itemReport.js';
import {walmartReportRequest,getSemReportStatus,downloadSemReport} from './sem.js';
import type {WalmartConnection} from '../types.js';

export const reconMovements = ['received','sold','lost','found','undelivered','transferred','returnedToSeller','removed'] as const;
const quantityFields = {
 startingQuantity:'Starting Quantity', received:'Received', sold:'Sold', lost:'Lost', found:'Found',
 undelivered:'Undelivered', transferred:'Transferred', returnedToSeller:'Returned to Seller',
 removed:'Removed', finalQuantity:'Final Quantity',
} as const;

export function inventoryReconWindow(from:string,to:string) {
 const month=from.slice(0,7);
 if(!/^\d{4}-\d{2}$/.test(month))throw Error('Invalid inventory reconciliation month');
 const next=new Date(month+'-01T00:00:00.000Z');
 if(!Number.isFinite(next.getTime())||next.toISOString().slice(0,7)!==month)throw Error('Invalid inventory reconciliation month');
 next.setUTCMonth(next.getUTCMonth()+1);
 const last=new Date(next.getTime()-1).toISOString().slice(0,10);
 if(from.slice(0,10)!==month+'-01'||to.slice(0,10)!==last)throw Error('Inventory reconciliation requires one complete calendar month');
 return {dataStartTime:month+'-01T00:00:00.000Z',dataEndTime:last+'T23:59:59.999Z'};
}
export function parseInventoryRecon(content:Uint8Array|string,month:string) {
 const range=inventoryReconWindow(month+'-01',new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0)).toISOString().slice(0,10));
 return parseCsv(content, ['Start Date','End Date','SKU','Fulfillment Center',...Object.values(quantityFields)]).map(fields=>{
  for(const key of ['Start Date','End Date','SKU','Fulfillment Center',...Object.values(quantityFields)])if(!Object.hasOwn(fields,key))throw Error('Inventory reconciliation missing column: '+key);
  if(!fields.SKU||!fields['Fulfillment Center'])throw Error('Inventory reconciliation missing SKU or warehouse');
  if(fields['Start Date']!==range.dataStartTime.slice(0,10)||fields['End Date']!==range.dataEndTime.slice(0,10))throw Error('Inventory reconciliation report period mismatch');
  const values=Object.fromEntries(Object.entries(quantityFields).map(([key,column])=>{
   const raw=fields[column].replace(/,/g,'').trim();
   const value=Number(raw);
   if(!raw||!Number.isSafeInteger(value))throw Error('Invalid inventory reconciliation quantity: '+column);
   return [key,value];
  })) as Record<keyof typeof quantityFields,number>;
  return {sku:fields.SKU,gtin:fields.GTIN??'',itemId:fields['Item ID']??'',itemName:fields['Item Name']??'',fulfillmentCenter:fields['Fulfillment Center'],...values,
   difference:values.finalQuantity-values.startingQuantity-reconMovements.reduce((sum,key)=>sum+values[key],0),fields};
 });
}
export async function requestInventoryRecon(connection:WalmartConnection,from:string,to:string,fetcher:typeof fetch=fetch) {
 const response=await walmartReportRequest(connection,'POST','/v3/reports/reportRequests?reportType=INVENTORY_RECON&reportVersion=v1',
  {method:'POST',body:JSON.stringify(inventoryReconWindow(from,to))},fetcher);
 const data=await response.json();
 if(!data.requestId)throw Error('Inventory reconciliation requestId missing');
 return data as {requestId:string;requestStatus:string};
}
export const getInventoryReconStatus=getSemReportStatus;
export const downloadInventoryRecon=downloadSemReport;
