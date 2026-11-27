import fs from 'node:fs';
import mysql from '../packages/db/node_modules/mysql2/promise.js';
import { normalizeReconTransactions } from '../packages/walmart-client/src/adapters/storageFees.js';
const pool = mysql.createPool({ uri: process.env.MYSQL_URL!, connectionLimit: 2, charset: 'utf8mb4', timezone: 'Z' });
try {
  const [database] = await pool.query('SELECT DATABASE() AS name') as any;
  if (database[0].name !== 'walmart' || !/doke/i.test(new URL(process.env.MYSQL_URL!).hostname)) throw new Error('This backfill must run on doke');
  const [columns] = await pool.query('SHOW COLUMNS FROM recon_transactions') as any;
  if (!columns.some((x: any) => x.Field === 'customer_order_id')) await pool.query(fs.readFileSync('packages/db/migrations/0044_return_payment_reconciliation.sql','utf8'));
  let cursor = ''; let pages = 0; let linked = 0;
  while (true) {
    const [batch] = await pool.query(`SELECT id,tenant_id AS tenantId,store_id AS storeId,source_id AS sourceId,payload,received_at AS receivedAt FROM payment_reports WHERE id > ? AND source_id LIKE 'recon-report:%' ORDER BY id LIMIT 10`, [cursor]) as any;
    if (!batch.length) break;
    for (const page of batch) {
      const match = page.sourceId.match(/^recon-report:(\d{8}):(\d+)$/);
      if (!match) continue;
      const payload = typeof page.payload === 'string' ? JSON.parse(page.payload) : page.payload;
      const rows = normalizeReconTransactions(payload, { ...page, sourceId: `recon-report:${match[1]}`, reportDate: match[1], rowOffset: Number(match[2]) }).filter(r => r.transactionType?.toUpperCase() === 'REFUND' || /RETURN|REIMBURSEMENT|COMPENSATION/i.test(r.description));
      if (!rows.length) { pages++; continue; }
      // Only enrich existing rows; no financial records are inserted or deleted.
      const conn = await pool.getConnection();
      try {
        await conn.query('CREATE TEMPORARY TABLE IF NOT EXISTS return_payment_links (id varchar(64) PRIMARY KEY,customer_order_id varchar(191),purchase_order_id varchar(191),sku varchar(191),amount_type varchar(191)) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
        await conn.query('DELETE FROM return_payment_links');
        for (let i=0;i<rows.length;i+=250) await conn.query('INSERT INTO return_payment_links VALUES ?', [rows.slice(i,i+250).map(r => [r.id,r.customerOrderId,r.purchaseOrderId,r.sku,r.amountType])]);
        const [result] = await conn.query(`UPDATE return_payment_links l STRAIGHT_JOIN recon_transactions r FORCE INDEX (PRIMARY) ON r.id=l.id SET r.customer_order_id=l.customer_order_id,r.purchase_order_id=l.purchase_order_id,r.sku=l.sku,r.amount_type=l.amount_type WHERE r.tenant_id=? AND r.store_id=? AND r.source_id=?`, [page.tenantId,page.storeId,`recon-report:${match[1]}`]) as any;
        linked += result.affectedRows; pages++;
      } finally { conn.release(); }
    }
    cursor = batch[batch.length-1].id;
    if (pages % 10 === 0) console.log(JSON.stringify({pages,linked}));
  }
  console.log(JSON.stringify({complete:true,pages,linked}));
} finally { await pool.end(); }
