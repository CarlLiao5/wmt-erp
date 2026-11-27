import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createDb} from '../packages/db/src/db.js';
import {saveWfsCosts} from '../apps/api/src/routes/wfs-costs.js';
if(new URL(process.env.MYSQL_URL!).hostname.toLowerCase()!=='doke.synology.me')throw Error('Expected Doke');
const {pool}=createDb();
const migration=await readFile('packages/db/migrations/0066_wfs_cost_sku_identity.sql','utf8');
if(process.argv.includes('--migration-fixture')){
 const table='test_cost_import_'+randomUUID().slice(0,8);
 try{
  await pool.query('CREATE TABLE '+table+' LIKE wfs_costs');
  await pool.query('INSERT INTO '+table+' (tenant_id,period,sku,upc,item_id,product_name,purchase_cost,freight_cost,updated_at) VALUES ?',[ [
   ['t1','old',' abc ','001','123','原名称','20','5','2026-01-01 00:00:00'],
   ['t1','new','ABC','','','','0',null,'2026-02-01 00:00:00'],
   ['t2','old','ABC','999','456','其他租户','99','8','2026-01-01 00:00:00'],
  ] ]);
  for(const statement of migration.replaceAll('wfs_costs',table).split(';').map(x=>x.trim()).filter(Boolean))await pool.query(statement);
  const [rows]:any=await pool.query('SELECT * FROM '+table+' ORDER BY tenant_id');
  assert.equal(rows.length,2);
  assert.equal(rows[0].sku,'ABC');assert.equal(rows[0].upc,'001');assert.equal(rows[0].product_name,'原名称');
  assert.equal(Number(rows[0].purchase_cost),0);assert.equal(Number(rows[0].freight_cost),5);assert.equal(Number(rows[1].purchase_cost),99);
  const [backup]:any=await pool.query('SELECT COUNT(*) n FROM '+table+'_before_sku_identity');assert.equal(backup[0].n,3);
  console.log('Migration fixture passed: normalized SKU, backup, latest zero, blank metadata/freight, tenant isolation');
 }finally{for(const suffix of ['','_before_sku_identity','_sku_identity'])await pool.query('DROP TABLE IF EXISTS '+table+suffix);}
 process.exit(0);
}
const tenant=randomUUID(),otherTenant=randomUUID();
const row={sku:'IMPORT-TEST',upc:'00123',itemId:'123',productName:'验证商品',purchaseCost:'40',freightCost:'8',manualLastMile:'5',manualCommissionPercent:'15'};
try{
 assert.deepEqual(await saveWfsCosts(tenant,'工作表一',[row],true),{inserted:1,updated:0});
 await saveWfsCosts(otherTenant,'工作表二',[{...row,purchaseCost:'99'}],true);
 const blank={sku:row.sku,upc:'',itemId:'',productName:'',purchaseCost:null,freightCost:null};
 assert.deepEqual(await saveWfsCosts(tenant,'换工作表名',[blank],true),{inserted:0,updated:1});
 let [rows]:any=await pool.query('SELECT c.*,f.last_mile,f.commission_percent FROM wfs_costs c LEFT JOIN wfs_cost_fee_overrides f ON f.tenant_id=c.tenant_id AND f.sku=c.sku WHERE c.tenant_id=?',[tenant]);
 assert.equal(rows.length,1);assert.equal(Number(rows[0].purchase_cost),40);assert.equal(Number(rows[0].freight_cost),8);assert.equal(rows[0].upc,'00123');assert.equal(Number(rows[0].last_mile),5);assert.equal(Number(rows[0].commission_percent),15);
 await saveWfsCosts(tenant,'第三次',[{...blank,purchaseCost:'0',freightCost:'0',manualLastMile:'0',manualCommissionPercent:'0'}],true);
 [rows]=await pool.query('SELECT c.*,f.last_mile,f.commission_percent FROM wfs_costs c LEFT JOIN wfs_cost_fee_overrides f ON f.tenant_id=c.tenant_id AND f.sku=c.sku WHERE c.tenant_id=?',[tenant]);
 assert.equal(rows.length,1);for(const k of ['purchase_cost','freight_cost','last_mile','commission_percent'])assert.equal(Number(rows[0][k]),0);
 await assert.rejects(()=>saveWfsCosts(tenant,'回滚测试',[{...row,purchaseCost:'999'}, {...blank,sku:'NEW-MISSING-COST'}],true),/新 SKU/);
 [rows]=await pool.query('SELECT tenant_id,purchase_cost FROM wfs_costs WHERE tenant_id IN (?,?) ORDER BY tenant_id',[tenant,otherTenant]);
 assert.equal(rows.length,2);assert.equal(Number(rows.find((r:any)=>r.tenant_id===tenant).purchase_cost),0);assert.equal(Number(rows.find((r:any)=>r.tenant_id===otherTenant).purchase_cost),99);
 console.log('Live Doke import passed: changed sheet, repeated import, blanks retained, four zero overrides, tenant isolation, batch rollback');
}finally{await pool.query('DELETE FROM wfs_cost_fee_overrides WHERE tenant_id IN (?,?)',[tenant,otherTenant]);await pool.query('DELETE FROM wfs_costs WHERE tenant_id IN (?,?)',[tenant,otherTenant]);}
process.exit(0);
