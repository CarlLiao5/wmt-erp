import { createHash } from 'node:crypto';
import { and, createDb, eq, freightTrackingEvents, freightTrackingRoutes, headFreightRows, rawPayloads, sql } from '../../../../packages/db/index.js';
import { brandForInboundNumber, normalizeFreightNumber, type FreightCarrierBrand } from '../freight-tracking/brands.js';
import { createFreightCarrierClient, type FreightCarrierClient } from '../freight-tracking/clients.js';
import { loadFreightCarrierCredentials, type FreightCarrierCredentials } from '../freight-tracking/credentials.js';
import { normalizeTrackingPayload, type NormalizedFreightTracking } from '../freight-tracking/normalize.js';

export interface FreightTrackingSource { id: string; freightForwarderInboundNumber: string | null }
export interface ExistingFreightRoute { currentStatus: string; lastEventAt: Date | null }
export interface PersistFreightTrackingInput {
  tenantId: string;
  inboundNumber: string;
  sourceHeadFreightRowIds: string[];
  brand: FreightCarrierBrand;
  batchId: string;
  rawPayload: unknown;
  tracking: NormalizedFreightTracking;
}
export interface FreightTrackingRepository {
  listHeadFreight(tenantId: string): Promise<FreightTrackingSource[]>;
  listRoutes(tenantId: string): Promise<Map<string, ExistingFreightRoute>>;
  persistSuccess(input: PersistFreightTrackingInput): Promise<void>;
}
export interface FreightTrackingSyncInput { tenantId: string; batchId: string }
export interface FreightTrackingSyncResult {
  resource: 'freight-tracking';
  sourceShipments: number;
  matched: number;
  queried: number;
  written: number;
  notFound: number;
  skippedDelivered: number;
  skippedStale: number;
  skippedUnmatched: number;
  failed: number;
  errors: Array<{ brand: string; inboundNumber: string; message: string }>;
  batchId: string;
}
export interface FreightTrackingDependencies {
  repository?: FreightTrackingRepository;
  loadCredentials?: (brand: FreightCarrierBrand) => Promise<FreightCarrierCredentials>;
  createClient?: (credentials: FreightCarrierCredentials) => FreightCarrierClient;
  now?: () => Date;
  delayMs?: number;
}

function stableId(...parts: string[]): string {
  return createHash('sha256').update(parts.join(':')).digest('hex');
}

function redactPayload(value: unknown, secrets: string[] = []): unknown {
  if (Array.isArray(value)) return value.map((entry) => redactPayload(entry, secrets));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
      key,
      /password|token|authorization|secret/i.test(key) ? '[REDACTED]' : redactPayload(entry, secrets),
    ]));
  }
  if (typeof value === 'string') return secrets.reduce((text, secret) => secret ? text.split(secret).join('[REDACTED]') : text, value);
  return value;
}

function safeError(error: unknown, secrets: string[] = []): string {
  const message = error instanceof Error ? error.message : 'Carrier request failed';
  const safe = secrets.reduce((text, secret) => secret ? text.split(secret).join('[REDACTED]') : text, message);
  return safe.slice(0, 300);
}

function createDatabaseRepository(): FreightTrackingRepository {
  const { db } = createDb();
  return {
    async listHeadFreight(tenantId) {
      return db.select({ id: headFreightRows.id, freightForwarderInboundNumber: headFreightRows.freightForwarderInboundNumber })
        .from(headFreightRows)
        .where(and(eq(headFreightRows.tenantId, tenantId), sql`${headFreightRows.freightForwarderInboundNumber} IS NOT NULL`));
    },
    async listRoutes(tenantId) {
      const rows = await db.select({ inboundNumber: freightTrackingRoutes.freightForwarderInboundNumber, currentStatus: freightTrackingRoutes.currentStatus, lastEventAt: freightTrackingRoutes.lastEventAt })
        .from(freightTrackingRoutes)
        .where(eq(freightTrackingRoutes.tenantId, tenantId));
      return new Map(rows.map((row) => [normalizeFreightNumber(row.inboundNumber), { currentStatus: row.currentStatus, lastEventAt: row.lastEventAt }]));
    },
    async persistSuccess(input) {
      const routeId = stableId(input.tenantId, normalizeFreightNumber(input.inboundNumber));
      const now = new Date();
      await db.transaction(async (transaction) => {
        const [rawPayload] = await transaction.insert(rawPayloads).values({
          tenantId: input.tenantId,
          storeId: null,
          resource: 'freight-tracking',
          externalId: stableId(input.tenantId, normalizeFreightNumber(input.inboundNumber), input.batchId),
          payload: redactPayload(input.rawPayload) as Record<string, unknown>,
          httpStatus: 200,
          correlationId: input.batchId,
          receivedAt: now,
        }).$returningId();

        await transaction.insert(freightTrackingRoutes).values({
          id: routeId,
          tenantId: input.tenantId,
          freightForwarderInboundNumber: normalizeFreightNumber(input.inboundNumber),
          brand: input.brand,
          currentStatus: input.tracking.currentStatus,
          currentStatusText: input.tracking.currentStatusText,
          lastEventAt: input.tracking.lastEventAt,
          lastFetchedAt: now,
          lastSuccessfulBatchId: input.batchId,
          rawPayloadId: rawPayload.id,
          sourceHeadFreightRowIds: input.sourceHeadFreightRowIds,
          createdAt: now,
          updatedAt: now,
        }).onDuplicateKeyUpdate({ set: {
          brand: input.brand,
          currentStatus: input.tracking.currentStatus,
          currentStatusText: input.tracking.currentStatusText,
          lastEventAt: input.tracking.lastEventAt,
          lastFetchedAt: now,
          lastSuccessfulBatchId: input.batchId,
          rawPayloadId: rawPayload.id,
          sourceHeadFreightRowIds: input.sourceHeadFreightRowIds,
          updatedAt: now,
        } });

        await transaction.delete(freightTrackingEvents)
          .where(and(eq(freightTrackingEvents.tenantId, input.tenantId), eq(freightTrackingEvents.routeId, routeId)));
        if (input.tracking.events.length) {
          await transaction.insert(freightTrackingEvents).values(input.tracking.events.map((event) => ({
            id: stableId(routeId, String(event.routeOrder)),
            tenantId: input.tenantId,
            routeId,
            routeOrder: event.routeOrder,
            eventTimeText: event.eventTimeText.slice(0, 191),
            eventAt: event.occurredAt,
            info: event.info,
            eventCode: event.eventCode.slice(0, 64),
            raw: redactPayload(event.raw) as Record<string, unknown>,
            createdAt: now,
          })));
        }
      });
    },
  };
}

