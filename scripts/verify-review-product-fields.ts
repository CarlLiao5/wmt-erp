import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createDb} from '../packages/db/src/db.js';
import {ProductReviewRepository,reviewPageFilter} from '../packages/db/src/product-reviews.js';
import {normalizeReviewProduct} from '../packages/db/src/product-review-product.js';
const {pool}=createDb();
const [all]:any=await pool.query('SELECT * FROM product_reviews');
for(const row of all){const p=normalizeReviewProduct(row.raw_payload);assert.equal(row.review_item_id,p.itemId);assert.equal(row.review_item_name,p.name);assert.equal(row.review_item_image_url,p.imageUrl);assert.deepEqual(typeof row.review_features==='string'?JSON.parse(row.review_features):row.review_features,p.features);}
const repo=new ProductReviewRepository(pool);
const scope=all.find((r:any)=>r.item_id!==r.review_item_id&&r.review_item_id);
const filter=reviewPageFilter({variant:scope.review_item_id,pageSize:1});
const result=await repo.listReviews(scope.tenant_id,scope.item_id,filter);
assert.ok(result.total>0);assert.ok(result.rows.every(r=>r.reviewProduct.itemId===scope.review_item_id));assert.ok(result.variants.length>0);
const c=await pool.getConnection();await c.beginTransaction();
try{
 const txRepo=new ProductReviewRepository({getConnection:async()=>({query:c.query.bind(c),beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},release(){}})} as any);
 const tenant='verify-review-fields',itemId='999999999999999999',key=randomUUID();
 for(const mode of ['initial','incremental'] as const){
  const pageId=randomUUID();
  await c.query("INSERT INTO product_review_pages(id,tenant_id,item_id,run_id,mode,source_url,url_hash,status,updated_at) VALUES(?,?,?,?,?,?,?,'submitted',NOW(3))",[pageId,tenant,itemId,randomUUID(),mode,'https://example.com',randomUUID()]);
  await txRepo.upsertPage({tenantId:tenant,itemId,pageId,sourceUrl:'https://example.com',reviews:[{reviewKey:key,rating:5,title:null,body:'test',publishedAt:null,author:null,verifiedPurchase:null,sourceUrl:'https://example.com',rawPayload:{itemId:'456',itemName:mode,features:[{name:'Size',value:'36"'}]}}],nextPageUrl:null,contentHash:'test',mode});
  const [rows]:any=await c.query('SELECT * FROM product_reviews WHERE tenant_id=? AND item_id=?',[tenant,itemId]);assert.equal(rows.length,1);assert.equal(rows[0].review_item_id,'456');assert.equal(rows[0].review_item_name,mode);
 }
}finally{await c.rollback();c.release();}
console.log(JSON.stringify({verifiedHistorical:all.length,filteredTotal:result.total,variants:result.variants.length,initialAndIncrementalWrites:'passed (rolled back)'}));process.exit(0);
