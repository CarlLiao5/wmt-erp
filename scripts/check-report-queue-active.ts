import {createSyncQueue,reportQueueNameForStore} from '../apps/worker/src/queue.js';
console.log('checkedAt',new Date().toISOString());
for(const storeId of ['10001133528','10001156838','10001578336','10002512034','prod-001']){
 const q=createSyncQueue(undefined,reportQueueNameForStore(storeId));
 const jobs=await q.queue.getJobs(['active','waiting','delayed'],0,15);
 console.log(JSON.stringify({storeId,jobs:await Promise.all(jobs.map(async j=>({resource:j.data.resource,month:j.data.window?.from?.slice(0,7),state:await j.getState(),startedAt:j.processedOn?new Date(j.processedOn).toISOString():null,dueAt:j.data.reportContinuation?.resumeAt?new Date(j.data.reportContinuation.resumeAt).toISOString():j.delay?new Date(j.timestamp+j.delay).toISOString():null,attempts:j.attemptsMade})))}));
 await q.queue.close();await q.redis.quit();
}
process.exit(0);
