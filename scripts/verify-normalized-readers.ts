import {createDb} from '../packages/db/src/db.js';
import {mysqlInventorySource} from '../apps/api/src/routes/inventory.js';
import {mysqlItemsSource} from '../apps/api/src/routes/items.js';
import {mysqlCommerceSource} from '../apps/api/src/routes/commerce-source.js';
const {pool}=createDb();
const inventory=await mysqlInventorySource()('default');console.log(JSON.stringify({inventory:inventory.length,healthWithAge:inventory.filter(r=>r.ageDistribution).length,nsb:inventory.filter(r=>r.sku.toUpperCase()==='XMDK-NSB-001').map(r=>({storeId:r.storeId,quantity:r.quantity,reserved:r.reservedQuantity,first:r.firstInStockDate}))}));
const items=await mysqlItemsSource()('default');console.log(JSON.stringify({items:items.length,withReport:items.filter(r=>r.reportFields).length}));
const [sample]:any=await pool.query('SELECT order_id FROM order_shipping_details WHERE tenant_id=? AND store_id=? LIMIT 1',['default','10001133528']);
if(sample.length){const order=await mysqlCommerceSource().getOrderLines!('default',sample[0].order_id);console.log(JSON.stringify({orderLines:order.length,withExtensions:order.filter((r:any)=>r.extensions).length}));}
process.exit(0);
