const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

function isValidDate(value?: string) {
  if (!value) return true;
  const match = DATE_ONLY.exec(value);
  if (!match) return false;
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return date.getUTCFullYear() === Number(year) && date.getUTCMonth() === Number(month) - 1 && date.getUTCDate() === Number(day);
}

export function dateRangeError(from?: string, to?: string): string | null {
  if (!isValidDate(from) || !isValidDate(to)) return '日期格式无效';
  if (from && to && from > to) return '开始日期不能晚于结束日期';
  return null;
}

export function inclusiveDateEnd(value?: string): Date | undefined {
  if (!value) return undefined;
  const match = DATE_ONLY.exec(value);
  if (!match) return undefined;
  const [, year, month, day] = match;
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), 23, 59, 59, 999));
}
