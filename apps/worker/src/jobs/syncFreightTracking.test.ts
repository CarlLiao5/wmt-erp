import { describe, expect, it } from 'vitest';
import type { FreightCarrierBrand } from '../freight-tracking/brands.js';
import type { CarrierTrackingResponse, FreightCarrierClient } from '../freight-tracking/clients.js';
import type { FreightCarrierCredentials } from '../freight-tracking/credentials.js';
import { syncFreightTracking, type FreightTrackingRepository } from './syncFreightTracking.js';

const trackingPayload = {
  rows: [{ components: [{ comKey: 'tms-csos-shipment-tracking', data: { dataSource: [{ title: '2026-10-22 10:00:00', info: '运输中', event: 'MOVE' }] } }] }],
};
const credentials = (brand: FreightCarrierBrand) => ({ brand, displayName: brand, loginUrl: 'https://example.test', searchUrl: 'https://example.test', username: 'u', password: 'secret', prefixPatterns: [], extras: {} }) as FreightCarrierCredentials;

function repository(sources: Array<{ id: string; freightForwarderInboundNumber: string }>, routes: Array<{ number: string; currentStatus: string; lastEventAt: Date | null }> = []) {
  const persisted: Array<{ number: string; batchId: string }> = [];
  const repo: FreightTrackingRepository = {
    listHeadFreight: async (tenantId) => { expect(tenantId).toBe('tenant-1'); return sources; },
    listRoutes: async (tenantId) => {
      expect(tenantId).toBe('tenant-1');
      return new Map(routes.map((route) => [route.number, { currentStatus: route.currentStatus, lastEventAt: route.lastEventAt }]));
    },
    persistSuccess: async (input) => { persisted.push({ number: input.inboundNumber, batchId: input.batchId }); },
  };
  return { repo, persisted };
}

function successfulClient(onFetch: (number: string) => void = () => {}): FreightCarrierClient {
  return { fetchTracking: async (number): Promise<CarrierTrackingResponse> => { onFetch(number); return { matched: true, trackingPayload, rawPayload: trackingPayload }; } };
}

describe('syncFreightTracking', () => {
  it('deduplicates head freight numbers, routes brands, skips delivered/stale and counts unsupported prefixes', async () => {
    const fetched: string[] = [];
    const { repo, persisted } = repository([
      { id: 'row-1', freightForwarderInboundNumber: 'QT1001' },
      { id: 'row-2', freightForwarderInboundNumber: ' qt1001 ' },
      { id: 'row-3', freightForwarderInboundNumber: 'TT2001' },
      { id: 'row-4', freightForwarderInboundNumber: 'DSL3001' },
      { id: 'row-5', freightForwarderInboundNumber: 'DP4001' },
      { id: 'row-6', freightForwarderInboundNumber: 'OTHER5001' },
      { id: 'row-7', freightForwarderInboundNumber: '' },
    ], [
      { number: 'TT2001', currentStatus: 'delivered', lastEventAt: new Date('2026-10-22T00:00:00Z') },
      { number: 'DSL3001', currentStatus: 'in_progress', lastEventAt: new Date('2026-09-01T00:00:00Z') },
    ]);

    const result = await syncFreightTracking({ tenantId: 'tenant-1', batchId: 'batch-1' }, {
      repository: repo,
      now: () => new Date('2026-10-23T00:00:00Z'),
      delayMs: 0,
      loadCredentials: async (brand) => credentials(brand),
      createClient: (config) => successfulClient((number) => { fetched.push(`${config.brand}:${number}`); }),
    });

    expect(fetched).toEqual(['qitexp:QT1001', 'depaex:DP4001']);
    expect(persisted).toEqual([{ number: 'QT1001', batchId: 'batch-1' }, { number: 'DP4001', batchId: 'batch-1' }]);
    expect(result).toMatchObject({ sourceShipments: 5, matched: 4, queried: 2, written: 2, notFound: 0, skippedDelivered: 1, skippedStale: 1, skippedUnmatched: 1, failed: 0 });
  });

  it('isolates a failed tracking number and continues the other carrier group', async () => {
    const { repo } = repository([
      { id: 'row-1', freightForwarderInboundNumber: 'QT1001' },
      { id: 'row-2', freightForwarderInboundNumber: 'DP4001' },
    ]);
    const result = await syncFreightTracking({ tenantId: 'tenant-1', batchId: 'batch-2' }, {
      repository: repo,
      now: () => new Date('2026-10-23T00:00:00Z'),
      delayMs: 0,
      loadCredentials: async (brand) => credentials(brand),
      createClient: (config) => ({ fetchTracking: async (number) => {
        if (config.brand === 'qitexp') throw new Error('Carrier qitexp request failed (503)');
        return successfulClient().fetchTracking(number);
      } }),
    });

    expect(result).toMatchObject({ sourceShipments: 2, matched: 2, queried: 2, written: 1, failed: 1 });
    expect(result.errors).toEqual([{ brand: 'qitexp', inboundNumber: 'QT1001', message: 'Carrier qitexp request failed (503)' }]);
  });

  it('counts all numbers for a brand as failed when that brand has no credentials', async () => {
    const { repo } = repository([
      { id: 'row-1', freightForwarderInboundNumber: 'QT1001' },
      { id: 'row-2', freightForwarderInboundNumber: 'QT1002' },
    ]);
    const result = await syncFreightTracking({ tenantId: 'tenant-1', batchId: 'batch-3' }, {
      repository: repo,
      now: () => new Date('2026-10-23T00:00:00Z'),
      delayMs: 0,
      loadCredentials: async () => { throw new Error('No credentials configured for carrier qitexp'); },
      createClient: () => successfulClient(),
    });

    expect(result).toMatchObject({ matched: 2, queried: 0, failed: 2 });
    expect(result.errors[0].message).toBe('No credentials configured for carrier qitexp');
  });
});
