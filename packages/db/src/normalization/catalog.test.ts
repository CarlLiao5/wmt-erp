import {expect,it} from 'vitest';
import {catalogMissingFields} from './catalog.js';
it('fills explicit identifiers and image from a report without converting GTIN to Item ID',()=>{
 expect(catalogMissingFields({itemId:null,imageUrl:null,title:null},{'Item Id':'123','Primary Image Url':'https://example.test/p.jpg','Product Name':'Product',GTIN:'00012345678901'})).toEqual({itemId:'123',imageUrl:'https://example.test/p.jpg',title:'Product'});
 expect(catalogMissingFields({itemId:null},{GTIN:'00012345678901',UPC:'123456789012'})).toEqual({});
});
it('preserves existing metadata and treats blank reports as no update',()=>{
 expect(catalogMissingFields({itemId:'known',imageUrl:'https://example.test/old',title:'Name'},{'Item ID':'other','Primary Image URL':'https://example.test/new'})).toEqual({});
 expect(catalogMissingFields({itemId:' '},{'Item ID':' '})).toEqual({});
});
