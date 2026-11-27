import { describe, it, expect } from 'vitest';
import { normalizeReviewItemId, nextProductReviewRunAt, reviewPageFilter, reviewRunKey, scheduleUpdateValues } from './product-reviews.js';
describe('review contracts', () => {
 it('accepts numeric Item IDs and rejects URL injection', () => { expect(normalizeReviewItemId(' 1201369196 ')).toBe('1201369196'); expect(() => normalizeReviewItemId('../abc')).toThrow(); });
 it('advances exactly 96 hours across local DST', () => { expect(nextProductReviewRunAt(new Date('2026-11-01T00:00:00Z')).toISOString()).toBe('2026-11-05T00:00:00.000Z'); });
 it('bounds pagination and filters exact rating', () => { expect(reviewPageFilter({page:'2',pageSize:'999',rating:'3'})).toMatchObject({page:2,pageSize:100,rating:3}); expect(() => reviewPageFilter({rating:'6'})).toThrow(); });
 it('separates initial and incremental idempotency keys', () => { expect(reviewRunKey('t','123','initial','slot')).not.toBe(reviewRunKey('t','123','incremental','slot')); });
 it('clears a prior pause when enabling a schedule and retains it when disabled',()=>{expect(scheduleUpdateValues(true).stopRequested).toBe(0);expect(scheduleUpdateValues(false).stopRequested).toBe(1);});
});

it('projects review variant fields from normalized columns without substituting the crawl item', async () => {
 const { ProductReviewRepository } = await import('./product-reviews.js');
 const pool:any={query:async(sql:string)=>sql.includes('COUNT(*)')?[[{total:2}]]:[[{reviewItemId:'6560518579',reviewItemName:'40 inch',reviewFeatures:[{name:'Size',value:'36"'}],reviewItemImageUrl:'https://i5.walmartimages.com/a.jpg'},{}]]};
 const result=await new ProductReviewRepository(pool).listReviews('tenant','123',reviewPageFilter({}));
 expect(result.rows[0]).toMatchObject({sourceItemId:'123',reviewProduct:{itemId:'6560518579',name:'40 inch',features:[{name:'Size',value:'36"'}]}});
 expect(result.rows[1]).toMatchObject({reviewProduct:{itemId:null,name:null,features:[]}});
 expect(result.rows[0]).not.toHaveProperty('rawPayload');
});

it('normalizes product fields without inferring a variant from its name',async()=>{
 const {normalizeReviewProduct}=await import('./product-review-product.js');
 expect(normalizeReviewProduct({itemId:'6560518579',itemName:'40 inch',itemImageUrl:'https://example.com/a',features:[{name:'Size',value:'36"'}]})).toEqual({itemId:'6560518579',name:'40 inch',imageUrl:'https://example.com/a',features:[{name:'Size',value:'36"'}]});
 expect(normalizeReviewProduct({itemId:null,features:null})).toEqual({itemId:null,name:null,imageUrl:null,features:[]});
});
it('validates the variant filter',()=>{
 expect(reviewPageFilter({variant:'456'})).toMatchObject({variant:'456'});
 expect(reviewPageFilter({variant:'__missing__'})).toMatchObject({variant:'__missing__'});
 expect(()=>reviewPageFilter({variant:'../invalid'})).toThrow();
});
it('applies tenant, crawl item and variant to both count and page queries',async()=>{
 const {ProductReviewRepository}=await import('./product-reviews.js');const calls:any[]=[];
 const repo=new ProductReviewRepository({query:async(sql:string,values:any[])=>{calls.push({sql,values});return sql.includes('COUNT(*) AS total')?[[{total:0}]]:[[]];}} as any);
 await repo.listReviews('tenant','123',reviewPageFilter({variant:'456',page:2}));
 for(const call of calls.filter(c=>!c.sql.includes('GROUP BY'))){expect(call.sql).toContain('review_item_id=?');expect(call.values.slice(0,3)).toEqual(['tenant','123','456']);}
});
it.each(['initial','incremental'] as const)('writes normalized variant fields during %s sync',async(mode)=>{
 const {ProductReviewRepository}=await import('./product-reviews.js');const calls:any[]=[];
 const c:any={beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},release(){},query:async(sql:string,values:any[])=>{calls.push({sql,values});return sql.startsWith('SELECT status')?[[{status:'submitted'}]]:[[]];}};
 const repo=new ProductReviewRepository({getConnection:async()=>c} as any);
 await repo.upsertPage({tenantId:'t',itemId:'123',pageId:'p',sourceUrl:'https://example.com',reviews:[{reviewKey:'r',rating:5,title:null,body:'ok',publishedAt:null,author:null,verifiedPurchase:null,sourceUrl:'https://example.com',rawPayload:{itemId:'456',itemName:'40 inch',features:[{name:'Size',value:'36"'}]}}],nextPageUrl:null,contentHash:'h',mode});
 const insert=calls.find(c=>c.sql.startsWith('INSERT INTO product_reviews '));expect(insert.sql).toContain('review_item_id');expect(insert.sql).toContain('review_features');expect(insert.values).toContain('456');expect(insert.values).toContain('40 inch');expect(insert.values).toContain(JSON.stringify([{name:'Size',value:'36"'}]));
});

it('returns filtered statistics over all matching rows while keeping all variant choices',async()=>{
 const {ProductReviewRepository}=await import('./product-reviews.js');const calls:any[]=[];
 const repo=new ProductReviewRepository({query:async(sql:string,values:any[])=>{calls.push({sql,values});return sql.includes('COUNT(*) AS total')?[[{total:'50',averageRating:'3.5',positiveCount:'30',negativeCount:'10'}]]:sql.includes('GROUP BY')?[[{itemId:'456',features:[],count:50},{itemId:'789',features:[],count:20}]]:[[]];}} as any);
 const result=await repo.listReviews('tenant','123',reviewPageFilter({variant:'456',rating:4,q:'quality',from:'2026-01-01',to:'2026-12-31',page:2}));
 expect(result.statistics).toEqual({count:50,averageRating:3.5,positiveCount:30,negativeCount:10,positiveRate:60,negativeRate:20});
 const aggregate=calls.find(c=>c.sql.includes('AVG(rating)'));expect(aggregate.values).toEqual(['tenant','123','456',4,'%quality%','%quality%','%quality%','2026-01-01','2026-12-31']);expect(aggregate.sql).not.toContain('LIMIT');
 expect(result.variants).toHaveLength(2);expect(calls.find(c=>c.sql.includes('GROUP BY')).values).toEqual(['tenant','123']);
});

it('keeps zero-result statistics null and filters missing variants on the server',async()=>{
 const {ProductReviewRepository}=await import('./product-reviews.js');const queries:string[]=[];
 const repo=new ProductReviewRepository({query:async(sql:string)=>{queries.push(sql);return sql.includes('COUNT(*) AS total')?[[{total:0,averageRating:null,positiveCount:null,negativeCount:null}]]:[[]];}} as any);
 const result=await repo.listReviews('t','123',reviewPageFilter({variant:'__missing__'}));
 expect(result.statistics).toEqual({count:0,averageRating:null,positiveCount:0,negativeCount:0,positiveRate:null,negativeRate:null});
 expect(queries[0]).toContain('review_item_id IS NULL');
});
