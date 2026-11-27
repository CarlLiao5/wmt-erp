import { inventoryLogQuery } from './syncInventory.js';
type Candidate = { sku: string; gtin?: string; quantity?: number };
export async function syncInventoryLogPages(candidates: Candidate[], window: {from:string;to:string}, deps: {
  fetch: (query: ReturnType<typeof inventoryLogQuery>) => Promise<any>;
  archive: (row: Candidate & {gtin:string}, offset:number, payload:any) => Promise<void>;
  save: (row: Candidate & {gtin:string}, log:any) => Promise<void>;
}) {
  const result = {skus:0,pages:0,rows:0,skippedSkus:[] as string[],failures:[] as {sku:string;gtin:string;offset:number;error:string}[]};
  const unique = new Map(candidates.map(row=>[row.sku,row]));
  for(const candidate of unique.values()) {
    const gtin=candidate.gtin?.trim();
    if(!gtin){result.skippedSkus.push(candidate.sku);continue;}
    const row={...candidate,gtin};result.skus++;let offset=0;
    try {
      while(true){
        const payload=await deps.fetch(inventoryLogQuery(window,gtin,offset));
        await deps.archive(row,offset,payload);result.pages++;
        const logs=payload?.payload?.inventoryLog??payload?.inventoryLog;
        if(!Array.isArray(logs))throw Error('Invalid inventoryLog response');
        for(const log of logs){await deps.save(row,log);result.rows++;}
        if(logs.length<50)break;
        offset+=logs.length;
      }
    }catch(error){result.failures.push({sku:row.sku,gtin,offset,error:error instanceof Error?error.message:'Inventory log sync failed'});}
  }
  return result;
}
