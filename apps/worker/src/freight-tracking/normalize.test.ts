import { describe, expect, it } from 'vitest';
import { normalizeTrackingPayload } from './normalize.js';

const panel = (events: Array<Record<string, unknown>>) => ({
  rows: [{ components: [{
    comKey: 'tms-csos-shipment-tracking',
    data: { body: { components: [{ data: { dataSource: events } }] } },
  }] }],
});

describe('normalizeTrackingPayload', () => {
  it('keeps source order and raw events while selecting the latest occurred event', () => {
    const normalized = normalizeTrackingPayload(panel([
      { title: '2026-10-20 09:00:00', info: '货物已揽收', event: 'PICKUP' },
      { title: '2026-10-21 10:30:00', info: '货物已签收', event: 'POD' },
      { title: '', info: '等待预约', event: 'WAIT', _raw: { planned: true } },
    ]));

    expect(normalized.currentStatus).toBe('delivered');
    expect(normalized.currentStatusText).toBe('2026-10-21 10:30:00 货物已签收');
    expect(normalized.events).toHaveLength(3);
    expect(normalized.events[0].eventCode).toBe('PICKUP');
    expect(normalized.events[2].occurredAt).toBeNull();
    expect(normalized.events[2].raw).toEqual({ title: '', info: '等待预约', event: 'WAIT', _raw: { planned: true } });
  });

  it('does not invent an event time or delivered status for an empty event list', () => {
    const normalized = normalizeTrackingPayload(panel([]));

    expect(normalized.currentStatus).toBe('none');
    expect(normalized.currentStatusText).toBe('无轨迹');
    expect(normalized.lastEventAt).toBeNull();
    expect(normalized.events).toEqual([]);
  });

  it('uses the last completed Desu node and keeps later planned nodes out of current status', () => {
    const normalized = normalizeTrackingPayload(panel([
      { title: '2026-10-20 09:00:00', info: '已揽收', event: 'PICKUP', isCompleted: true },
      { title: '2026-10-25 09:00:00', info: '待签收', event: 'POD', isCompleted: false },
    ]));
    expect(normalized.currentStatusText).toContain('2026-10-20');
    expect(normalized.lastEventAt?.toISOString()).toContain('2026-10-20');
    expect(normalized.events[1].isCompleted).toBe(false);
  });

  it('rejects an unknown payload shape instead of treating a parse error as empty tracking', () => {
    expect(() => normalizeTrackingPayload({ unrelated: [] })).toThrow('tracking events missing');
  });
});
