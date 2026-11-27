import {it,expect} from 'vitest';
import {reviewTargetActions,reviewStatusText,reviewListQuery,filterReviewTargets} from './ProductReviewsPage.js';
import {reviewManagementRow} from './ProductReviewsPage.js';
it('distinguishes first sync from history continuation and hides member controls',()=>{expect(reviewTargetActions({initialStatus:'partial',status:'paused'},'admin')).toContain('继续历史');expect(reviewTargetActions({initialStatus:'pending',status:'idle'},'member')).toBe('');});
it('builds local paginated query without triggering scrape',()=>{expect(reviewListQuery('123',{page:2,rating:'4',q:'test'})).toContain('page=2');expect(reviewListQuery('123',{page:1})).toContain('/api/product-reviews?');});
it('shows blocked failures explicitly',()=>expect(reviewStatusText('failed')).toBe('同步失败'));
it('renders management rows with item controls',()=>{const html=reviewManagementRow({itemId:'123',reviewCount:4,status:'idle',initialStatus:'pending',enabled:0},'admin');expect(html).toContain('首次抓取');expect(html).toContain('查看评论');});
it('filters detail targets by item, sku, or product name',()=>{expect(filterReviewTargets([{itemId:'123',product:{sku:'XMDK-PD01',chineseName:'修车坡道'}}], 'pd01')).toHaveLength(1);expect(filterReviewTargets([{itemId:'123',product:{sku:'XMDK-PD01',chineseName:'修车坡道'}}], '999')).toHaveLength(0);});

it('management buttons submit sync and schedule requests instead of selecting the item',async()=>{
 const {vi}=await import('vitest');const {renderProductReviewsPage}=await import('./ProductReviewsPage.js');
 vi.useFakeTimers();const calls:any[]=[];
 const button=(dataset:any={})=>({dataset,value:'',innerHTML:'',classList:{toggle(){}},addEventListener(){}} as any);
 const initial=button({item:'123',rowAction:'initial'}),schedule=button({item:'123'}),target=button({item:'123'});const nodes=new Map<string,any>();
 const root:any={isConnected:true,querySelector:(s:string)=>{if(['[data-pause]','[data-schedule]'].includes(s))return null;if(!nodes.has(s))nodes.set(s,button());return nodes.get(s);},querySelectorAll:(s:string)=>s==='[data-row-action]'?[initial]:s==='[data-row-schedule]'?[schedule]:s==='[data-item]'?[initial,schedule,target]:s==='[data-targets] [data-item]'?[target]:[]};
 vi.stubGlobal('fetch',async(url:string,options:any)=>{calls.push({url,options});return Response.json({data:url.endsWith('/targets')?[{itemId:'123',initialStatus:'partial',status:'failed',enabled:0}]:{configured:true}});});
 try{await renderProductReviewsPage(root,'admin');await initial.onclick();await schedule.onclick();expect(calls).toEqual(expect.arrayContaining([expect.objectContaining({url:'/api/product-reviews/sync',options:expect.objectContaining({method:'POST',body:JSON.stringify({itemId:'123',mode:'initial',pageBudget:100})})}),expect.objectContaining({url:'/api/product-reviews/targets/123/schedule',options:expect.objectContaining({method:'PUT',body:JSON.stringify({enabled:true})})})]));}finally{vi.clearAllTimers();vi.useRealTimers();vi.unstubAllGlobals();}
});

it('labels the actual reviewed variant separately and escapes product fields',async()=>{
 const {reviewProductMarkup}=await import('./ProductReviewsPage.js');
 const html=reviewProductMarkup({sourceItemId:'123',reviewProduct:{itemId:'456',name:'40 inch <script>',imageUrl:'javascript:alert(1)',features:[{name:'Size',value:'36"'}]}});
 expect(html).toContain('其他变体评论');expect(html).toContain('456');expect(html).toContain('抓取入口');expect(html).toContain('123');expect(html).toContain('36&quot;');expect(html).toContain('&lt;script&gt;');expect(html).not.toContain('javascript:');
 expect(reviewProductMarkup({sourceItemId:'123',reviewProduct:{itemId:null,features:[]}})).toContain('未提供');
 expect(reviewProductMarkup({sourceItemId:'123',reviewProduct:{itemId:'123',features:[]}})).not.toContain('其他变体评论');
});

it('sends the selected variant to the paginated server query',()=>{
 expect(reviewListQuery('123',{page:2,variant:'456'})).toContain('variant=456');
});
