import {createDb} from '../packages/db/src/db.js';
import {normalizeReconTransactions} from '../packages/walmart-client/src/adapters/storageFees.js';
const apply=process.argv.includes('--apply');
if(new URL(process.env.MYSQL_URL!).hostname.toLowerCase()!=='doke.synology.me')throw Error('Doke required');
const {pool}=createDb();
const connection=await pool.getConnection();
try{
 if(apply){
  const [columns]:any=await connection.query('SHOW COLUMNS FROM recon_transactions');
  for(const [name,type]of [['purchase_order_line','varchar(32)'],['ship_qty','decimal(19,4)'],['bill_transaction_key','varchar(191)']])if(!columns.some((c:any)=>c.Field===name))await connection.query(`ALTER TABLE recon_transactions ADD COLUMN ${name} ${type} NULL`);
  await connection.query('CREATE TEMPORARY TABLE recon_profit_fields (id varchar(64) PRIMARY KEY, purchase_order_line varchar(32), ship_qty decimal(19,4), bill_transaction_key varchar(191), sku varchar(191), purchase_order_id varchar(191), customer_order_id varchar(191), amount_type varchar(191))');
 }
 let cursor='',pages=0,updated=0;
 while(true){
  const [batch]:any=await connection.query("SELECT id,tenant_id,store_id,source_id,payload,received_at FROM payment_reports WHERE id>? AND source_id LIKE 'recon-report:%' ORDER BY id LIMIT 20",[cursor]);
  if(!batch.length)break;
  for(const p of batch){
   cursor=p.id;const match=/^(recon-report:\d{8})(?::(\d+))?$/.exec(p.source_id);if(!match)continue;
   const canonical=match[1],offset=Number(match[2]??0);
   const records=normalizeReconTransactions(p.payload,{tenantId:p.tenant_id,storeId:p.store_id,reportDate:canonical.slice(13),sourceId:canonical,receivedAt:p.received_at,rowOffset:offset});
   if(apply&&records.length){
    for(let i=0;i<records.length;i+=250)await connection.query('INSERT INTO recon_profit_fields VALUES ? ON DUPLICATE KEY UPDATE purchase_order_line=VALUES(purchase_order_line),ship_qty=VALUES(ship_qty),bill_transaction_key=VALUES(bill_transaction_key),sku=VALUES(sku),purchase_order_id=VALUES(purchase_order_id),customer_order_id=VALUES(customer_order_id),amount_type=VALUES(amount_type)',[records.slice(i,i+250).map(r=>[r.id,r.purchaseOrderLine,r.shipQty,r.billTransactionKey,r.sku,r.purchaseOrderId,r.customerOrderId,r.amountType])]);

   }
   pages++;
  }
  console.log(JSON.stringify({apply,pages,updated}));
 }
 if(apply){console.log('Applying staged normalized fields');const [result]:any=await connection.query('UPDATE recon_transactions r FORCE INDEX (PRIMARY) STRAIGHT_JOIN recon_profit_fields f ON r.id=f.id SET r.purchase_order_line=f.purchase_order_line,r.ship_qty=f.ship_qty,r.bill_transaction_key=f.bill_transaction_key,r.sku=f.sku,r.purchase_order_id=f.purchase_order_id,r.customer_order_id=f.customer_order_id,r.amount_type=f.amount_type');updated=result.affectedRows;}
 console.log('Completed',JSON.stringify({pages,updated}));
}finally{connection.release();process.exitCode=0;}

process.exit(0);
