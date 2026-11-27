import { randomUUID } from 'node:crypto';
import type { WalmartConnection, WalmartResponse } from './types.js';
import { getAccessToken } from './auth/token.js';
import { walmartRequest } from './request.js';

export interface InboundPreviewAddress { addressLine1:string; addressLine2?:string; city:string; stateCode:string; countryCode:string; postalCode:string; }
export interface InboundPreviewItem { productId:string; productType:'GTIN'; sku:string; itemDesc:string; itemQty:number; vendorPackQty:number; innerPackQty:number; expectedDeliveryDate:string; addOnServices?:Array<{serviceType:'LABEL'|'BAG'|'TAPE'|'WRAP'}>; itemNbr?:number; dimensions?:number[]; itemWeightQty?:number; nonSortItem?:boolean; shipNode?:string; }
export interface InboundPreviewRequest { inboundOrderId:string; returnAddress:InboundPreviewAddress; orderItems:InboundPreviewItem[]; shipNode?:string; }
export async function walmartInboundPreview<T=unknown>(connection: WalmartConnection, payload: InboundPreviewRequest, fetcher: typeof fetch = fetch, signal?: AbortSignal): Promise<WalmartResponse<T>> {
  const correlationId=randomUUID(); let token=connection.accessToken;
  if(!token || (connection.accessTokenExpiresAt && connection.accessTokenExpiresAt < Date.now()+60_000)) token=(await getAccessToken(connection,fetcher)).accessToken;
  const url=new URL('/v3/fulfillment/inbound-preview',connection.baseUrl);
  for(let attempt=0;attempt<3;attempt++){
  const response=await walmartRequest(connection,url,{method:'POST',signal,headers:{Accept:'application/json','Content-Type':'application/json',Authorization:`Bearer ${token}`,'WM_SEC.ACCESS_TOKEN':token,'WM_QOS.CORRELATION_ID':correlationId,'WM_SVC.NAME':'Walmart Marketplace','WM_MARKET':'us','WM_GLOBAL_VERSION':'3.1',...(connection.environment==='sandbox'?{'WM_SANDBOX':'v2'}:{})},body:JSON.stringify({header:{headerAttributes:{buId:'0',martId:'0'}},payload})},fetcher);
  const data=await response.json() as T;
  if((response.status===429 || response.status>=500) && attempt<2) continue;
  if(!response.ok || (data as any)?.status==='FAIL') {
    const errors=Array.isArray((data as any)?.errors)?(data as any).errors:[];
    const details=errors.map((error:any)=>[error.code,error.field,error.description??error.info].filter(Boolean).join(' · ')).join('; ').slice(0,800);
    throw new Error(`Walmart inbound preview failed: ${response.status}${details?': '+details:''}`);
  }
  return {data,status:response.status,correlationId,headers:response.headers};
  }
  throw new Error('Walmart inbound preview retry limit reached');
}
