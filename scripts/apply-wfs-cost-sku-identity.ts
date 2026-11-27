import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createDb} from '../packages/db/src/db.js';
if(new URL(process.env.MYSQL_URL!).hostname.toLowerCase()!=='doke.synology.me')throw Error('Expected Doke');
const {pool}=createDb();
const [keys]:any=await pool.query("SHOW INDEX FROM wfs_costs WHERE Key_name='PRIMARY'");
if(keys.map((r:any)=>r.Column_name).join(',')==='tenant_id,sku'){console.log('SKU identity already applied');process.exit(0);}
assert.equal(keys.map((r:any)=>r.Column_name).join(','),'tenant_id,period,sku');
const [before]:any=await pool.query('SELECT COUNT(*) records,COUNT(DISTINCT tenant_id,UPPER(TRIM(sku))) uniqueSkus FROM wfs_costs');
const [empty]:any=await pool.query("SELECT COUNT(*) n FROM wfs_costs WHERE TRIM(sku)=''");assert.equal(empty[0].n,0);
const sql=await readFile('packages/db/migrations/0066_wfs_cost_sku_identity.sql','utf8');
for(const statement of sql.split(';').map(x=>x.trim()).filter(Boolean))await pool.query(statement);
const [after]:any=await pool.query('SELECT COUNT(*) records,COUNT(DISTINCT tenant_id,sku) uniqueSkus FROM wfs_costs');
const [backup]:any=await pool.query('SELECT COUNT(*) records FROM wfs_costs_before_sku_identity');
assert.equal(after[0].records,before[0].uniqueSkus);assert.equal(backup[0].records,before[0].records);
const [mismatches]:any=await pool.query(`SELECT COUNT(*) n FROM wfs_costs c JOIN (
 SELECT tenant_id,normalized_sku,purchase_cost FROM (
  SELECT tenant_id,UPPER(TRIM(sku)) normalized_sku,purchase_cost,
   ROW_NUMBER() OVER(PARTITION BY tenant_id,UPPER(TRIM(sku)) ORDER BY updated_at DESC,period DESC,sku) seq
  FROM wfs_costs_before_sku_identity
 ) ranked WHERE seq=1
) old ON old.tenant_id=c.tenant_id AND old.normalized_sku=c.sku WHERE NOT (old.purchase_cost <=> c.purchase_cost)`);
assert.equal(mismatches[0].n,0);
const result={appliedAt:new Date().toISOString(),before:before[0],after:after[0],backup:backup[0],purchaseMismatches:mismatches[0].n};
await mkdir('artifacts/wfs-cost-import-validation',{recursive:true});await writeFile('artifacts/wfs-cost-import-validation/migration.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result));process.exit(0);
