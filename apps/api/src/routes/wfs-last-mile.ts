import { createDb } from '@walmart-erp/db';

type PaymentRow = Record<string, string | undefined>;
export type PaymentFeePage = {storeId: string; payload: {reportData?: PaymentRow[]}};
type Sample = {amount: number; units: number};
const day = 86_400_000;

function postedDate(value: string) {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
  return match ? Date.UTC(Number(match[3]), Number(match[1]) - 1, Number(match[2])) : Date.parse(value);
}

export function averageWfsLastMile(pages: PaymentFeePage[], skus: Set<string>, from: number, to: number) {
  const quantities = new Map<string, Map<string, number>>();
  const charges = new Map<string, {sku: string; amount: number; units: Set<number>}>();
  const seen = new Set<string>();
  for (const {storeId, payload} of pages) {
    for (const row of payload.reportData ?? []) {
      const sku = row['Partner Item Id']?.trim().toUpperCase();
      if (!sku || !skus.has(sku)) continue;
      const po = row['Purchase Order #']?.trim();
      const line = row['Purchase Order line #']?.trim();
      const transaction = row['Transaction Key']?.trim();
      if (!po || !line || !transaction || (row.Currency?.trim().toUpperCase() || 'USD') !== 'USD') continue;
      const key = JSON.stringify([storeId, po, line, sku]);
      const description = row['Transaction Description']?.trim();
      const units = Number(row['Ship Qty']);
      if (description === 'Purchase' && row['Amount Type'] === 'Product Price' && Number.isInteger(units) && units > 0) {
        const purchase = quantities.get(key) ?? new Map();
        purchase.set(transaction, units);
        quantities.set(key, purchase);
        continue;
      }
      if (!/^wfs fulfillment\s*fee$/i.test(description ?? '') || /refund|return/i.test(row['Transaction Type'] ?? '')) continue;
      const posted = postedDate(row['Transaction Posted Timestamp'] ?? '');
      const amount = Number(row.Amount);
      if (!Number.isFinite(posted) || posted < from || posted >= to || !Number.isFinite(amount) || amount >= 0) continue;
      const dedupKey = JSON.stringify([key, transaction]);
      if (seen.has(dedupKey)) continue;
      seen.add(dedupKey);
      const charge = charges.get(key) ?? {sku, amount: 0, units: new Set<number>()};
      charge.amount -= amount;
      if (Number.isInteger(units) && units > 0) charge.units.add(units);
      charges.set(key, charge);
    }
  }
  const result = new Map<string, Sample>();
  for (const [key, charge] of charges) {
    const purchase = quantities.get(key);
    const units = purchase ? [...purchase.values()].reduce((sum, qty) => sum + qty, 0)
      : charge.units.size === 1 ? [...charge.units][0]! : 0;
    if (!units) continue;
    const total = result.get(charge.sku) ?? {amount: 0, units: 0};
    total.amount += charge.amount;
    total.units += units;
    result.set(charge.sku, total);
  }
  return result;
}

export function averagePaymentCommission(pages: PaymentFeePage[], skus: Set<string>, from: number, to: number) {
  const lines = new Map<string, {sku: string; sales: number; commission: number; hasCommission: boolean}>();
  const seen = new Set<string>();
  for (const {storeId, payload} of pages) {
    for (const row of payload.reportData ?? []) {
      if (row['Transaction Description'] !== 'Purchase' || row['Transaction Type'] !== 'Sale') continue;
      const type = row['Amount Type'];
      if (type !== 'Product Price' && type !== 'Commission on Product') continue;
      const sku = row['Partner Item Id']?.trim().toUpperCase();
      const po = row['Purchase Order #']?.trim();
      const line = row['Purchase Order line #']?.trim();
      const transaction = row['Transaction Key']?.trim();
      if (!sku || !skus.has(sku) || !po || !line || !transaction || (row.Currency?.trim().toUpperCase() || 'USD') !== 'USD') continue;
      const posted = postedDate(row['Transaction Posted Timestamp'] ?? '');
      const amount = Number(row.Amount);
      if (!row.Amount?.trim() || !Number.isFinite(amount) || !Number.isFinite(posted) || posted < from || posted >= to) continue;
      const lineKey = JSON.stringify([storeId, po, line, sku]);
      const transactionKey = JSON.stringify([lineKey, transaction, type]);
      if (seen.has(transactionKey)) continue;
      seen.add(transactionKey);
      const sample = lines.get(lineKey) ?? {sku, sales: 0, commission: 0, hasCommission: false};
      if (type === 'Product Price') sample.sales += amount;
      else {
        sample.commission -= amount;
        sample.hasCommission = true;
      }
      lines.set(lineKey, sample);
    }
  }
  const result = new Map<string, {commission: number; sales: number}>();
  for (const {sku, sales, commission, hasCommission} of lines.values()) {
    if (!hasCommission || sales <= 0 || commission < 0) continue;
    const total = result.get(sku) ?? {commission: 0, sales: 0};
    total.commission += commission;
    total.sales += sales;
    result.set(sku, total);
  }
  return result;
}

export async function wfsPaymentAverages(tenantId: string, skus: string[]) {
  skus = [...new Set(skus.map(sku => sku.trim().toUpperCase()).filter(Boolean))];
  if (!skus.length) return {lastMile: new Map<string, Sample>(), commission: new Map<string, {commission: number; sales: number}>()};
  const to = Math.floor(Date.now() / day) * day + day;
  const from = Number.NEGATIVE_INFINITY;
  const reportPages = await loadPaymentFeePages(tenantId, skus);
  const skuSet = new Set(skus);
  return {
    lastMile: averageWfsLastMile(reportPages, skuSet, from, to),
    commission: averagePaymentCommission(reportPages, skuSet, from, to),
  };
}

export async function loadPaymentFeePages(tenantId: string, skus: string[], earliestMonth?: string) {
  if (!skus.length) return [];
  const [rows] = await createDb().pool.query(
    `SELECT p.store_id AS storeId, p.sku AS \`Partner Item Id\`,
       p.purchase_order_id AS \`Purchase Order #\`, p.purchase_order_line AS \`Purchase Order line #\`,
       p.bill_transaction_key AS \`Transaction Key\`, p.description AS \`Transaction Description\`,
       p.transaction_type AS \`Transaction Type\`, p.amount_type AS \`Amount Type\`,
       DATE_FORMAT(p.transaction_date,'%Y-%m-%d') AS \`Transaction Posted Timestamp\`,
       p.ship_qty AS \`Ship Qty\`, p.amount AS Amount, p.currency AS Currency
     FROM recon_transactions p
     WHERE p.tenant_id=? ${earliestMonth ? 'AND p.report_month>=?' : ''} AND p.source_id LIKE 'recon-report:%'
       AND p.sku IN (?)
       AND (p.description IN ('WFS Fulfillment fee', 'WFS FulfillmentFee')
         OR (p.description='Purchase' AND p.amount_type IN ('Product Price', 'Commission on Product')))`,
    [tenantId, ...(earliestMonth ? [earliestMonth] : []), skus],
  );
  const pages = new Map<string, PaymentRow[]>();
  for (const {storeId, ...row} of rows as Array<{storeId: string} & PaymentRow>) {
    const group = pages.get(storeId) ?? [];
    group.push(row);
    pages.set(storeId, group);
  }
  return [...pages].map(([storeId, reportData]) => ({storeId, payload: {reportData}}));
}
