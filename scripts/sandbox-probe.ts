import { mysqlConnectionLoader } from '../apps/worker/src/queue.js';
import { walmartGet } from '../packages/walmart-client/src/transport.js';
import { normalizeOrderPayload } from '../apps/worker/src/jobs/syncOrders.js';
import { normalizeReturnPayload } from '../apps/worker/src/jobs/syncReturns.js';
const context = { tenantId: 'default', storeId: '001', rawResponseId: 'sandbox-probe' };
function shape(v: unknown, depth = 0): unknown {
 if (depth > 9) return typeof v;
 if (Array.isArray(v)) return { count: v.length, sample: v.length ? shape(v[0], depth+1) : null };
 if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,shape(x,depth+1)]));
 return typeof v;
}
try {
 const connection = await mysqlConnectionLoader({ ...context, resource:'orders', window:{from:'2026-10-01',to:'2026-10-05'} });
 if(connection.environment !== 'sandbox' || new URL(connection.baseUrl).hostname !== 'sandbox.walmartapis.com') throw new Error('Sandbox-only probe refused endpoint');
 const fetcher: typeof fetch = (url, options) => fetch(url,{...options,headers:{...options?.headers,...(process.env.PROBE_DYNAMIC_SANDBOX === '1' ? {'WM_SANDBOX':'v2'} : {})},signal:AbortSignal.timeout(20000)});
 for (const resource of ['orders','returns']) {
  try {
   const r=await walmartGet(connection,`/v3/${resource}`,{fetcher,maxAttempts:1});
   const rows=resource==='orders'?normalizeOrderPayload(r.data,context):normalizeReturnPayload(r.data,context);
   console.log(JSON.stringify({resource,status:r.status,shape:shape(r.data),normalizedCount:rows.length}));
  } catch(e) {console.log(JSON.stringify({resource,error:e instanceof Error?e.message:'failed'}));}
 }
} catch(e) { console.log(JSON.stringify({error:e instanceof Error?e.message:'failed'})); process.exitCode=1; }
