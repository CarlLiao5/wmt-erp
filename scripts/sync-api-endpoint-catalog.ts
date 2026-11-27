import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { createHash } from 'node:crypto';
import { createApp } from '../apps/api/src/app.js';
import { createDb } from '../packages/db/src/db.js';

// Only instantiates the application: no listen(), requests, or sync jobs.
const root=process.cwd();
const sources=new Map<string,Array<{file:string;line:number}>>();
for(const name of fs.readdirSync(path.join(root,'apps/api/src/routes')).filter(n=>/\.(ts|tsx)$/.test(n)&&!n.includes('.test.'))){
 const file='apps/api/src/routes/'+name, source=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);
 const walk=(node:ts.Node)=>{if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&node.arguments[0]&&ts.isStringLiteralLike(node.arguments[0])){const method=node.expression.name.text.toUpperCase();if(['GET','POST','PUT','PATCH','DELETE','OPTIONS','HEAD','ALL'].includes(method)){const key=method+' '+node.arguments[0].text;const entries=sources.get(key)??[];entries.push({file,line:source.getLineAndCharacterOfPosition(node.getStart()).line+1});sources.set(key,entries);}}ts.forEachChild(node,walk);};walk(source);
}
// This helper registers three GET routes using its path argument.
const advertisingFile='apps/api/src/routes/advertising.ts';
const advertisingText=fs.readFileSync(advertisingFile,'utf8');
for(const match of advertisingText.matchAll(/onsitePageRoute\('([^']+)'/g))sources.set('GET '+match[1],[{file:advertisingFile,line:advertisingText.slice(0,match.index).split('\n').length}]);
const app=createApp() as any;
const endpoints=new Map<string,any>();
const visit=(stack:any[],prefix:string)=>{for(const layer of stack){if(layer.route){const paths=Array.isArray(layer.route.path)?layer.route.path:[layer.route.path];for(const local of paths){if(typeof local!=='string')throw Error('Unsupported route path');for(const [method,enabled] of Object.entries(layer.route.methods)){if(!enabled)continue;const verb=method.toUpperCase(), full=prefix+local,key=verb+' '+full;const refs=sources.get(verb+' '+local)??[];const endpoint=endpoints.get(key)??{method:verb,path:full,module:local.split('/').filter(Boolean)[0]??'root',sources:[]};for(const ref of refs)if(!endpoint.sources.some((s:any)=>s.file===ref.file&&s.line===ref.line))endpoint.sources.push(ref);endpoints.set(key,endpoint);}}}else if(layer.handle?.stack){let mount='';if(layer.regexp?.fast_slash)mount='';else if(layer.regexp?.test('/api')&&String(layer.regexp).includes('api'))mount='/api';else if(prefix==='' && !layer.regexp) mount='/api'; else throw Error('Unrecognized router mount: '+String(layer.regexp));visit(layer.handle.stack,prefix+mount);}}};
const appSource=fs.readFileSync('apps/api/src/app.ts','utf8');
if(/app\.use\(['"](?!\/api['"])/.test(appSource))throw Error('Review changed application mount prefixes');
visit((app._router??app.router).stack,'');
const rows=[...endpoints.values()].sort((a,b)=>a.path.localeCompare(b.path)||a.method.localeCompare(b.method));
if(!rows.length||rows.some(r=>!r.path.startsWith('/api/')||!r.sources.length))throw Error('Catalog validation failed');
if(process.argv.includes('--dry-run')){console.log(JSON.stringify({count:rows.length,unmapped:rows.filter(r=>!r.sources.length),endpoints:rows},null,2));process.exit(0);}
const {pool}=createDb();
await pool.query(fs.readFileSync('packages/db/migrations/0050_api_endpoint_catalog.sql','utf8'));
const c=await pool.getConnection();
try{await c.beginTransaction();await c.query("UPDATE api_endpoint_catalog SET is_active=0 WHERE service='erp-api'");for(const r of rows){const id=createHash('sha256').update('erp-api '+r.method+' '+r.path).digest('hex');await c.query('INSERT INTO api_endpoint_catalog (id,service,http_method,endpoint_path,module_name,source_locations,is_active,first_seen_at,last_seen_at) VALUES (?,?,?,?,?,?,1,NOW(3),NOW(3)) ON DUPLICATE KEY UPDATE module_name=VALUES(module_name),source_locations=VALUES(source_locations),is_active=1,last_seen_at=NOW(3)',[id,'erp-api',r.method,r.path,r.module,JSON.stringify(r.sources)]);}await c.commit();const [counts]=await c.query("SELECT http_method,COUNT(*) count FROM api_endpoint_catalog WHERE service='erp-api' AND is_active=1 GROUP BY http_method ORDER BY http_method");console.log(JSON.stringify({written:rows.length,unmapped:rows.filter(r=>!r.sources.length).length,methods:counts}));}catch(e){await c.rollback();throw e;}finally{c.release();process.exit(0);}
