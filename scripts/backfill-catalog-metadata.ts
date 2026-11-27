import fs from 'node:fs';
import path from 'node:path';
import {createDb} from '../packages/db/src/db.js';
import {latestItemReportFields} from '../packages/db/src/normalization/item-report.js';
import {catalogMissingFields} from '../packages/db/src/normalization/catalog.js';
import {productImageUrl} from '../apps/api/src/routes/product-images.js';
import {buildAllSkuChineseNameMap} from '../apps/api/src/routes/allskuOwnerMapping.js';
const tenantId=process.env.CATALOG_TENANT_ID??'default';
const apply=process.argv.includes('--apply');
const {pool}=createDb();
try{
 const reports=await latestItemReportFields(pool,tenantId);
 const [allsku]:any=await pool.query('SELECT sku,store_name AS storeName,item_id AS itemId FROM smartsheet_allsku_rows WHERE tenant_id=?',[tenantId]);
 const [stores]:any=await pool.query('SELECT id,name FROM stores WHERE tenant_id=?',[tenantId]);
 const allSkuIds=buildAllSkuChineseNameMap(allsku.map((r:any)=>({...r,productName:r.itemId})),stores);
 const [skus]:any=await pool.query('SELECT id,store_id,external_id,item_id,image_url,title,details FROM skus WHERE tenant_id=?',[tenantId]);
 const proposals:any[]=[];let conflicts=0;
 for(const r of skus){const details=typeof r.details==='string'?JSON.parse(r.details):r.details;const key=`${r.store_id}:${r.external_id.trim().toUpperCase()}`;
 const fields={...(details?.itemReport??{}),...(reports.get(key)??{})};
 if(!fields['Item ID']&&!fields['Item Id']&&!fields['Product ID']&&!fields['Product Id'])fields['Item ID']=allSkuIds.get(key)??'';
 const patch=catalogMissingFields({itemId:r.item_id,imageUrl:r.image_url,title:r.title},fields);
 if(!r.image_url?.trim()&&!patch.imageUrl){const image=productImageUrl(undefined,details);if(image)patch.imageUrl=image;}
 const reportId=fields['Item ID']??fields['Item Id']??fields['Product ID']??fields['Product Id'];if(r.item_id?.trim()&&reportId?.trim()&&r.item_id.trim()!==reportId.trim())conflicts++;
 if(Object.keys(patch).length)proposals.push({id:r.id,...patch});
 }
 console.log(JSON.stringify({apply,scanned:skus.length,proposed:proposals.length,itemIds:proposals.filter(r=>r.itemId).length,images:proposals.filter(r=>r.imageUrl).length,titles:proposals.filter(r=>r.title).length,existingItemIdConflicts:conflicts}));
 if(apply&&proposals.length){
  const c=await pool.getConnection();await c.beginTransaction();
  try{
   const before:any[]=[];for(const r of proposals){const [rows]:any=await c.query('SELECT id,item_id,image_url,title FROM skus WHERE tenant_id=? AND id=? FOR UPDATE',[tenantId,r.id]);before.push(...rows);}
   const dir=path.resolve('..','backups');fs.mkdirSync(dir,{recursive:true});const backup=path.join(dir,`catalog-metadata-${Date.now()}.json`);fs.writeFileSync(backup,JSON.stringify({tenantId,before,proposals},null,2),{mode:0o600});
   for(const r of proposals)await c.query("UPDATE skus SET item_id=COALESCE(NULLIF(TRIM(item_id),''),?),image_url=COALESCE(NULLIF(TRIM(image_url),''),?),title=COALESCE(NULLIF(TRIM(title),''),?) WHERE tenant_id=? AND id=?",[r.itemId??null,r.imageUrl??null,r.title??null,tenantId,r.id]);
   await c.commit();console.log(JSON.stringify({committed:true,backup}));
  }catch(e){await c.rollback();throw e;}finally{c.release();}
 }
 const [after]:any=await pool.query("SELECT COUNT(*) n,SUM(NULLIF(TRIM(item_id),'') IS NULL) missingItemId,SUM(NULLIF(TRIM(image_url),'') IS NULL) missingImage FROM skus WHERE tenant_id=?",[tenantId]);console.log(JSON.stringify({coverage:after}));
}catch(error){console.error(error instanceof Error?error.message:String(error));process.exitCode=1;}finally{await pool.end();}process.exit(process.exitCode??0);
