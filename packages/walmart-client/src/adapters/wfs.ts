import { paginate } from '../pagination.js';
import type { WalmartConnection } from '../types.js';

const allShipmentHistoryFrom = '2000-01-01T00:00:00.000Z';

export const listWfsShipments = (connection: WalmartConnection, query: Record<string, string> = {}, fetcher?: typeof fetch) => paginate<unknown>(
  connection,
  '/v3/fulfillment/inbound-shipments',
  {
    fromCreateDate: allShipmentHistoryFrom,
    toCreateDate: new Date().toISOString(),
    offset: '0',
    limit: '50',
    ...query,
  },
  fetcher,
);

export const listWfsShipmentItems = (connection: WalmartConnection, query: Record<string, string> = {}) => paginate<unknown>(
  connection,
  '/v3/fulfillment/inbound-shipment-items',
  { offset: '0', limit: '10', ...query },
);
