type Head = { id: string; storeId?: string | null; sku?: string | null; shipmentId?: string | null; shippedAt?: string | null; quantity?: unknown; contractNumber?: string | null; purchaseBatchNumber?: string | null; inboundNumber?: string | null; signedStatus?: string | null; receivedAt?: Date | string };
type Receipt = {storeId: string; sku: string; shipmentId?: string | null; changedUnits?: unknown; reasonDescription?: string | null};
export type TransitDetail = { shipmentId: string; shippedAt: string; shipped: number | null; received: number; remaining: number | null; needsReview: boolean };
export function inventoryTransit(heads: Head[], receipts: Receipt[]) {
 const norm = (v: unknown) => String(v ?? '').trim().toUpperCase();
 const received = new Map<string, number>();
 for (const r of receipts) {
  if (!r.shipmentId || !/^(Received|Receiving Correction)/i.test(r.reasonDescription ?? '')) continue;
  const key = JSON.stringify([r.storeId, norm(r.sku), norm(r.shipmentId)]);
  const n = Number(r.changedUnits);
  if (Number.isFinite(n)) received.set(key, (received.get(key) ?? 0) + n);
 }
 const result = new Map<string, {quantity: number; details: TransitDetail[]}>();
 const seen = new Set<string>();
 const grouped = new Map<string, {storeId: string; sku: string; detail: TransitDetail}>();
 const versions = new Map<string, Head>();
 for (const h of heads) {
  const identified = h.contractNumber || h.purchaseBatchNumber || h.inboundNumber;
  const key = identified ? JSON.stringify([h.storeId, norm(h.sku), norm(h.shipmentId), norm(h.contractNumber), norm(h.purchaseBatchNumber), norm(h.inboundNumber), norm(h.shippedAt)]) : h.id;
  const previous = versions.get(key);
  if (!previous || new Date(h.receivedAt ?? 0).getTime() >= new Date(previous.receivedAt ?? 0).getTime()) versions.set(key, h);
 }
 for (const h of versions.values()) {
  if (!h.shippedAt?.trim() || !h.storeId || !norm(h.sku) || seen.has(h.id)) continue;
  seen.add(h.id);
  const sku = norm(h.sku), shipmentId = norm(h.shipmentId);
  const amount = h.quantity == null || String(h.quantity).trim() === '' ? NaN : Number(h.quantity);
  const needsReview = !shipmentId || !Number.isFinite(amount) || amount < 0;
  const key = JSON.stringify([h.storeId, sku, shipmentId, needsReview ? h.id : '']);
  const prior = grouped.get(key);
  if (prior) prior.detail.shipped = Number(prior.detail.shipped) + amount;
  else grouped.set(key, {storeId:h.storeId, sku, detail:{shipmentId, shippedAt:h.shippedAt, shipped: needsReview ? null : amount, received:0, remaining:null, needsReview}});
 }
 for (const {storeId, sku, detail} of grouped.values()) {
  if (!detail.needsReview) {
   detail.received = received.get(JSON.stringify([storeId, sku, detail.shipmentId])) ?? 0;
   detail.remaining = Math.max(0, Number(detail.shipped) - detail.received);
  }
  const key = `${storeId}:${sku}`, entry = result.get(key) ?? {quantity:0, details:[]};
  entry.quantity += detail.remaining ?? 0; entry.details.push(detail); result.set(key, entry);
 }
 return result;
}
