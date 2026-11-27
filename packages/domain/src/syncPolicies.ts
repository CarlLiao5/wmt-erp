export interface IncrementalSyncPolicy {
  intervalMinutes: number;
  overlapDays: number;
}

export const INCREMENTAL_SYNC_POLICIES: Readonly<Record<string, IncrementalSyncPolicy>> = {
  'inventory-recon': { intervalMinutes: 43200, overlapDays: 31 },
  orders: { intervalMinutes: 15, overlapDays: 5 },
  returns: { intervalMinutes: 60, overlapDays: 5 },
  'wfs-inbound-preview': { intervalMinutes: 1440, overlapDays: 5 },
  inventory: { intervalMinutes: 360, overlapDays: 5 },
  'storage-fees': { intervalMinutes: 1440, overlapDays: 5 },
  pricing: { intervalMinutes: 1440, overlapDays: 5 },
  'item-report': { intervalMinutes: 4320, overlapDays: 5 },
  'head-freight': { intervalMinutes: 1440, overlapDays: 5 },
  'smart-sheet-allsku2026': { intervalMinutes: 10080, overlapDays: 5 },
  'freight-tracking': { intervalMinutes: 1440, overlapDays: 5 },
  'lingxing-advertising': { intervalMinutes: 1440, overlapDays: 5 },
  'lingxing-head-freight-costs': { intervalMinutes: 10080, overlapDays: 5 },
  weather: { intervalMinutes: 720, overlapDays: 0 },
  'advertising-sem': { intervalMinutes: 360, overlapDays: 5 },
  'advertising-sem-items': { intervalMinutes: 1440, overlapDays: 5 },
  'advertising-sem-performance': { intervalMinutes: 360, overlapDays: 5 },
  'advertising-sem-search-terms': { intervalMinutes: 360, overlapDays: 5 },
  performance: { intervalMinutes: 1440, overlapDays: 5 },
};

const FIXED_DAILY_UTC_HOURS: Readonly<Record<string, number>> = {
  'head-freight@__tenant__': 12,
  'freight-tracking@__tenant__': 3,
  'lingxing-advertising@__tenant__': 12,
};

const FIXED_WEEKLY_RESOURCES = new Set(['smart-sheet-allsku2026@__tenant__', 'lingxing-head-freight-costs@__tenant__']);

function nextFixedRunAt(resource: string, now: Date, storeId?: string): Date | undefined {
  if (resource === 'inventory-recon') {
    for (let offset = 0; offset < 2; offset++) {
      for (const day of [2, 8]) {
        const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, day, 4));
        if (next > now) return next;
      }
    }
  }
  const scheduleKey = `${resource}@${storeId ?? ''}`;
  const fixedHour = FIXED_DAILY_UTC_HOURS[scheduleKey];
  if (fixedHour !== undefined) {
    const next = new Date(now);
    next.setUTCHours(fixedHour, 0, 0, 0);
    if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
    return next;
  }
  if (FIXED_WEEKLY_RESOURCES.has(scheduleKey)) {
    const next = new Date(now);
    next.setUTCHours(12, 0, 0, 0);
    const daysUntilFriday = (5 - next.getUTCDay() + 7) % 7;
    next.setUTCDate(next.getUTCDate() + daysUntilFriday);
    if (next <= now) next.setUTCDate(next.getUTCDate() + 7);
    return next;
  }
  return undefined;
}

export function nextScheduledRunAt(resource: string, now = new Date(), previousRunAt?: Date, intervalMinutes?: number, storeId?: string): Date {
  const fixed = nextFixedRunAt(resource, now, storeId);
  if (fixed) return fixed;
  const policy = INCREMENTAL_SYNC_POLICIES[resource];
  if (!policy) return new Date(now.getTime());
  const intervalMs = Math.max(1, intervalMinutes ?? policy.intervalMinutes) * 60_000;
  const anchor = previousRunAt?.getTime() ?? now.getTime();
  if (anchor > now.getTime()) return new Date(anchor);
  const missedIntervals = Math.floor((now.getTime() - anchor) / intervalMs) + 1;
  return new Date(anchor + missedIntervals * intervalMs);
}

export function incrementalSyncPolicy(resource: string): IncrementalSyncPolicy | undefined {
  return INCREMENTAL_SYNC_POLICIES[resource];
}
