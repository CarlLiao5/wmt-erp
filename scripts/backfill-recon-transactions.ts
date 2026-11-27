import crypto from 'node:crypto';
import fs from 'node:fs';
import mysql from '../packages/db/node_modules/mysql2/promise.js';
import { normalizeReconTransactions, reconNextOffset, reconTransactionRows } from '../packages/walmart-client/src/adapters/storageFees.js';

const PAGE_SIZE = 1000;
type ArchivePage = { id: string; tenantId: string; storeId: string; sourceId: string; payload: unknown; receivedAt: Date };
type ParsedPage = ArchivePage & { reportDate: string; offset: number };
type ReportPlan = { tenantId: string; storeId: string; reportDate: string; sourceId: string; pages: ParsedPage[]; transactions: ReturnType<typeof normalizeReconTransactions>; complete: boolean; pageSourceIds: string[] };

function envFileValue(path: string, key: string): string | undefined {
  if (!fs.existsSync(path)) return undefined;
  const line = fs.readFileSync(path, 'utf8').split(/\r?\n/).find((entry) => entry.trim().startsWith(`${key}=`));
  if (!line) return undefined;
  const value = line.slice(line.indexOf('=') + 1).trim();
  return value.replace(/^(['"])(.*)\1$/, '$2');
}

function reportIdentity(sourceId: string): { reportDate: string; offset: number } | null {
  const match = sourceId.match(/^recon-report:(\d{8}):(\d+)$/);
  return match ? { reportDate: match[1], offset: Number(match[2]) } : null;
}

export function planReconBackfill(pages: ArchivePage[]): ReportPlan[] {
  const grouped = new Map<string, ParsedPage[]>();
  for (const page of pages) {
    const identity = reportIdentity(page.sourceId);
    if (!identity) continue;
    const key = `${page.tenantId}\u001f${page.storeId}\u001f${identity.reportDate}`;
    const list = grouped.get(key) ?? [];
    list.push({ ...page, ...identity });
    grouped.set(key, list);
  }

  return [...grouped.values()].map((group) => {
    const sorted = group.sort((left, right) => left.offset - right.offset);
    const first = sorted[0]!;
    const reportSourceId = `recon-report:${first.reportDate}`;
    let complete = first.offset === 0;
    for (let index = 0; index < sorted.length; index += 1) {
      const page = sorted[index]!;
      const expectedNext = reconNextOffset(page.payload, page.offset, PAGE_SIZE);
      const next = sorted[index + 1];
      if (expectedNext === undefined) {
        if (next) complete = false;
      } else if (!next || next.offset !== expectedNext) complete = false;
    }
    const transactions = sorted.flatMap((page) => normalizeReconTransactions(page.payload, {
      tenantId: page.tenantId,
      storeId: page.storeId,
      reportDate: page.reportDate,
      sourceId: reportSourceId,
      receivedAt: page.receivedAt,
      rowOffset: page.offset,
    }));
    return {
      tenantId: first.tenantId,
      storeId: first.storeId,
      reportDate: first.reportDate,
      sourceId: reportSourceId,
      pages: sorted,
      transactions,
      complete,
      pageSourceIds: sorted.map((page) => page.sourceId),
    };
  });
}

function transactionId(row: Record<string, unknown>): string {
  return crypto.createHash('sha256').update(`${row.tenantId}:${row.storeId}:${row.sourceId}:${row.transactionKey}`).digest('hex').slice(0, 64);
}

async function run() {
  const apply = process.argv.includes('--apply');
  const envPath = process.argv.find((arg) => arg.startsWith('--env-file='))?.slice('--env-file='.length);
  const url = process.env.MYSQL_URL ?? (envPath ? envFileValue(envPath, 'MYSQL_URL') : undefined);
  if (!url) throw new Error('MYSQL_URL is required (use --env-file=PATH or export it)');
  const applyGate = process.env.MIGRATION_ALLOW_PRODUCTION ?? (envPath ? envFileValue(envPath, 'MIGRATION_ALLOW_PRODUCTION') : undefined);
  if (apply && applyGate !== 'true') throw new Error('--apply requires MIGRATION_ALLOW_PRODUCTION=true');

  const pool = mysql.createPool({ uri: url, charset: 'utf8mb4', timezone: 'Z', connectionLimit: 2 });
  const conn = await pool.getConnection();
  try {
    const [[database]] = await conn.query('SELECT DATABASE() AS name') as [[{ name: string }], unknown];
    const [archiveCounts] = await conn.query(`SELECT COUNT(*) AS count FROM payment_reports WHERE source_id LIKE 'recon-report:%'`) as [[{ count: number }], unknown];
    const [existingRows] = await conn.query(`SELECT COUNT(*) AS count FROM recon_transactions WHERE source_id LIKE 'recon-report:%'`) as [[{ count: number }], unknown];
    const [columns] = await conn.query(`SHOW COLUMNS FROM recon_transactions`) as [Array<{ Field: string }>, unknown];
    const columnNames = new Set(columns.map((column) => column.Field));
    const schemaReady = ['period_start_date', 'period_end_date'].every((column) => columnNames.has(column));
    if (!apply) {
      const [sample] = await conn.query(`SELECT id, tenant_id AS tenantId, store_id AS storeId, source_id AS sourceId, payload, received_at AS receivedAt FROM payment_reports WHERE source_id LIKE 'recon-report:%' LIMIT 50`) as [ArchivePage[], unknown];
      const samplePlans = planReconBackfill(sample);
      const sampleRawRows = sample.filter((row) => reportIdentity(row.sourceId)).reduce((sum, row) => sum + reconTransactionRows(row.payload).length, 0);
      const sampleMappedRows = samplePlans.reduce((sum, plan) => sum + plan.transactions.length, 0);
      const sampleCompleteness = samplePlans.reduce((acc, plan) => { acc[plan.complete ? 'complete' : 'incomplete'] += 1; return acc; }, { complete: 0, incomplete: 0 });
      console.log(JSON.stringify({
        mode: 'dry-run',
        database: database.name,
        readOnlyChecks: {
          archivedReconPages: Number(archiveCounts[0].count),
          existingReconRows: Number(existingRows[0].count),
          samplePages: sample.length,
          sampleGroups: samplePlans.length,
          sampleMappableRows: sampleMappedRows,
          sampleRowsWithoutAmount: sampleRawRows - sampleMappedRows,
          sampleCompleteGroups: sampleCompleteness.complete,
          sampleIncompleteGroups: sampleCompleteness.incomplete,
          periodColumnsReady: schemaReady,
        },
      }, null, 2));
      return;
    }

    const rows: ArchivePage[] = [];
    let cursor = '';
    while (true) {
      const [batch] = await conn.query(`SELECT id, tenant_id AS tenantId, store_id AS storeId, source_id AS sourceId, payload, received_at AS receivedAt FROM payment_reports WHERE id > ? AND source_id LIKE 'recon-report:%' ORDER BY id LIMIT 1000`, [cursor]) as [ArchivePage[], unknown];
      if (!batch.length) break;
      rows.push(...batch);
      cursor = batch[batch.length - 1]!.id;
    }
    const plans = planReconBackfill(rows);
    const completeness = plans.reduce((acc, plan) => { acc[plan.complete ? 'complete' : 'incomplete'] += 1; return acc; }, { complete: 0, incomplete: 0 });
    console.log(JSON.stringify({ mode: 'apply-preview', database: database.name, completeGroups: completeness.complete, incompleteGroups: completeness.incomplete, archivedReconPages: rows.length }, null, 2));
    if (!schemaReady) throw new Error('recon_transactions period columns are missing; apply migration 0040 first');

    for (const plan of plans.filter((candidate) => candidate.complete)) {
      await conn.beginTransaction();
      try {
        await conn.query('DELETE FROM recon_transactions WHERE tenant_id=? AND store_id=? AND source_id=?', [plan.tenantId, plan.storeId, plan.sourceId]);
        for (let start = 0; start < plan.transactions.length; start += 250) {
          const values = plan.transactions.slice(start, start + 250).map((row) => [
            transactionId(row), row.tenantId, row.storeId, row.reportMonth, row.sourceId, row.transactionKey, row.rowNumber,
            row.transactionId, row.transactionDate, row.periodStartDate, row.periodEndDate, row.description, row.transactionType,
            row.amount, row.currency, row.receivedAt, row.customerOrderId, row.purchaseOrderId, row.sku, row.amountType, row.purchaseOrderLine, row.shipQty, row.billTransactionKey,
          ]);
          if (!values.length) continue;
          await conn.query(`INSERT INTO recon_transactions (id,tenant_id,store_id,report_month,source_id,transaction_key,\`row_number\`,transaction_id,transaction_date,period_start_date,period_end_date,description,transaction_type,amount,currency,received_at,customer_order_id,purchase_order_id,sku,amount_type,purchase_order_line,ship_qty,bill_transaction_key) VALUES ? ON DUPLICATE KEY UPDATE report_month=VALUES(report_month),\`row_number\`=VALUES(\`row_number\`),transaction_id=VALUES(transaction_id),transaction_date=VALUES(transaction_date),period_start_date=VALUES(period_start_date),period_end_date=VALUES(period_end_date),description=VALUES(description),transaction_type=VALUES(transaction_type),amount=VALUES(amount),currency=VALUES(currency),received_at=VALUES(received_at),customer_order_id=VALUES(customer_order_id),purchase_order_id=VALUES(purchase_order_id),sku=VALUES(sku),amount_type=VALUES(amount_type),purchase_order_line=VALUES(purchase_order_line),ship_qty=VALUES(ship_qty),bill_transaction_key=VALUES(bill_transaction_key)`, [values]);
        }
        if (plan.pageSourceIds.length) await conn.query(`DELETE FROM recon_transactions WHERE tenant_id=? AND store_id=? AND source_id IN (?)`, [plan.tenantId, plan.storeId, plan.pageSourceIds]);
        await conn.commit();
      } catch (error) {
        await conn.rollback();
        throw error;
      }
    }
    console.log(JSON.stringify({ appliedCompleteGroups: completeness.complete, skippedIncompleteGroups: completeness.incomplete, idempotent: true }, null, 2));
  } finally {
    conn.release();
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) run().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
