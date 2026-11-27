import { describe, expect, it, vi } from 'vitest';
import { walmartInboundPreview } from './inbound-preview.js';
import type { WalmartConnection } from './types.js';

const connection: WalmartConnection = { clientId:'id', clientSecret:'secret', environment:'production', baseUrl:'https://example.test', accessToken:'token', accessTokenExpiresAt:Date.now()+300000 };

describe('inbound preview', () => {
  it('posts only to the fixed preview endpoint with the documented payload', async () => {
    const fetcher = vi.fn(async (url:string, init?:RequestInit) => {
      expect(String(url)).toBe('https://example.test/v3/fulfillment/inbound-preview');
      expect(init?.method).toBe('POST');
      const body = JSON.parse(String(init?.body));
      expect(body.header.headerAttributes).toEqual({buId:'0', martId:'0'});
      expect(body.payload.orderItems[0].productType).toBe('GTIN');
      return new Response(JSON.stringify({status:'OK', payload:[{previews:[{previewType:'inbound', preview:[{totalNetTransferCharge:240, currencyUnit:'USD'}]}]}]}), {status:200});
    }) as unknown as typeof fetch;
    const result = await walmartInboundPreview<{status:string}>(connection, { inboundOrderId:'CRO-1', returnAddress:{addressLine1:'1 Main',city:'LA',stateCode:'CA',countryCode:'US',postalCode:'90001'}, orderItems:[{productId:'00717067767134',productType:'GTIN',sku:'SKU',itemDesc:'item',itemQty:320,vendorPackQty:40,innerPackQty:8,expectedDeliveryDate:'2026-10-06T00:00:00Z'}] }, fetcher);
    expect(result.data.status).toBe('OK');
  });

  it('passes cancellation to the underlying request', async () => {
    const controller = new AbortController();
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.signal).toBeDefined();
      controller.abort();
      expect(init?.signal?.aborted).toBe(true);
      return new Response(JSON.stringify({ status: 'OK', payload: [] }), { status: 200 });
    }) as unknown as typeof fetch;
    await walmartInboundPreview({...connection,clientId:'preview-cancellation-test'}, { inboundOrderId: 'CRO-1', returnAddress: { addressLine1: '1 Main', city: 'LA', stateCode: 'CA', countryCode: 'US', postalCode: '90001' }, orderItems: [] }, fetcher, controller.signal);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

it('preserves API field errors so failed quotes can be diagnosed',async()=>{
 const fetcher=vi.fn(async()=>new Response(JSON.stringify({status:'FAIL',errors:[{code:'400.WFS.100',field:'orderItems[0].expectedDeliveryDate',description:'Expected Delivery Date should be of future and not the past'}]}),{status:400})) as unknown as typeof fetch;
 await expect(walmartInboundPreview({...connection,clientId:'preview-error-test'},{inboundOrderId:'test',returnAddress:{addressLine1:'a',city:'b',stateCode:'CA',countryCode:'US',postalCode:'90001'},orderItems:[]},fetcher)).rejects.toThrow('orderItems[0].expectedDeliveryDate');
});

it('retries rate limits through the shared paced bucket',async()=>{
 vi.useFakeTimers();
 try{
 const fetcher=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({status:'FAIL'}),{status:429})).mockResolvedValueOnce(new Response(JSON.stringify({status:'OK',payload:[]}),{status:200}));
 const pending=walmartInboundPreview({...connection,clientId:'preview-retry-test',accessTokenExpiresAt:undefined},{inboundOrderId:'test',returnAddress:{addressLine1:'a',city:'b',stateCode:'CA',countryCode:'US',postalCode:'90001'},orderItems:[]},fetcher);
 await vi.advanceTimersByTimeAsync(10000);
 expect((await pending).status).toBe(200);expect(fetcher).toHaveBeenCalledTimes(2);
 }finally{vi.useRealTimers();}
});
