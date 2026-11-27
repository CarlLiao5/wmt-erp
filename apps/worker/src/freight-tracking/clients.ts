import { normalizeFreightNumber, type FreightCarrierBrand } from './brands.js';
import type { FreightCarrierCredentials } from './credentials.js';

export interface CarrierTrackingResponse {
  matched: boolean;
  trackingPayload?: unknown;
  rawPayload?: unknown;
}

export interface FreightCarrierClient {
  fetchTracking(inboundNumber: string): Promise<CarrierTrackingResponse>;
}

type JsonRecord = Record<string, unknown>;

class CarrierRequestError extends Error {
  constructor(readonly brand: FreightCarrierBrand, readonly path: string, readonly status?: number) {
    super(status ? `Carrier ${brand} request failed (${status}) at ${path}` : `Carrier ${brand} request failed at ${path}`);
    this.name = 'CarrierRequestError';
  }
}

class AuthenticationExpiredError extends CarrierRequestError {
  constructor(brand: FreightCarrierBrand, path: string) {
    super(brand, path, 401);
    this.name = 'AuthenticationExpiredError';
  }
}

function record(value: unknown): JsonRecord | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : undefined;
}

function urlAt(base: string, path: string): string {
  return new URL(path, base).toString();
}

function htmlText(value: unknown): string {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  return String(value).replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').trim();
}

function requestHeaders(headers: HeadersInit | undefined, token?: string): Headers {
  const result = new Headers(headers);
  result.set('Accept', 'application/json');
  if (token) result.set('token', token);
  return result;
}

