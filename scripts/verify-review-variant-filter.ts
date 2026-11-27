import assert from 'node:assert/strict';
import {createDb} from '../packages/db/src/db.js';
import {ProductReviewRepository,reviewPageFilter} from '../packages/db/src/product-reviews.js';
const {pool}=createDb();
const [rows]:any=await pool.query('SELECT tenant_id,item_id,review_item_id,review_features,rating,title,body,author,published_at FROM product_reviews');
const scopes=new Map<string,{tenant:string;item:string}>();for(const r of rows)scopes.set(JSON.stringify([r.tenant_id,r.item_id]),{tenant:r.tenant_id,item:r.item_id});
const repo=new ProductReviewRepository(pool);let variants=0,conflicts=0;
for(const {tenant,item} of scopes.values()){
 const scoped=rows.filter((r:any)=>r.tenant_id===tenant&&r.item_id===item);
 const all=await repo.listReviews(tenant,item,reviewPageFilter({pageSize:1}));
 assert.equal(all.total,scoped.length);assert.equal(all.variants.reduce((s,v)=>s+v.count,0),scoped.length);
 for(const v of all.variants){
  variants++;if(v.conflictingFeatures)conflicts++;
  const expected=scoped.filter((r:any)=>r.review_item_id===v.itemId);
  const result=await repo.listReviews(tenant,item,reviewPageFilter({pageSize:1,variant:v.itemId||'__missing__'}));
  assert.equal(result.total,expected.length);assert.ok(result.rows.every(r=>r.reviewProduct.itemId===v.itemId));
  assert.equal(result.statistics.count,expected.length);
  assert.ok(Math.abs(result.statistics.averageRating!-expected.reduce((s:number,r:any)=>s+r.rating,0)/expected.length)<0.0001);
  assert.ok(Math.abs(result.statistics.positiveRate!-expected.filter((r:any)=>r.rating>=4).length/expected.length*100)<0.0001);
  assert.ok(Math.abs(result.statistics.negativeRate!-expected.filter((r:any)=>r.rating<=2).length/expected.length*100)<0.0001);
  assert.deepEqual(result.variants,all.variants);
  if(expected.length>1){const second=await repo.listReviews(tenant,item,reviewPageFilter({page:2,pageSize:1,variant:v.itemId||'__missing__'}));assert.deepEqual(second.statistics,result.statistics);assert.deepEqual(second.variants,result.variants);}
 }
}
console.log(JSON.stringify({reviews:rows.length,scopes:scopes.size,variants,conflicts,checks:'all filtered aggregates and pagination verified'}));process.exit(0);
