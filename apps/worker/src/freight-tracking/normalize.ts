export interface NormalizedFreightTrackingEvent {
  routeOrder: number;
  eventTimeText: string;
  occurredAt: Date | null;
  info: string;
  eventCode: string;
  isCompleted: boolean | null;
  raw: unknown;
}

export interface NormalizedFreightTracking {
  currentStatus: 'none' | 'unknown' | 'in_progress' | 'delivered' | 'delivery_failed';
  currentStatusText: string;
  lastEventAt: Date | null;
  events: NormalizedFreightTrackingEvent[];
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function collectTrackingRows(payload: unknown): Record<string, unknown>[] | undefined {
  const root = asRecord(payload);
  const rows = root?.rows;
  if (!Array.isArray(rows)) return undefined;

  const components = rows.flatMap((row) => {
    const value = asRecord(row)?.components;
    return Array.isArray(value) ? value : [];
  });
  const trackingPanel = components.find((component) => asRecord(component)?.comKey === 'tms-csos-shipment-tracking');
  if (!trackingPanel) return undefined;

  const data = asRecord(asRecord(trackingPanel)?.data);
  const direct = data?.dataSource;
  if (Array.isArray(direct)) return direct.map(asRecord).filter((row): row is Record<string, unknown> => Boolean(row));

  const bodyComponents = asRecord(data?.body)?.components;
  if (!Array.isArray(bodyComponents)) return undefined;
  const nested = bodyComponents
    .map((component) => asRecord(asRecord(component)?.data)?.dataSource)
    .find(Array.isArray);
  if (!Array.isArray(nested)) return undefined;
  return nested.map(asRecord).filter((row): row is Record<string, unknown> => Boolean(row));
}

function stringValue(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return String(value);
  return '';
}

function parseEventDate(value: string): Date | null {
  if (!value) return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    const millis = numeric < 100_000_000_000 ? numeric * 1000 : numeric;
    const date = new Date(millis);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const normalized = value.replace(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})/, '$1T$2');
  const millis = Date.parse(normalized);
  return Number.isNaN(millis) ? null : new Date(millis);
}

function completionFlag(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === '1') return true;
  if (value === 0 || value === '0') return false;
  return null;
}

function classifyStatus(info: string, eventCode: string): NormalizedFreightTracking['currentStatus'] {
  const text = `${info} ${eventCode}`;
  if (/已签收|签收成功|已送达|已交付|\bPOD\b|delivered/i.test(text)) return 'delivered';
  if (/派送失败|客户拒收|拒收|改派|退回|无法派送|delivery\s*failed|delivery\s*attempt/i.test(text)) return 'delivery_failed';
  return 'in_progress';
}

export function normalizeTrackingPayload(payload: unknown): NormalizedFreightTracking {
  const rows = collectTrackingRows(payload);
  if (!rows) throw new Error('tracking events missing or payload shape is invalid');

  const events = rows.map((row, index) => {
    const eventTimeText = stringValue(row.title);
    const info = stringValue(row.info);
    const eventCode = stringValue(row.event);
    const isCompleted = completionFlag(row.isCompleted ?? asRecord(row._raw)?.isMake);
    return {
      routeOrder: index + 1,
      eventTimeText,
      occurredAt: parseEventDate(eventTimeText),
      info,
      eventCode,
      isCompleted,
      raw: row,
    };
  });

  if (!events.length) {
    return { currentStatus: 'none', currentStatusText: '无轨迹', lastEventAt: null, events };
  }

  const hasCompletionFlags = events.some((event) => event.isCompleted !== null);
  const occurred = events.filter((event) => event.occurredAt !== null && (!hasCompletionFlags || event.isCompleted === true));
  if (!occurred.length) {
    return { currentStatus: 'unknown', currentStatusText: '尚无已完成节点', lastEventAt: null, events };
  }
  const latest = occurred.reduce<NormalizedFreightTrackingEvent | undefined>((current, event) =>
    !current || event.occurredAt!.getTime() > current.occurredAt!.getTime() ? event : current, undefined);
  if (!latest) return { currentStatus: 'unknown', currentStatusText: '未知状态', lastEventAt: null, events };

  const statusText = [latest.eventTimeText, latest.info].filter(Boolean).join(' ') || classifyStatus(latest.info, latest.eventCode);
  return {
    currentStatus: classifyStatus(latest.info, latest.eventCode),
    currentStatusText: statusText.slice(0, 200),
    lastEventAt: latest.occurredAt,
    events,
  };
}
