/** Aggregate at the database boundary; never transfer every receiving log to the dashboard. */
export async function shipmentReceiptTotals(pool:any,tenantId:string,shipmentIds:string[],storeId?:string){
 if(!shipmentIds.length)return [];
 const ids=[...new Set(shipmentIds)];
 const [rows]=await pool.query(`SELECT store_id AS storeId,UPPER(TRIM(shipment_id)) AS shipmentId,UPPER(TRIM(sku)) AS sku,SUM(changed_units) AS changedUnits FROM wfs_inventory_logs FORCE INDEX(wfs_inventory_logs_receipt_cover_idx) WHERE tenant_id=? AND shipment_id IN (${ids.map(()=>'?').join(',')})${storeId?' AND store_id=?':''} AND (LOWER(reason_description) LIKE 'received%' OR LOWER(reason_description) LIKE 'receiving correction%') GROUP BY store_id,UPPER(TRIM(shipment_id)),UPPER(TRIM(sku))`,[tenantId,...ids,...storeId?[storeId]:[]]);
 return (rows as any[]).map(r=>({...r,changedUnits:Number(r.changedUnits??0),reasonDescription:'Received'}));
}
