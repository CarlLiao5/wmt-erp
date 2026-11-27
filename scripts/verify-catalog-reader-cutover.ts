import assert from 'node:assert/strict';
import {createDb} from '../packages/db/src/db.js';
import {allSkuProductFields,buildAllSkuChineseNameMap,buildAllSkuOwnerMap} from '../apps/api/src/routes/allskuOwnerMapping.js';
import {mysqlAssignmentLoader,resolveCommerceVisibility} from '../apps/api/src/routes/commerce-visibility.js';
import {mysqlProductAnalysisProducts} from '../apps/api/src/routes/product-analysis.js';
import {mysqlProductChineseNameResolver} from '../apps/api/src/routes/returns.js';
import {itemIdFromSources} from '../apps/api/src/routes/items.js';

const {pool}=createDb();
const tenantId='default';
const sorted=(values:Iterable<string>)=>[...values].sort();
async function rows(query:string){return (await pool.query(query,[tenantId]))[0] as any[];}
try {
 const [source,stores,catalog,members,storeGrants,skuGrants]=await Promise.all([
  rows('SELECT source_row_id AS sourceRowId,sku,store_name AS storeName,product_name AS productName,owner_name AS ownerName,item_id AS itemId,payload FROM smartsheet_allsku_rows WHERE tenant_id=?'),
  rows('SELECT id,name FROM stores WHERE tenant_id=?'),
  rows('SELECT id,store_id AS storeId,external_id AS externalId,item_id AS itemId,title,image_url AS imageUrl,details FROM skus WHERE tenant_id=?'),
  rows('SELECT id,display_name AS displayName,role FROM users WHERE tenant_id=?'),
  rows('SELECT tenant_id AS tenantId,user_id AS userId,store_id AS storeId,valid_from AS validFrom,valid_until AS validUntil FROM store_assignments WHERE tenant_id=?'),
  rows('SELECT tenant_id AS tenantId,user_id AS userId,sku_id AS skuId,valid_from AS validFrom,valid_until AS validUntil FROM sku_assignments WHERE tenant_id=?'),
 ]);
 const legacy=source.map(r=>({payload:typeof r.payload==='string'?JSON.parse(r.payload):r.payload}));
 let targetSourceDifferences=0;
 for(let i=0;i<source.length;i++)if(JSON.stringify(allSkuProductFields(source[i]))!==JSON.stringify(allSkuProductFields(legacy[i])))targetSourceDifferences++;
 assert.equal(targetSourceDifferences,0,'Target source product fields differ');
 const expectedNames=buildAllSkuChineseNameMap(legacy,stores);
 const products=catalog.map(r=>({storeId:r.storeId,sku:r.externalId}));
 const names=await mysqlProductChineseNameResolver()(tenantId,products);
 for(const p of products){const k=`${p.storeId}:${p.sku.trim().toUpperCase()}`;assert.equal(names.get(k),expectedNames.get(k),'Return Chinese name differs');}
 const analysis=await mysqlProductAnalysisProducts()(tenantId);
 assert.equal(analysis.length,catalog.length);
 const productIndex=new Map(analysis.map(p=>[`${p.storeId}:${p.sku}`,p]));
 for(const r of catalog){const p=productIndex.get(`${r.storeId}:${r.externalId}`);assert(p);assert(!('details' in p));assert.equal(p.itemId,itemIdFromSources(r.itemId,typeof r.details==='string'?JSON.parse(r.details):r.details),'Product analysis Item ID differs');assert.equal(p.imageUrl,r.imageUrl);assert.equal(p.productName,r.title);}
 const owners=buildAllSkuOwnerMap(legacy,stores,catalog,members);
 const byId=new Map(catalog.map(r=>[r.id,r]));const loader=mysqlAssignmentLoader();let checkedMembers=0;
 const now=new Date();
 for(const m of members.filter(m=>m.role==='member')){
  const session={tenantId,userId:m.id,role:'member' as const};
  const expectedAssignments=[
   ...storeGrants.filter(r=>r.userId===m.id),
   ...skuGrants.filter(r=>r.userId===m.id).map(r=>({...r,sku:byId.get(r.skuId)?.externalId,skuStoreId:byId.get(r.skuId)?.storeId})),
   ...[...owners.values()].filter(r=>r.ownerUserId===m.id).map(r=>({tenantId,userId:m.id,skuId:r.skuId,sku:r.sku,skuStoreId:r.storeId,validFrom:new Date(0),validUntil:null})),
  ];
  const expected=await resolveCommerceVisibility(session,async()=>expectedAssignments,now);
  const actual=await resolveCommerceVisibility(session,loader,now);
  assert.deepEqual(sorted(actual.storeIds),sorted(expected.storeIds),'Member store visibility differs');
  assert.deepEqual(sorted(actual.skus),sorted(expected.skus),'Member SKU visibility differs');checkedMembers++;
 }
 console.log(JSON.stringify({tenantId,sourceRows:source.length,targetSourceDifferences,products:analysis.length,returnChineseNames:names.size,membersChecked:checkedMembers,visibilityParity:true,productMetadataParity:true,rawDetailsExcluded:true,targetWrites:0}));
}catch(error){console.error(error instanceof Error?error.message:String(error));process.exitCode=1;}
process.exit(process.exitCode??0);
