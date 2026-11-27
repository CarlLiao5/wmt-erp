/** Fill missing catalog metadata only; barcode identifiers never imply an Item ID. */
export function catalogMissingFields(current:{itemId?:string|null;imageUrl?:string|null;title?:string|null}, report:Record<string,string>={}) {
  const fields:Record<string,string>={};
  const aliases={itemId:['Item ID','Item Id','Product ID','Product Id'],imageUrl:['Primary Image URL','Primary Image Url'],title:['Product Name','Product name']};
  for(const [field,names] of Object.entries(aliases)){
    if(current[field as keyof typeof current]?.trim())continue;
    const value=names.map(key=>report[key]?.trim()).find(Boolean);
    if(value && (field!=='imageUrl'||/^https?:\/\//i.test(value)))fields[field]=value;
  }
  return fields;
}
