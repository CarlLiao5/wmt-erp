import {expect,it} from 'vitest';
import {filterReviewVariants,reviewVariantLabel,reviewVariantOptionsMarkup,reviewLocalStatisticsMarkup} from './ReviewVariantPicker.js';
const variants=[{itemId:'456',name:'Creeper <seat>',imageUrl:'javascript:alert(1)',features:[],featureSets:[{features:[{name:'Size',value:'36"'}],count:5},{features:[{name:'Size',value:'40"'}],count:2}],conflictingFeatures:true,count:7}];
it('searches item, raw product name and every conflicting specification',()=>{
 for(const q of ['456','seat','36"','40"'])expect(filterReviewVariants(variants,q)).toHaveLength(1);
 expect(filterReviewVariants(variants,'not-found')).toHaveLength(0);
});
it('labels conflicts and exposes all alternatives without picking an arbitrary size',()=>{
 expect(reviewVariantLabel(variants[0])).toBe('规格信息不一致 · Item 456');
 const html=reviewVariantOptionsMarkup(variants,'456');expect(html).toContain('查看规格记录');expect(html).toContain('36&quot;');expect(html).toContain('40&quot;');expect(html).not.toContain('javascript:');expect(html).toContain('&lt;seat&gt;');expect(html).toContain('aria-pressed="true"');
 expect(reviewVariantLabel({itemId:null,count:1})).toBe('变体未提供');
});
it('labels local metrics and handles empty statistics without displaying fake zero ratings',()=>{
 const html=reviewLocalStatisticsMarkup({count:50,averageRating:3.5,positiveRate:60,negativeRate:20});expect(html).toContain('3.50');expect(html).toContain('60.0%');expect(html).toContain('4–5 星');expect(html).toContain('本地已抓取评论');
 expect(reviewLocalStatisticsMarkup({count:0,averageRating:null,positiveRate:null,negativeRate:null})).not.toContain('0.00');
});
