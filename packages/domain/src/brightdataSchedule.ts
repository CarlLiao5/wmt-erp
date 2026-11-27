export const BRIGHTDATA_SCHEDULE_TIME_ZONE = 'Asia/Shanghai';
export const BRIGHTDATA_SCHEDULE_HOUR = 16;
const CHINA_UTC_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export function brightDataScheduleDay(value: Date): string {
  return new Date(value.getTime() + CHINA_UTC_OFFSET_MS).toISOString().slice(0, 10);
}

export function nextBrightDataRunAt(now: Date): Date {
  const chinaNow = new Date(now.getTime() + CHINA_UTC_OFFSET_MS);
  const targetChina = Date.UTC(chinaNow.getUTCFullYear(), chinaNow.getUTCMonth(), chinaNow.getUTCDate(), BRIGHTDATA_SCHEDULE_HOUR);
  const nextChina = chinaNow.getTime() < targetChina ? targetChina : targetChina + DAY_MS;
  return new Date(nextChina - CHINA_UTC_OFFSET_MS);
}