async function requestJson(fetcher: typeof fetch, brand: FreightCarrierBrand, baseUrl: string, path: string, init: RequestInit = {}, timeoutMs = 25_000): Promise<JsonRecord> {
  const url = urlAt(baseUrl, path);
  let response: Response;
  try {
    response = await fetcher(url, { ...init, headers: requestHeaders(init.headers), signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    throw new CarrierRequestError(brand, path);
  }
  if (!response.ok) {
    if (response.status === 401) throw new AuthenticationExpiredError(brand, path);
    throw new CarrierRequestError(brand, path, response.status);
  }
  try {
    const value: unknown = await response.json();
    const parsed = record(value);
    if (!parsed) throw new Error('invalid json object');
    return parsed;
  } catch {
    throw new CarrierRequestError(brand, path, response.status);
  }
}

class QitexpFamilyClient implements FreightCarrierClient {
  private token: string | undefined;
  private tokenAt = 0;
  private readonly loginBase: string;
  private readonly apiBase: string;

  constructor(private readonly config: FreightCarrierCredentials, private readonly fetcher: typeof fetch, private readonly timeoutMs: number) {
    this.loginBase = config.loginUrl;
    this.apiBase = config.searchUrl || config.loginUrl;
  }

  async fetchTracking(inboundNumber: string): Promise<CarrierTrackingResponse> {
    return this.withSession(async (token) => {
      const search = await requestJson(this.fetcher, this.config.brand, this.apiBase, '/rest/tms/wos/shipment/lists', {
        method: 'POST', headers: { 'Content-Type': 'application/json;charset=utf-8', token },
        body: JSON.stringify({ timeLimit: 0, page: 1, activeTab: 'all', keywords: inboundNumber, isActiveTab: 'all', scenes: 1 }),
      }, this.timeoutMs);
      this.ensureQitexpSuccess(search, '/rest/tms/wos/shipment/lists');
      const data = record(search.data);
      const components = record(data?.components);
      const gridView = record(components?.gridView);
      const table = record(gridView?.table);
      const rows = Array.isArray(table?.dataSource) ? table!.dataSource.map(record).filter((row): row is JsonRecord => Boolean(row)) : [];
      if (!rows.length) return { matched: false };

      const hits = rows.map((row) => ({
        id: String(row.id ?? ''),
        number: htmlText(row.shipment_number ?? row.shipment_id),
      })).filter((row) => row.id && row.number);
      const target = normalizeFreightNumber(inboundNumber);
      const exact = hits.filter((hit) => normalizeFreightNumber(hit.number) === target);
      const hit = exact.length === 1 ? exact[0] : hits.length === 1 ? hits[0] : undefined;
      if (!hit) throw new CarrierRequestError(this.config.brand, '/rest/tms/wos/shipment/lists');

      const detail = await requestJson(this.fetcher, this.config.brand, this.apiBase, `/rest/tms/wos/shipment/view?id=${encodeURIComponent(hit.id)}`, { method: 'GET', headers: { token } }, this.timeoutMs);
      this.ensureQitexpSuccess(detail, '/rest/tms/wos/shipment/view');
      const detailData = record(detail.data);
      if (!detailData) throw new CarrierRequestError(this.config.brand, '/rest/tms/wos/shipment/view');
      const trackingPanel = (Array.isArray(detailData.rows) ? detailData.rows : [])
        .flatMap((row) => {
          const components = record(row)?.components;
          return Array.isArray(components) ? components : [];
        })
        .map(record)
        .find((component) => component?.comKey === 'tms-csos-shipment-tracking');
      const panelBody = record(record(trackingPanel?.data)?.body);
      const trackingComponent = Array.isArray(panelBody?.components)
        ? panelBody.components.map(record).find((component) => component?.com === 'tracking')
        : undefined;
      const trackingUrl = typeof record(trackingComponent?.data)?.url === 'string'
        ? String(record(trackingComponent?.data)?.url)
        : '';
      if (trackingUrl) {
        const trackingPath = trackingUrl.startsWith('/rest/') ? trackingUrl : `/rest${trackingUrl}`;
        const tracking = await requestJson(this.fetcher, this.config.brand, this.apiBase, trackingPath, {
          method: 'GET', headers: { token },
        }, this.timeoutMs);
        const events = Array.isArray(tracking.data) ? tracking.data : [];
        if (events.length) {
          const enriched = { rows: [{ components: [{ comKey: 'tms-csos-shipment-tracking', data: { dataSource: events } }] }] };
          return { matched: true, trackingPayload: enriched, rawPayload: { detail: detailData, tracking } };
        }
      }
      return { matched: true, trackingPayload: detailData, rawPayload: detailData };
    });
  }

  private async withSession<T>(fn: (token: string) => Promise<T>): Promise<T> {
    if (!this.token || Date.now() - this.tokenAt > 1_800_000) await this.login();
    try {
      return await fn(this.token!);
    } catch (error) {
      if (!(error instanceof AuthenticationExpiredError)) throw error;
      await this.login(true);
      return fn(this.token!);
    }
  }

  private async login(force = false): Promise<void> {
    if (!force && this.token && Date.now() - this.tokenAt <= 1_800_000) return;
    const result = await requestJson(this.fetcher, this.config.brand, this.loginBase, '/rest/tms/wos/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json;charset=utf-8' },
      body: JSON.stringify({ username: this.config.username, password: this.config.password }),
    }, this.timeoutMs);
    const data = record(result.data);
    const token = typeof data?.token === 'string' ? data.token : '';
    if (result.success !== 1 || !token) throw new Error(`Carrier ${this.config.brand} authentication failed`);
    this.token = token;
    this.tokenAt = Date.now();
  }

  private ensureQitexpSuccess(value: JsonRecord, path: string): void {
    if (value.success === 1) return;
    const message = typeof value.info === 'string' ? value.info.toLowerCase() : '';
    if (/token|登录|未登录|auth/.test(message)) throw new AuthenticationExpiredError(this.config.brand, path);
    throw new CarrierRequestError(this.config.brand, path);
  }
}

class DesuClient implements FreightCarrierClient {
  private token: string | undefined;
  private codeToId: Map<string, string> | undefined;
  private readonly baseUrl: string;

  constructor(private readonly config: FreightCarrierCredentials, private readonly fetcher: typeof fetch, private readonly timeoutMs: number) {
    this.baseUrl = new URL(config.loginUrl).origin;
  }

