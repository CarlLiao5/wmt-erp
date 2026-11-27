const fs=require('fs'),path=require('path');
const root=path.resolve(__dirname,'../..');
const esbuild=require(root+'/node_modules/.pnpm/esbuild@0.24.2/node_modules/esbuild');
const dependencies={};
for(const dir of ['apps','packages']) for(const name of fs.readdirSync(root+'/'+dir)) {
 const f=root+'/'+dir+'/'+name+'/package.json'; if(!fs.existsSync(f))continue;
 for(const [key,value] of Object.entries(JSON.parse(fs.readFileSync(f)).dependencies||{})) if(!key.startsWith('@walmart-erp/')) dependencies[key]=value;
}
const out=process.env.WMTERP_RELEASE_DIR || path.join(root,'dist-release');
fs.mkdirSync(out,{recursive:true});
fs.writeFileSync(out+'/package.json',JSON.stringify({name:'wmterp-runtime',private:true,type:'module',dependencies},null,2));
(async()=>{
 for(const [name,file] of [['api','apps/api/src/app.ts'],['worker','apps/worker/src/main.ts']]) {
 await esbuild.build({absWorkingDir:root,entryPoints:[file],outfile:out+'/'+name+'.mjs',bundle:true,platform:'node',format:'esm',target:'node22',external:Object.keys(dependencies),banner:{js:"import { createRequire as __createRequire } from 'node:module'; const require=__createRequire(import.meta.url);"},logLevel:'warning'});
 }
 fs.writeFileSync(out+'/server.mjs',"import {createApp} from './api.mjs';createApp().listen(Number(process.env.PORT||3100),'127.0.0.1',()=>console.log('ERP API ready'));\n");
 console.log('Runtime bundles ready; external packages:',Object.keys(dependencies).length);
})();
