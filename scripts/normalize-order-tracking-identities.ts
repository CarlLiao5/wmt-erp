import assert from 'node:assert/strict';
import {mkdir,open} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createDb} from '../packages/db/src/db.js';
import {trackingIdentity,mergeTrackingRows} from '../packages/db/src/normalization/order-tracking.js';
import {upsertRows,type RecordRow} from '../packages/db/src/normalization/common.js';

const apply=process.argv.includes('--apply');const {pool}=createDb();
const tenantId=process.env.TRACKING_TENANT_ID??'default';
const valid=(r:RecordRow)=>r.tenant_id&&r.store_id&&r.order_number&&r.line_number&&(r.tracking_number||r.shipped_at||r.tracking_url);
let backup:Awaited<ReturnType<typeof open>>|undefined;
try {
 const [all]:any=await pool.query('SELECT * FROM order_line_tracking WHERE tenant_id=? ORDER BY id',[tenantId]);
 const groups=new Map<string,RecordRow[]>();let skipped=0;
 for(const row of all){if(!valid(row)){skipped++;continue;}const id=trackingIdentity(row);const group=groups.get(id)??[];group.push(row);groups.set(id,group);}
 const plan=[...groups].filter(([id,group])=>group.length>1||group[0].id!==id);
 console.log(JSON.stringify({mode:apply?'apply':'preview',tenantId,rows:all.length,canonicalGroups:groups.size,groupsToChange:plan.length,duplicateGroups:[...groups.values()].filter(g=>g.length>1).length,redundantRows:[...groups.values()].reduce((n,g)=>n+g.length-1,0),skipped}));
 if(apply&&plan.length){
  const dir=resolve('..','backups');await mkdir(dir,{recursive:true});const path=resolve(dir,`order-tracking-identities-${Date.now()}.jsonl`);
  backup=await open(path,'wx',0o600);
  for(const directory of [resolve(dir,'..'),dir]){const handle=await open(directory,'r');try{await handle.sync();}finally{await handle.close();}}
  console.log(JSON.stringify({backup:path}));
  for(let offset=0;offset<plan.length;offset+=400){
   const batch=plan.slice(offset,offset+400);const ids=[...new Set(batch.flatMap(([id,g])=>[id,...g.map(r=>r.id)]))].sort();
   const c=await pool.getConnection();
   try{
    await c.beginTransaction();
    const [locked]:any=await c.query(`SELECT * FROM order_line_tracking WHERE tenant_id=? AND id IN (${ids.map(()=>'?')}) ORDER BY id FOR UPDATE`,[tenantId,...ids]);
    const byIdentity=new Map<string,RecordRow[]>();for(const r of locked){const key=trackingIdentity(r);assert(batch.some(([id])=>id===key),'Unexpected identity under lock');const g=byIdentity.get(key)??[];g.push(r);byIdentity.set(key,g);}
    await backup.write(JSON.stringify({offset,rows:locked})+'\n');await backup.sync();
    const writes:RecordRow[]=[];const deletes:string[]=[];
    for(const [id,source] of batch){const actual=byIdentity.get(id);assert(actual?.length,'Source rows disappeared; rerun preview');for(const r of source)assert(locked.some((x:any)=>x.id===r.id),'Source changed; rerun preview');writes.push(mergeTrackingRows(actual));deletes.push(...actual.filter(r=>r.id!==id).map(r=>r.id));}
    await upsertRows(c,'order_line_tracking',writes);
    if(deletes.length)await c.query(`DELETE FROM order_line_tracking WHERE tenant_id=? AND id IN (${deletes.map(()=>'?')})`,[tenantId,...deletes]);
    await c.commit();console.log(JSON.stringify({processed:Math.min(offset+batch.length,plan.length),total:plan.length,removedLegacyIds:deletes.length}));
   }catch(e){await c.rollback();throw e;}finally{c.release();}
  }
 }
 const [after]:any=await pool.query('SELECT * FROM order_line_tracking WHERE tenant_id=?',[tenantId]);
 let mismatches=0;const seen=new Set<string>();let duplicates=0;
 for(const r of after){if(!valid(r))continue;const id=trackingIdentity(r);if(r.id!==id)mismatches++;if(seen.has(id))duplicates++;seen.add(id);}
 if(apply){assert.equal(mismatches,0);assert.equal(duplicates,0);assert.equal(after.length,groups.size+skipped);}
 console.log(JSON.stringify({complete:true,rows:after.length,nonCanonicalIds:mismatches,duplicateIdentities:duplicates,skipped}));
}catch(e){console.error(e instanceof Error?e.message:String(e));process.exitCode=1;}finally{await backup?.close();}
process.exit(process.exitCode??0);
