import { createHash } from 'node:crypto';
import { and, createDb, eq, wfsFeePreviewItems, wfsFeePreviewOptions, wfsFeePreviewRuns } from '../../../../packages/db/index.js';
import { walmartInboundPreview, type InboundPreviewItem, type InboundPreviewRequest, type WalmartConnection } from '@walmart-erp/walmart-client';

import { WfsShipmentRepository } from '../../../../packages/db/src/wfs-shipments.js';

type RecordValue = Record<string, unknown>;
export type PreviewCandidate = {
  shipmentId: string;
  inboundOrderId: string;
  destinationNode: string;
  destinationName: string;
  request: InboundPreviewRequest | null;
  items: Array<InboundPreviewItem & { productIdentity: string }>;
  reason?: string;
};
export type NormalizedPreviewOption = {
  previewType: string;
  shipNode: string;
  destinationName: string | null;
  totalNetTransferCharge: string | null;
  currency: string | null;
  items: Array<{ productIdentity: string; gtin: string | null; sku: string | null; itemQuantity: number | null; netTransferCharge: string | null; unitTransferCharge: string | null; currency: string | null }>;
  rawResponse: RecordValue;
};

const asRecord = (value: unknown): RecordValue | undefined => value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : undefined;
const text = (value: unknown) => String(value ?? '').trim();
const positiveInteger = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) && Number.isInteger(number) && number > 0 ? number : undefined;
};
const money = (value: unknown): string | null => {
  if (value == null || value === '') return null;
  const amount = typeof value === 'object' ? (value as RecordValue).amount ?? (value as RecordValue).value : value;
  const number = Number(amount);
  return Number.isFinite(number) ? String(amount) : null;
};
const normalizedIdentity = (value: unknown) => text(value).toUpperCase();
const ITS_TRANSFER_HUB_NODE_IDS = new Set(['4093', '4005', '2011']);
const ITS_TRANSFER_HUB_NODE_NAMES = new Map([['LAX2T', '4093'], ['IND2T', '4005'], ['NJ3T', '2011']]);