function appendErrors(target: FreightTrackingSyncResult['errors'], brand: string, inboundNumber: string, message: string): void {
  if (target.length < 20) target.push({ brand, inboundNumber, message });
}

export async function syncFreightTracking(input: FreightTrackingSyncInput, dependencies: FreightTrackingDependencies = {}): Promise<FreightTrackingSyncResult> {
  const repository = dependencies.repository ?? createDatabaseRepository();
  const loadCredentials = dependencies.loadCredentials ?? loadFreightCarrierCredentials;
  const createClient = dependencies.createClient ?? createFreightCarrierClient;
  const now = dependencies.now ?? (() => new Date());
  const delayMs = Math.max(0, dependencies.delayMs ?? 500);
  const result: FreightTrackingSyncResult = {
    resource: 'freight-tracking', sourceShipments: 0, matched: 0, queried: 0, written: 0, notFound: 0,
    skippedDelivered: 0, skippedStale: 0, skippedUnmatched: 0, failed: 0, errors: [], batchId: input.batchId,
  };

  const sourceRows = await repository.listHeadFreight(input.tenantId);
  const sourceNumbers = new Map<string, string[]>();
  for (const source of sourceRows) {
    const inboundNumber = normalizeFreightNumber(source.freightForwarderInboundNumber ?? '');
    if (!inboundNumber) continue;
    const ids = sourceNumbers.get(inboundNumber) ?? [];
    ids.push(source.id);
    sourceNumbers.set(inboundNumber, ids);
  }
  result.sourceShipments = sourceNumbers.size;
  const routes = await repository.listRoutes(input.tenantId);
  const cutoff = now().getTime() - 30 * 24 * 60 * 60 * 1000;
  const byBrand = new Map<FreightCarrierBrand, Array<{ inboundNumber: string; sourceIds: string[] }>>();

  for (const [inboundNumber, sourceIds] of sourceNumbers) {
    const brand = brandForInboundNumber(inboundNumber);
    if (!brand) {
      result.skippedUnmatched += 1;
      continue;
    }
    result.matched += 1;
    const existing = routes.get(inboundNumber);
    if (existing?.currentStatus === 'delivered') {
      result.skippedDelivered += 1;
      continue;
    }
    if (existing?.lastEventAt && existing.lastEventAt.getTime() < cutoff) {
      result.skippedStale += 1;
      continue;
    }
    const numbers = byBrand.get(brand) ?? [];
    numbers.push({ inboundNumber, sourceIds });
    byBrand.set(brand, numbers);
  }

  await Promise.all([...byBrand.entries()].map(async ([brand, shipments]) => {
    let credentials: FreightCarrierCredentials;
    let client: FreightCarrierClient;
    try {
      credentials = await loadCredentials(brand);
      client = createClient(credentials);
    } catch (error) {
      for (const shipment of shipments) {
        result.failed += 1;
        appendErrors(result.errors, brand, shipment.inboundNumber, safeError(error));
      }
      return;
    }

    for (let index = 0; index < shipments.length; index += 1) {
      const shipment = shipments[index];
      result.queried += 1;
      try {
        const response = await client.fetchTracking(shipment.inboundNumber);
        if (!response.matched) {
          result.notFound += 1;
        } else {
          const tracking = normalizeTrackingPayload(response.trackingPayload);
          if (tracking.events.length === 0) {
            throw new Error('Carrier returned no tracking events; existing route data was preserved');
          }
          await repository.persistSuccess({
            tenantId: input.tenantId,
            inboundNumber: shipment.inboundNumber,
            sourceHeadFreightRowIds: shipment.sourceIds,
            brand,
            batchId: input.batchId,
            rawPayload: redactPayload(response.rawPayload, [credentials.password]),
            tracking,
          });
          result.written += 1;
        }
      } catch (error) {
        result.failed += 1;
        appendErrors(result.errors, brand, shipment.inboundNumber, safeError(error, [credentials.password]));
      }
      if (index < shipments.length - 1 && delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }));

  return result;
}
