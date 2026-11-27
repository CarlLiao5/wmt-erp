import {createDb} from './db.js';
import {archiveCutoff,normalizeRaw,readArchive,writeArchive,deleteArchivedBatch} from './raw-archive.js';
import {verifyArchivedCoverage} from './raw-archive-coverage.js';
function arg(key:string){return process.argv.slice(2).find(x=>x.startsWith(`--${key}=`))?.slice(key.length+3);}
const mode=arg('mode')??'preview';
try{
 if(mode==='verify'){const path=arg('archive');if(!path)throw Error('--archive required');const rows=await readArchive(path);console.log(JSON.stringify({mode,count:rows.length,verified:true}));}
 else{
 const tenant=arg('tenant'),store=arg('store'),resource=arg('resource');if(!tenant||!store||!resource)throw Error('--tenant, --store and --resource required (one scope per run)');
 const days=Number(arg('days')??(/return|recon|payment|item-report/i.test(resource)?365:90)),cutoff=archiveCutoff(resource,new Date(),days);const {pool}=createDb();
 const size=Number(arg('batch-size')??10);if(!Number.isInteger(size)||size<1||size>100)throw Error('batch-size must be 1..100');
 const max=Number(arg('max-batches')??1);if(!Number.isInteger(max)||max!==1)throw Error('Only one bounded batch per invocation is supported');
 if(mode==='purge'){
  const path=arg('archive'),operator=arg('operator'),backup=arg('backup-id');if(!path||!operator||!backup)throw Error('purge requires --archive, --operator and --backup-id');
  if(resource!=='item-report')throw Error('This resource is archive-only: full normalized coverage verifier not yet available');
  const rows=await readArchive(path);if(rows.some(r=>r.tenant_id!==tenant||r.store_id!==store||r.resource!==resource||new Date(r.received_at)>=cutoff))throw Error('Archive scope or retention mismatch');
  await deleteArchivedBatch(pool,rows,verifyArchivedCoverage,operator,backup);console.log(JSON.stringify({mode,count:rows.length,archive:path}));
 }else if(mode==='preview'||mode==='archive'){
  const directory=arg('directory');if(mode==='archive'&&!directory)throw Error('--directory required');const after=arg('after-time')??'1970-01-01T00:00:00.000Z',afterId=arg('after-id')??'0';if(!Number.isFinite(new Date(after).getTime())||!/^\d+$/.test(afterId))throw Error('Invalid checkpoint');let count=0;
  for(let batch=0;batch<max;batch++){
   const [found]:any=await pool.query(`SELECT CAST(id AS CHAR) AS id,tenant_id,store_id,resource,external_id,CAST(payload AS CHAR) AS payload,http_status,correlation_id,received_at FROM raw_payloads FORCE INDEX(raw_payload_resource_store_time_idx) WHERE tenant_id=? AND resource=? AND store_id=? AND received_at<? AND (received_at>? OR (received_at=? AND id>?)) ORDER BY received_at,id LIMIT ${size}`,[tenant,resource,store,cutoff,new Date(after),new Date(after),afterId]);
   if(!found.length)break;const rows=found.map(normalizeRaw);count+=rows.length;
   const path=mode==='archive'?await writeArchive(directory!,rows):undefined;console.log(JSON.stringify({mode,batch:batch+1,count:rows.length,archive:path,cutoff:cutoff.toISOString(),purgeSupported:resource==='item-report',nextCheckpoint:{afterTime:rows.at(-1)?.received_at,afterId:rows.at(-1)?.id}}));
  }
  console.log(JSON.stringify({mode,selected:count,deleted:0}));
 }else throw Error('mode must be preview, archive, verify or purge');
 }
}catch(e){console.error(e instanceof Error?e.message:String(e));process.exitCode=1;}
process.exit(process.exitCode??0);
