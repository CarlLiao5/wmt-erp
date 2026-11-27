import {createDb} from '../packages/db/src/db.js';
const {pool}=createDb();
const [runs]=await pool.query("SELECT store_id,report_month,status,row_count,difference_count,request_id,error_message FROM wfs_inventory_recon_runs ORDER BY created_at DESC LIMIT 5");
const [plans]=await pool.query("SELECT store_id,next_run_at,enabled FROM sync_plans WHERE resource='inventory-recon' ORDER BY store_id");
console.log(JSON.stringify({runs,plans},null,2));process.exit(0);
