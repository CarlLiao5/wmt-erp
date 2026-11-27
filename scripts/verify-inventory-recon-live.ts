import {randomUUID} from 'node:crypto';
import {writeFile,readFile} from 'node:fs/promises';
import {createDb} from '../packages/db/src/db.js';
import {mysqlConnectionLoader} from '../apps/worker/src/queue.js';
import {getAccessToken} from '../packages/walmart-client/src/auth/token.js';
const dir='artifacts/inventory-recon-validation';
if(new URL(process.env.MYSQL_URL!).hostname.toLowerCase()!=='doke.synology.me')throw Error('Expected Doke');
const {pool}=createDb();
try {
 const [stores]:any=await pool.query("SELECT s.id,s.name,s.tenant_id tenantId FROM stores s JOIN store_credentials c ON c.store_id=s.id AND c.tenant_id=s.tenant_id WHERE s.environment='production' AND s.id NOT IN ('10001133528','10001156838') ORDER BY s.id LIMIT 1");
 const store=stores[0];if(!store)throw Error('No store');
 const connection=await mysqlConnectionLoader({tenantId:store.tenantId,storeId:store.id,resource:'item-report',window:{from:'',to:''}});
 const {accessToken}=await getAccessToken(connection);
 const headers={'WM_SEC.ACCESS_TOKEN':accessToken,'WM_QOS.CORRELATION_ID':randomUUID(),'WM_SVC.NAME':'Walmart Marketplace',Accept:'application/json','Content-Type':'application/json'};
 const mode=process.argv.includes('--status')?'status':process.argv.includes('--download')?'download':'submit';
 const file=dir+'/request.json';
 let path='/v3/reports/reportRequests?reportType=INVENTORY_RECON&reportVersion=v1';
 const body={dataStartTime:'2026-10-01T00:00:00.000Z',dataEndTime:'2026-10-31T23:59:59.999Z'};
 if(mode!=='submit'){const saved=JSON.parse(await readFile(file,'utf8'));path=mode==='status'?'/v3/reports/reportRequests/'+encodeURIComponent(saved.requestId):'/v3/reports/downloadReport?requestId='+encodeURIComponent(saved.requestId);}
 const r=await fetch(new URL(path,connection.baseUrl),{method:mode==='submit'?'POST':'GET',headers,...(mode==='submit'?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(120000)});
 console.log("rateLimit",JSON.stringify(Object.fromEntries([...r.headers].filter(([k])=>/retry|token|replen|rate/.test(k))))); const text=await r.text();let data:any;try{data=JSON.parse(text);}catch{data={text:text.slice(0,2000)};}
 console.log(JSON.stringify({mode,store:store.name,storeId:store.id,http:r.status,data}));
 await writeFile(dir+'/'+mode+'.json',JSON.stringify({store,body,http:r.status,data},null,2));
 if(mode==='submit'&&r.ok){const requestId=data.requestId??data.reportRequest?.requestId;if(requestId)await writeFile(file,JSON.stringify({requestId,store,body},null,2));}
 if(mode==='download'&&r.ok){const url=data.downloadURL??data.downloadUrl??data.reportRequest?.downloadURL;if(url){const d=await fetch(url);if(!d.ok)throw Error('Download HTTP '+d.status);const bytes=Buffer.from(await d.arrayBuffer());await writeFile(dir+'/report.download',bytes);console.log('Downloaded bytes:',bytes.length);}}
} catch(e){console.error(e instanceof Error?e.message:'Validation failed');process.exit(1);}
process.exit(0);
