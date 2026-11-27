type Sale={storeId:string;sku:string;itemId:string|null;quantity:number};
type Ad={storeId:string;sku:string|null;itemId:string|null;spend:string;reportDate?:string};
export const profitProductKey=(store:string,sku:string)=>JSON.stringify([store,sku.trim().toUpperCase()]);
export type AdvertisingMissing={storeId:string;sku:string;itemIds:string;missing:string[];orderCount:number;quantity:number;revenue:number;advertisingSource:string;advertisingDifference:number;advertisingNetDifference:number};
export function reconcileProfitAdvertising(sales:Sale[],ads:Ad[],source:'站内广告'|'SEM',discount:number,catalog:Sale[]=[]){
 const units=new Map<string,number>(),items=new Map<string,Set<string>>();
 for(const row of sales){const key=profitProductKey(row.storeId,row.sku);units.set(key,(units.get(key)??0)+Math.max(0,row.quantity));if(row.itemId){const id=profitProductKey(row.storeId,row.itemId),set=items.get(id)??new Set();set.add(key);items.set(id,set);}}
 for(const row of catalog){const key=profitProductKey(row.storeId,row.sku);if(!units.has(key))units.set(key,0);if(row.itemId){const id=profitProductKey(row.storeId,row.itemId),set=items.get(id)??new Set();set.add(key);items.set(id,set);}}
 const directCharges:Array<{storeId:string;sku:string;amount:number;netAmount:number;source:'站内广告'|'SEM';reportDate?:string}>=[];
 const allocated=new Map<string,number>(),missing:AdvertisingMissing[]=[];
 const summary={reported:0,allocated:0,unallocated:0,netUnallocated:0,directDeducted:0};
 const factor=source==='SEM'?1-discount/100:1;
 for(const ad of ads){
  const spend=Number(ad.spend);if(!Number.isFinite(spend)||spend===0)continue;summary.reported+=spend;
  const direct=ad.sku?profitProductKey(ad.storeId,ad.sku):undefined;
  const matches=ad.itemId?items.get(profitProductKey(ad.storeId,ad.itemId)):undefined;
  const directValid=direct&&units.has(direct);
  const conflict=!!(directValid&&matches?.size&&!matches.has(direct!));
  const key=conflict?undefined:directValid?direct:matches?.size===1?[...matches][0]:undefined;
  if(key&&(units.get(key)??0)>0){allocated.set(key,(allocated.get(key)??0)+spend);summary.allocated+=spend;continue;}
  if(key&&units.has(key)){const [storeId,sku]=JSON.parse(key) as [string,string];directCharges.push({storeId,sku,amount:spend,netAmount:spend*factor,source,reportDate:ad.reportDate});summary.allocated+=spend;summary.directDeducted+=spend;continue;}
  summary.unallocated+=spend;
  missing.push({storeId:ad.storeId,sku:ad.sku?.trim().toUpperCase()||'',itemIds:ad.itemId??'',missing:[source+(conflict?'关联冲突':matches&&matches.size>1?'变体关联不唯一':'未匹配产品')],orderCount:0,quantity:0,revenue:0,advertisingSource:source,advertisingDifference:spend,advertisingNetDifference:spend*factor});
 }
 summary.netUnallocated=summary.unallocated*factor;
 const grouped=new Map<string,AdvertisingMissing>();
 for(const row of missing){const key=JSON.stringify([row.storeId,row.sku,row.itemIds,row.missing]);const existing=grouped.get(key);if(existing){existing.advertisingDifference+=row.advertisingDifference;existing.advertisingNetDifference+=row.advertisingNetDifference;}else grouped.set(key,{...row});}
 return {allocated,directCharges,missing:[...grouped.values()],summary};
}
