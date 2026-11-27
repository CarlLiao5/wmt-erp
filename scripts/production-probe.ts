import { createDb, rawPayloads } from '../packages/db/index.js';
import { randomUUID } from 'node:crypto';
import { mysqlConnectionLoader } from '../apps/worker/src/queue.js';
import { walmartGet } from '../packages/walmart-client/src/transport.js';
import { normalizeOrderPayload } from '../apps/worker/src/jobs/syncOrders.js';
import { normalizeReturnPayload } from '../apps/worker/src/jobs/syncReturns.js';
const context = { tenantId: 'default', storeId: 'prod-001', rawResponseId: 'production-probe' };
function shape(v: unknown, depth = 0): unknown {
 if (depth > 9) return typeof v;
 if (Array.isArray(v)) return { count: v.length, sample: v.length ? shape(v[0], depth+1) : null };
 if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,shape(x,depth+1)]));
 return typeof v;
}
try {
 const connection = await mysqlConnectionLoader({ ...context, resource:'orders', window:{from:'2026-10-01',to:'2026-10-05'} });
 if(connection.environment !== 'production' || new URL(connection.baseUrl).hostname !== 'marketplace.walmartapis.com') throw new Error('Production-only probe refused endpoint');
 const fetcher: typeof fetch = (url, options) => fetch(url,{...options,signal:AbortSignal.timeout(20000)});
 for (const resource of ['orders','returns']) {
  try {
   const r=await walmartGet(connection,`/v3/${resource}`,{fetcher,maxAttempts:1,query:{limit:'5'}});
   const {db,pool}=createDb();
   try { await db.insert(rawPayloads).values({tenantId:context.tenantId,storeId:context.storeId,resource,externalId:randomUUID(),payload:r.data,httpStatus:r.status,correlationId:r.correlationId,receivedAt:new Date()}); } finally {await pool.end();}
   const rows=resource==='orders'?normalizeOrderPayload(r.data,context):normalizeReturnPayload(r.data,context);
   console.log(JSON.stringify({resource,status:r.status,saved:true,normalizedCount:rows.length}));
  } catch(e) {console.log(JSON.stringify({resource,error:e instanceof Error?e.message:'failed'}));}
 }
} catch(e) { console.log(JSON.stringify({error:e instanceof Error?e.message:'failed'})); process.exitCode=1; }
