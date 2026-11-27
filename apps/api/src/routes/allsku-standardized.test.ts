import {expect,it} from 'vitest';
import {allSkuProductFields,buildAllSkuChineseNameMap,buildAllSkuOwnerMap} from './allskuOwnerMapping.js';
const stores=[{id:'s',name:'多壳'}];
it('resolves normalized name and owner columns without reading raw payload',()=>{
 const rows=[{sku:' sku-1 ',storeName:'多壳沃尔玛',productName:'中文产品',ownerName:'张三',payload:{values:{SKU:'wrong',品名:'错误'}}}];
 expect(buildAllSkuChineseNameMap(rows,stores).get('s:SKU-1')).toBe('中文产品');
 expect(buildAllSkuOwnerMap(rows,stores,[{id:'id',storeId:'s',externalId:'SKU-1'}],[{id:'member',displayName:'张三'}]).get('s:SKU-1')?.ownerUserId).toBe('member');
});
it('does not choose between ambiguous normalized Chinese names or grant ambiguous ownership',()=>{
 const rows=[{sku:'SKU',storeName:'多壳',productName:'一',ownerName:'张三'},{sku:'sku',storeName:'多壳',productName:'二',ownerName:'张三'}];
 expect(buildAllSkuChineseNameMap(rows,stores).size).toBe(0);
 expect(buildAllSkuOwnerMap(rows,stores,[{id:'id',storeId:'s',externalId:'SKU'}],[{id:'m',displayName:'张三'}]).size).toBe(0);
});
it('uses normalized target product fields even when archived values disagree',()=>{
 expect(allSkuProductFields({sku:' SKU-1 ',storeName:' 多壳 ',productName:' 中文品名 ',ownerName:' 张三 ',itemId:' 123 ',payload:{values:{SKU:'OLD',品名:'旧品名','Item ID':'999'}}})).toEqual({sku:'SKU-1',storeName:'多壳',productName:'中文品名',ownerName:'张三',itemId:'123'});
});
it('does not revive a removed normalized owner or identifier from an archive',()=>{
 const row={sku:'SKU',storeName:'多壳',productName:null,ownerName:null,itemId:null,payload:{values:{SKU:'SKU',店铺:'多壳',当前负责人:'张三','Item ID':'999'}}};
 expect(allSkuProductFields(row)).toEqual({sku:'SKU',storeName:'多壳',productName:'',ownerName:'',itemId:''});
 expect(buildAllSkuOwnerMap([row],stores,[{id:'id',storeId:'s',externalId:'SKU'}],[{id:'m',displayName:'张三'}]).size).toBe(0);
});
