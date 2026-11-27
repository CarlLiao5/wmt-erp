export interface OrderWindow {
  from: string;
  to: string;
  maxQueryResults: number;
}

export interface OrderWindowProbe {
  totalCount?: number;
  limitExceeded?: boolean;
}

const DAY_MS = 86_400_000;
const dateOnly = (date: Date): string => date.toISOString().slice(0, 10);
const parseDate = (value: string): Date => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime())) throw new Error(`Invalid order window date: ${value}`);
  return parsed;
};

export function planOrderWindows(input: { now: Date; oldestAllowedDays: number; maxQueryResults: number; initialWindowDays: number }): OrderWindow[] {
  if (input.oldestAllowedDays < 0 || input.initialWindowDays <= 0 || input.maxQueryResults <= 0) throw new Error('Order window limits must be positive');
  const end = dateOnly(input.now);
  const oldest = new Date(Date.UTC(input.now.getUTCFullYear(), input.now.getUTCMonth(), input.now.getUTCDate()));
  oldest.setTime(oldest.getTime() - input.oldestAllowedDays * DAY_MS);
  const windows: OrderWindow[] = [];
  let from = oldest;
  const finalDate = parseDate(end);
  while (from <= finalDate) {
    const candidateEnd = new Date(Math.min(from.getTime() + (input.initialWindowDays - 1) * DAY_MS, finalDate.getTime()));
    windows.push({ from: dateOnly(from), to: dateOnly(candidateEnd), maxQueryResults: input.maxQueryResults });
    from = new Date(candidateEnd.getTime() + DAY_MS);
  }
  return windows;
}

export function refineOrderWindow(window: OrderWindow, probe: OrderWindowProbe): OrderWindow[] {
  if (!probe.limitExceeded && (probe.totalCount ?? 0) <= window.maxQueryResults) return [window];
  const from = parseDate(window.from);
  const to = parseDate(window.to);
  const dayCount = Math.floor((to.getTime() - from.getTime()) / DAY_MS) + 1;
  if (dayCount < 2) throw new Error(`Order window still exceeds ${window.maxQueryResults} results for ${window.from}`);
  const leftDays = Math.floor(dayCount / 2);
  const leftTo = new Date(from.getTime() + (leftDays - 1) * DAY_MS);
  const rightFrom = new Date(leftTo.getTime() + DAY_MS);
  return [
    { ...window, from: dateOnly(from), to: dateOnly(leftTo) },
    { ...window, from: dateOnly(rightFrom), to: dateOnly(to) },
  ];
}
