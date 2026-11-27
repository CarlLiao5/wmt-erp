/** Walmart order statuses counted as sales unless explicitly cancelled. */
export function isCancelledOrderStatus(status?: string | null): boolean {
  const normalized = status?.trim().toUpperCase();
  return normalized === 'CANCELLED' || normalized === 'CANCELED';
}
