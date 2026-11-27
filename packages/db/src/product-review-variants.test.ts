import {expect,it} from 'vitest';
import {groupReviewVariants} from './product-review-variants.js';
it('groups by actual item and detects conflicting nonempty specs without arbitrary labels',()=>{
 const variants=groupReviewVariants([
 {itemId:'456',name:'same name',imageUrl:'https://example.com/a',features:[{name:'Size',value:'36"'},{name:'Color',value:'Red'}],count:2},
 {itemId:'456',name:'same name',features:[{name:'Color',value:'Red'},{name:'Size',value:'36"'}],count:3},
 {itemId:'456',features:JSON.stringify([{name:'Size',value:'40"'}]),count:1},
 {itemId:'789',name:'same name',features:[],count:4},
 {itemId:null,features:[],count:1},
 ]);
 expect(variants).toHaveLength(3);expect(variants[0]).toMatchObject({itemId:'456',count:6,conflictingFeatures:true,features:[],imageUrl:'https://example.com/a'});
 expect(variants[0].featureSets).toHaveLength(2);expect(variants[0].featureSets[0].count).toBe(5);
 expect(variants[1].itemId).toBe('789');expect(variants[2].itemId).toBeNull();
});
it('does not treat absent specifications as a conflicting size',()=>{
 const [variant]=groupReviewVariants([{itemId:'123',features:[{name:'Size',value:'36"'}],count:2},{itemId:'123',features:null,count:1}]);
 expect(variant).toMatchObject({conflictingFeatures:false,count:3,features:[{name:'Size',value:'36"'}]});
});