  async fetchTracking(inboundNumber: string): Promise<CarrierTrackingResponse> {
    await this.login();
    const ids = await this.loadOrderIds();
    const orderId = ids.get(normalizeFreightNumber(inboundNumber));
    if (!orderId) return { matched: false };

    const [detail, tracking] = await Promise.all([
      this.request('/api/order/details', { method: 'GET', headers: this.authHeaders() }, { orderId }),
      this.fetchTrackingEvents(orderId),
    ]);
    if (detail.code !== 200 || tracking.code !== 200) throw new CarrierRequestError('desu', '/api/order/details or /api/status/track');
    const events = Array.isArray(tracking.data) ? tracking.data.map(record).filter((row): row is JsonRecord => Boolean(row)) : [];
    const shapedRows = events.map((event) => {
      const dateText = String(event.trackDate ?? '');
      const description = String(event.statusDecl ?? '');
      const remark = String(event.remark ?? '');
      const isCompleted = typeof event.isMake === 'boolean'
        ? event.isMake
        : event.isMake === 1 || event.isMake === '1'
          ? true
          : event.isMake === 0 || event.isMake === '0'
            ? false
            : null;
      return { title: dateText, info: [description, remark].filter(Boolean).join(' - '), event: String(event.status ?? ''), isCompleted, _raw: event };
    });
    const trackingPayload = {
      _brand: 'desu',
      rows: [{ components: [{ comKey: 'tms-csos-shipment-tracking', data: { body: { components: [{ data: { dataSource: shapedRows } }] } } }] }],
    };
    return { matched: true, trackingPayload, rawPayload: { detail: detail.data, tracking } };
  }

  private async login(): Promise<void> {
    if (this.token) return;
    const value = await requestJson(this.fetcher, 'desu', this.baseUrl, '/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json;charset=utf-8' },
      body: JSON.stringify({ account: this.config.username, password: this.config.password }),
    }, this.timeoutMs);
    const data = record(value.data);
    const token = typeof data?.token === 'string' ? data.token : '';
    if (value.code !== 200 || !token) throw new Error('Carrier desu authentication failed');
    this.token = token;
  }

  private async request(path: string, init: RequestInit = {}, query: Record<string, string> = {}): Promise<JsonRecord> {
    const url = new URL(path, this.baseUrl);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    const response = await requestJson(this.fetcher, 'desu', url.origin, `${url.pathname}${url.search}`, init, this.timeoutMs);
    if (response.code !== 200) throw new CarrierRequestError('desu', path);
    return response;
  }

  private authHeaders(): HeadersInit {
    return { token: this.token ?? '' };
  }

  private async loadOrderIds(): Promise<Map<string, string>> {
    if (this.codeToId) return this.codeToId;
    const result = new Map<string, string>();
    const pageSize = 50;
    let page = 1;
    let total = Number.POSITIVE_INFINITY;
    const pageFingerprints = new Set<string>();
    while (true) {
      const data = await this.request('/api/order/page', {
        method: 'POST', headers: { ...this.authHeaders(), 'Content-Type': 'application/json;charset=utf-8' },
        body: JSON.stringify({ current: page, size: pageSize }),
      });
      const payload = record(data.data);
      const rows = Array.isArray(payload?.records) ? payload.records.map(record).filter((row): row is JsonRecord => Boolean(row)) : [];
      total = Number(payload?.total ?? 0);
      if (!rows.length) break;
      const fingerprint = rows.map((row) => `${row.id ?? ''}:${row.orderCode ?? ''}`).join('|');
      if (pageFingerprints.has(fingerprint)) throw new CarrierRequestError('desu', '/api/order/page');
      pageFingerprints.add(fingerprint);
      for (const row of rows) {
        const code = typeof row.orderCode === 'string' ? normalizeFreightNumber(row.orderCode) : '';
        const id = row.id === undefined || row.id === null ? '' : String(row.id);
        if (code && id) result.set(code, id);
      }
      if (total === 0 || page * pageSize >= total) break;
      page += 1;
    }
    this.codeToId = result;
    return result;
  }

  private async fetchTrackingEvents(orderId: string): Promise<JsonRecord> {
    const body = new FormData();
    body.set('orderId', orderId);
    return this.request('/api/status/track', { method: 'POST', headers: this.authHeaders(), body });
  }
}

export function createFreightCarrierClient(config: FreightCarrierCredentials, fetcher: typeof fetch = fetch, timeoutMs = 25_000): FreightCarrierClient {
  return config.brand === 'desu'
    ? new DesuClient(config, fetcher, timeoutMs)
    : new QitexpFamilyClient(config, fetcher, timeoutMs);
}
