import {createHash} from 'node:crypto';
import {createDb} from '../db.js';
export type Scope={tenantId:string;storeId:string;sourceId:string;capturedAt:Date};
export type RecordRow=Record<string,any>;
export const idFor=(...parts:unknown[])=>createHash('sha256').update(JSON.stringify(parts)).digest('hex');
export const text=(x:any):string|null=>x==null||String(x).trim()===''?null:String(x).trim();
export const decimal=(x:any):string|null=>x==null||x===''||!Number.isFinite(Number(x))?null:String(x);
export const bool=(x:any):number|null=>x==null||x===''?null:typeof x==='boolean'?(x?1:0):['Y','YES','TRUE','1'].includes(String(x).toUpperCase())?1:['N','NO','FALSE','0'].includes(String(x).toUpperCase())?0:null;
export const date=(x:any):Date|null=>{if(x==null||x==='')return null;const us=String(x).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);if(us)return new Date(Date.UTC(Number(us[3]),Number(us[1])-1,Number(us[2])));const d=x instanceof Date?x:typeof x==='number'||/^\d{13}$/.test(String(x))?new Date(Number(x)):new Date(String(x));return Number.isFinite(d.getTime())?d:null;};
export const rows=(x:any):any[]=>Array.isArray(x)?x:[];
export const metadata=(scope:Scope)=>({tenant_id:scope.tenantId,store_id:scope.storeId,source_id:scope.sourceId,captured_at:scope.capturedAt});
export async function upsertRows(c:any,table:string,values:RecordRow[],guard=false){
 if(!values.length)return;const keys=Object.keys(values[0]);
 const updates=keys.filter(k=>!['id','tenant_id','store_id'].includes(k)).map(k=>`${k}=${guard&&k!=='captured_at'?`IF(captured_at<=VALUES(captured_at),COALESCE(VALUES(${k}),${k}),${k})`:k==='captured_at'&&guard?'GREATEST(captured_at,VALUES(captured_at))':`VALUES(${k})`}`);
 for(let offset=0;offset<values.length;offset+=150){const chunk=values.slice(offset,offset+150);await c.query(`INSERT INTO ${table} (${keys.join(',')}) VALUES ${chunk.map(()=>`(${keys.map(()=>'?').join(',')})`).join(',')} ON DUPLICATE KEY UPDATE ${updates.join(',')}`,chunk.flatMap(r=>keys.map(k=>r[k]??null)));}
}
export async function transaction<T>(work:(c:any)=>Promise<T>,pool:any=createDb().pool):Promise<T>{const c=await pool.getConnection();try{await c.beginTransaction();const value=await work(c);await c.commit();return value;}catch(e){await c.rollback();throw e;}finally{c.release();}}