export function normalizePreviewCandidate(shipmentValue: unknown, itemRows: Array<{ payload: unknown; receivedAt?: Date | string | number }>, now = new Date()): PreviewCandidate {
  const shipment = asRecord(shipmentValue) ?? {};
  const shipmentId = text(shipment.shipmentId ?? shipment.inboundOrderId);
  const inboundOrderId = text(shipment.inboundOrderId);
  const shipToAddress = asRecord(shipment.shipToAddress);
  const rawDestinationNode = text(shipToAddress?.fcId ?? shipToAddress?.shipNode ?? shipToAddress?.nodeId);
  const destinationName = text(shipToAddress?.fcName ?? shipToAddress?.destinationName);
  const destinationNode = ITS_TRANSFER_HUB_NODE_IDS.has(rawDestinationNode)
    ? rawDestinationNode
    : ITS_TRANSFER_HUB_NODE_NAMES.get(normalizedIdentity(destinationName)) ?? '';
  const empty = (reason: string): PreviewCandidate => ({ shipmentId, inboundOrderId, destinationNode, destinationName, request: null, items: [], reason });
  if (/^CANCEL(?:LED|ED)$/.test(text(shipment.status).toUpperCase())) return empty('cancelled');
  if (!shipmentId || !inboundOrderId) return empty('missing_shipment_identity');
  if (!destinationNode) return empty('destination_not_transfer_hub');

  const rawAddress = asRecord(shipment.returnAddress);
  const returnAddress = rawAddress && {
    addressLine1: text(rawAddress.addressLine1),
    ...(text(rawAddress.addressLine2) ? { addressLine2: text(rawAddress.addressLine2) } : {}),
    city: text(rawAddress.city),
    stateCode: text(rawAddress.stateCode),
    countryCode: text(rawAddress.countryCode),
    postalCode: text(rawAddress.postalCode),
  };
  if (!returnAddress || !returnAddress.addressLine1 || !returnAddress.city || !returnAddress.stateCode || !returnAddress.countryCode || !returnAddress.postalCode) return empty('missing_address');

  const shipmentKeys = new Set([normalizedIdentity(shipmentId), normalizedIdentity(inboundOrderId)]);
  const latestBySku = new Map<string, { receivedAt: number; item: RecordValue; nested: RecordValue }>();
  for (const row of itemRows) {
    const item = asRecord(row.payload);
    if (!item) continue;
    const itemShipmentId = normalizedIdentity(item.shipmentId ?? item.inboundOrderId);
    if (itemShipmentId && !shipmentKeys.has(itemShipmentId)) continue;
    const nested = asRecord(item.item) ?? {};
    const sku = text(item.sku ?? nested.sku ?? item.itemId ?? nested.itemId);
    if (!sku) continue;
    const receivedAt = row.receivedAt instanceof Date ? row.receivedAt.getTime() : typeof row.receivedAt === 'string' ? Date.parse(row.receivedAt) : Number(row.receivedAt ?? 0);
    const current = latestBySku.get(normalizedIdentity(sku));
    if (!current || receivedAt >= current.receivedAt) latestBySku.set(normalizedIdentity(sku), { receivedAt, item, nested });
  }
  const expectedDelivery = text(shipment.expectedDeliveryDate);
  const items: PreviewCandidate['items'] = [];
  for (const [productIdentity, source] of latestBySku) {
    const { item, nested } = source;
    const sku = text(item.sku ?? nested.sku ?? item.itemId ?? nested.itemId);
    const gtin = text(item.gtin ?? item.productId ?? nested.gtin ?? nested.productId);
    const itemDesc = text(item.itemDesc ?? item.description ?? item.productName ?? nested.itemDesc ?? nested.description ?? nested.productName);
    const originalQty = positiveInteger(item.itemQty ?? item.quantity ?? item.plannedQuantity);
    const vendorPackQty = positiveInteger(item.vendorPackQty);
    const innerPackQty = positiveInteger(item.innerPackQty);
    const deliveryValue = text(item.expectedDeliveryDate ?? expectedDelivery);
    const today = Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate());
    const parsedDelivery = Date.parse(deliveryValue);
    const deliveryDate = new Date(Number.isFinite(parsedDelivery) && parsedDelivery >= today + 86400000 ? parsedDelivery : today + 7 * 86400000).toISOString();
    // The preview API requires itemQty = vendorPackQty * innerPackQty.
    // This changes the quote request only; stored shipment quantities remain untouched.
    const itemQty = vendorPackQty && innerPackQty ? vendorPackQty * innerPackQty : originalQty;
    if (!gtin || !itemDesc || !itemQty || !vendorPackQty || !innerPackQty || !deliveryDate) return empty('missing_item_fields');
    items.push({ productIdentity, productId: gtin, productType: 'GTIN', sku, itemDesc, itemQty, vendorPackQty, innerPackQty, expectedDeliveryDate: deliveryDate });
  }
  if (!items.length) return empty('missing_item_fields');
  return { shipmentId, inboundOrderId, destinationNode, destinationName, request: { inboundOrderId, returnAddress, orderItems: items.map(({ productIdentity: _identity, ...item }) => item) }, items };
}

export function previewRequestHash(request: InboundPreviewRequest): string {
  const stableRequest={...request,orderItems:request.orderItems.map(({expectedDeliveryDate:_quoteDate,...item})=>item).sort((a,b)=>a.sku.localeCompare(b.sku))};
  return createHash('sha256').update(JSON.stringify({ request:stableRequest, strategy: 'stable-shipment-inputs-v3', itsTransferHubNodeIds: [...ITS_TRANSFER_HUB_NODE_IDS].sort() })).digest('hex');
}

