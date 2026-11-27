import {date,idFor,text,type RecordRow} from './common.js';

export function trackingCarrier(value:unknown):string|null {
 if(value && typeof value==='object') {
  const carrier=value as Record<string,unknown>;
  return text(carrier.carrier)||text(carrier.otherCarrier);
 }
 return text(value);
}

export function trackingIdentity(row:RecordRow):string {
 const key=[text(row.tenant_id),text(row.store_id),text(row.order_number),text(row.line_number),'tracking-v2',text(row.tracking_number),text(row.carrier)];
 // A numbered parcel remains the same when its URL or shipping timestamp changes.
 return row.tracking_number && text(row.tracking_number)
  ? idFor(...key)
  : idFor(...key,date(row.shipped_at)?.toISOString()??null,text(row.tracking_url));
}

export function mergeTrackingRows(rows:RecordRow[]):RecordRow {
 if(!rows.length)throw Error('Cannot merge empty tracking group');
 const id=trackingIdentity(rows[0]);
 if(rows.some(r=>trackingIdentity(r)!==id))throw Error('Cannot merge different tracking identities');
 const ordered=[...rows].sort((a,b)=>(date(a.captured_at)?.getTime()??0)-(date(b.captured_at)?.getTime()??0)||String(a.id).localeCompare(String(b.id)));
 const merged:RecordRow={};
 for(const row of ordered)for(const [key,value] of Object.entries(row))if(value!=null&&value!=='')merged[key]=value;
 const newest=ordered[ordered.length-1];
 for(const key of Object.keys(newest))if(!(key in merged))merged[key]=null;
 return {...merged,id,tracking_number:text(merged.tracking_number),carrier:text(merged.carrier)};
}