export function normalizePreviewResponse(value: unknown): NormalizedPreviewOption[] {
  const root = asRecord(value);
  const payload = root?.payload;
  if (!Array.isArray(payload)) return [];
  const result: NormalizedPreviewOption[] = [];
  for (const entryValue of payload) {
    const entry = asRecord(entryValue);
    if (!Array.isArray(entry?.previews)) continue;
    for (const previewGroupValue of entry.previews) {
      const group = asRecord(previewGroupValue);
      if (!group) continue;
      const previewType = text(group.previewType ?? 'unknown');
      const previews = Array.isArray(group.preview) ? group.preview : group.preview ? [group.preview] : [];
      for (const previewValue of previews) {
        const preview = asRecord(previewValue);
        if (!preview) continue;
        const itemsValue = Array.isArray(preview.shipmentItems) ? preview.shipmentItems : [];
        const currency = text(preview.currencyUnit ?? preview.currency) || null;
        result.push({
          previewType,
          shipNode: text(preview.shipNode ?? preview.shipNodeId ?? preview.destinationNodeId) || `unknown-${result.length + 1}`,
          destinationName: text(preview.shipNodeName ?? preview.destinationName ?? preview.destinationNodeName ?? asRecord(preview.shipToAddress)?.fcName) || null,
          totalNetTransferCharge: money(preview.totalNetTransferCharge),
          currency,
          items: itemsValue.flatMap((itemValue) => {
            const item = asRecord(itemValue);
            if (!item) return [];
            const sku = text(item.sku ?? item.vendorSku) || null;
            const gtin = text(item.gtin ?? item.productId) || null;
            const productIdentity = normalizedIdentity(sku ?? gtin);
            if (!productIdentity) return [];
            return [{ productIdentity, gtin, sku, itemQuantity: positiveInteger(item.itemQty ?? item.quantity) ?? null, netTransferCharge: money(item.netTransferCharge), unitTransferCharge: money(item.unitTransferCharge), currency: text(item.currencyUnit ?? item.currency) || currency }];
          }),
          rawResponse: preview,
        });
      }
    }
  }
  return result;
}

export type WfsFeePreviewSyncResult = { scanned: number; eligible: number; skipped: number; unchanged: number; previewed: number; noItsOption: number; failed: number; skipReasons: Record<string, number> };
type PreviousPreviewRun = { requestHash: string; status: string; lastSuccessAt: Date | null; createdAt?: Date };
type PreviewRunDependencies = {
  getPrevious: (candidate: PreviewCandidate) => Promise<PreviousPreviewRun | undefined>;
  preview: (request: InboundPreviewRequest) => Promise<unknown>;
  saveSkipped: (candidate: PreviewCandidate, reason: string, previous: PreviousPreviewRun | undefined, attemptedAt: Date) => Promise<void>;
  saveSuccess: (candidate: PreviewCandidate, requestHash: string, options: NormalizedPreviewOption[], previous: PreviousPreviewRun | undefined, attemptedAt: Date) => Promise<void>;
  saveFailure: (candidate: PreviewCandidate, requestHash: string, message: string, previous: PreviousPreviewRun | undefined, attemptedAt: Date) => Promise<void>;
};

export async function runWfsFeePreviewCandidates(candidates: PreviewCandidate[], dependencies: PreviewRunDependencies): Promise<WfsFeePreviewSyncResult> {
  const result: WfsFeePreviewSyncResult = { scanned: 0, eligible: 0, skipped: 0, unchanged: 0, previewed: 0, noItsOption: 0, failed: 0, skipReasons: {} };
  for (const candidate of candidates) {
    result.scanned += 1;
    const previous = await dependencies.getPrevious(candidate);
    if (candidate.reason || !candidate.request) {
      const reason = candidate.reason ?? 'missing_item_fields';
      result.skipped += 1;
      result.skipReasons[reason] = (result.skipReasons[reason] ?? 0) + 1;
      await dependencies.saveSkipped(candidate, reason, previous, new Date());
      continue;
    }
    result.eligible += 1;
    const requestHash = previewRequestHash(candidate.request);
    if (previous?.requestHash === requestHash && ['succeeded', 'no_its_option'].includes(previous.status)) {
      result.unchanged += 1;
      continue;
    }
    const attemptedAt = new Date();
    try {
      const options: NormalizedPreviewOption[] = [];
      const errors: string[] = [];
      const shipNode = candidate.destinationNode;
      try {
        const request: InboundPreviewRequest = {
          ...candidate.request,
          orderItems: candidate.request.orderItems.map((item) => ({ ...item, shipNode })),
        };
        const response = await dependencies.preview(request);
        for (const option of normalizePreviewResponse(response)) {
          if (option.shipNode === shipNode) options.push(option);
        }
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
      if (errors.length) throw new Error(errors.join('; ').slice(0, 1000));
      await dependencies.saveSuccess(candidate, requestHash, options, previous, attemptedAt);
      result.previewed += 1;
      if (!options.some((option) => option.previewType.toLowerCase() === 'inbound')) result.noItsOption += 1;
    } catch (error) {
      result.failed += 1;
      const message = (error instanceof Error ? error.message : String(error)).slice(0, 1000);
      await dependencies.saveFailure(candidate, requestHash, message, previous, attemptedAt);
    }
  }
  return result;
}

function stableId(...parts: string[]) { return createHash('sha256').update(parts.join('\u0000')).digest('hex').slice(0, 64); }

export async function syncWfsFeePreviewToDatabase(input: { tenantId: string; storeId: string; batchId?: string; shipmentIds?: string[] }, connection: WalmartConnection): Promise<WfsFeePreviewSyncResult> {
  const { db, pool } = createDb();
  const repository = new WfsShipmentRepository(pool);
  const [shipmentRecords, itemRows] = await Promise.all([
    repository.list(input.tenantId,input.storeId),
    repository.items(input.tenantId,input.storeId),
  ]);
  const shipmentRows = shipmentRecords.filter(row=>!input.shipmentIds || input.shipmentIds.includes(row.shipmentId)).map(payload=>({payload}));
  const latestShipments = new Map<string, RecordValue>();
  for (const row of shipmentRows) {
    const shipment = asRecord(row.payload);
    const id = normalizedIdentity(shipment?.shipmentId ?? shipment?.inboundOrderId);
    if (shipment && id && !latestShipments.has(id)) latestShipments.set(id, shipment);
  }
  const itemsByShipment = new Map<string, Array<{ payload: unknown; receivedAt?: Date | string | number }>>();
  for (const row of itemRows) {
    const item = asRecord(row.payload);
    if (!item) continue;
    const key = normalizedIdentity(item.shipmentId ?? item.inboundOrderId);
    if (!key) continue;
    const grouped = itemsByShipment.get(key) ?? [];
    grouped.push(row);
    itemsByShipment.set(key, grouped);
  }
  const candidates = [...latestShipments.values()].map((shipment) => {
    const matchingItems = [...new Set([
      ...(itemsByShipment.get(normalizedIdentity(shipment.shipmentId)) ?? []),
      ...(itemsByShipment.get(normalizedIdentity(shipment.inboundOrderId)) ?? []),
    ])];
    return normalizePreviewCandidate(shipment, matchingItems);
  });
  return runWfsFeePreviewCandidates(candidates, {
    getPrevious: async (candidate) => {
      const previousRows = await db.select({ requestHash: wfsFeePreviewRuns.requestHash, status: wfsFeePreviewRuns.status, lastSuccessAt: wfsFeePreviewRuns.lastSuccessAt, createdAt: wfsFeePreviewRuns.createdAt }).from(wfsFeePreviewRuns).where(and(eq(wfsFeePreviewRuns.tenantId, input.tenantId), eq(wfsFeePreviewRuns.storeId, input.storeId), eq(wfsFeePreviewRuns.shipmentId, candidate.shipmentId))).limit(1);
      return previousRows[0];
    },
    preview: async (request) => (await walmartInboundPreview<unknown>(connection, request, fetch, AbortSignal.timeout(120_000))).data,
    saveSkipped: async (candidate, reason, previous, attemptedAt) => {
      const runId = stableId(input.tenantId, input.storeId, candidate.shipmentId);
      await db.transaction(async (tx) => {
        if (reason === 'destination_not_transfer_hub') {
          await tx.delete(wfsFeePreviewItems).where(and(eq(wfsFeePreviewItems.tenantId, input.tenantId), eq(wfsFeePreviewItems.storeId, input.storeId), eq(wfsFeePreviewItems.shipmentId, candidate.shipmentId)));
          await tx.delete(wfsFeePreviewOptions).where(and(eq(wfsFeePreviewOptions.tenantId, input.tenantId), eq(wfsFeePreviewOptions.storeId, input.storeId), eq(wfsFeePreviewOptions.shipmentId, candidate.shipmentId)));
        }
        await tx.insert(wfsFeePreviewRuns).values({ id: runId, tenantId: input.tenantId, storeId: input.storeId, shipmentId: candidate.shipmentId, inboundOrderId: candidate.inboundOrderId || null, requestHash: previous?.requestHash ?? '', status: 'skipped', skipReason: reason, lastAttemptAt: attemptedAt, lastSuccessAt: previous?.lastSuccessAt ?? null, lastError: null, createdAt: previous?.createdAt ?? attemptedAt, updatedAt: attemptedAt }).onDuplicateKeyUpdate({ set: { inboundOrderId: candidate.inboundOrderId || null, status: 'skipped', skipReason: reason, lastAttemptAt: attemptedAt, lastError: null, updatedAt: attemptedAt } });
      });
    },
    saveSuccess: async (candidate, requestHash, options, previous, attemptedAt) => {
      const runId = stableId(input.tenantId, input.storeId, candidate.shipmentId);
      const itsOptions = options.filter((option) => option.previewType.toLowerCase() === 'inbound');
      await db.transaction(async (tx) => {
        await tx.insert(wfsFeePreviewRuns).values({ id: runId, tenantId: input.tenantId, storeId: input.storeId, shipmentId: candidate.shipmentId, inboundOrderId: candidate.inboundOrderId, requestHash, status: itsOptions.length ? 'succeeded' : 'no_its_option', skipReason: null, lastAttemptAt: attemptedAt, lastSuccessAt: attemptedAt, lastError: null, createdAt: previous?.createdAt ?? attemptedAt, updatedAt: attemptedAt }).onDuplicateKeyUpdate({ set: { inboundOrderId: candidate.inboundOrderId, requestHash, status: itsOptions.length ? 'succeeded' : 'no_its_option', skipReason: null, lastAttemptAt: attemptedAt, lastSuccessAt: attemptedAt, lastError: null, updatedAt: attemptedAt } });
        await tx.delete(wfsFeePreviewItems).where(and(eq(wfsFeePreviewItems.tenantId, input.tenantId), eq(wfsFeePreviewItems.storeId, input.storeId), eq(wfsFeePreviewItems.shipmentId, candidate.shipmentId)));
        await tx.delete(wfsFeePreviewOptions).where(and(eq(wfsFeePreviewOptions.tenantId, input.tenantId), eq(wfsFeePreviewOptions.storeId, input.storeId), eq(wfsFeePreviewOptions.shipmentId, candidate.shipmentId)));
        for (const option of options) {
          const optionId = stableId(runId, option.previewType, option.shipNode);
          await tx.insert(wfsFeePreviewOptions).values({ id: optionId, runId, tenantId: input.tenantId, storeId: input.storeId, shipmentId: candidate.shipmentId, previewType: option.previewType, shipNode: option.shipNode, destinationName: option.destinationName, totalNetTransferCharge: option.totalNetTransferCharge, currency: option.currency, rawResponse: option.rawResponse, createdAt: attemptedAt });
          for (const item of option.items) await tx.insert(wfsFeePreviewItems).values({ id: stableId(optionId, item.productIdentity), optionId, tenantId: input.tenantId, storeId: input.storeId, shipmentId: candidate.shipmentId, productIdentity: item.productIdentity, gtin: item.gtin, sku: item.sku, itemQuantity: item.itemQuantity, netTransferCharge: item.netTransferCharge, unitTransferCharge: item.unitTransferCharge, currency: item.currency, createdAt: attemptedAt });
        }
      });
    },
    saveFailure: async (candidate, requestHash, message, previous, attemptedAt) => {
      const runId = stableId(input.tenantId, input.storeId, candidate.shipmentId);
      await db.insert(wfsFeePreviewRuns).values({ id: runId, tenantId: input.tenantId, storeId: input.storeId, shipmentId: candidate.shipmentId, inboundOrderId: candidate.inboundOrderId, requestHash, status: 'failed', skipReason: null, lastAttemptAt: attemptedAt, lastSuccessAt: previous?.lastSuccessAt ?? null, lastError: message, createdAt: previous?.createdAt ?? attemptedAt, updatedAt: attemptedAt }).onDuplicateKeyUpdate({ set: { inboundOrderId: candidate.inboundOrderId, requestHash, status: 'failed', lastAttemptAt: attemptedAt, lastError: message, updatedAt: attemptedAt } });
    },
  });
}
