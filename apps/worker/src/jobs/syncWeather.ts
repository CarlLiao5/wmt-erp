import { randomUUID } from 'node:crypto';
import { createDb, weatherForecasts, weatherSnapshots, climateOutlooks } from '../../../../packages/db/index.js';
import { fetchStateWeather, fetchStateClimate, type ClimatePeriod } from '../../../api/src/weather/weatherClient.js';
import type { USStateConfig } from '../../../../packages/domain/src/usStates.js';

export interface WeatherSyncRequest { state: USStateConfig; period?: ClimatePeriod; }
export async function syncWeatherToDatabase(request: WeatherSyncRequest): Promise<unknown> {
  const snapshot = await fetchStateWeather(request.state);
  if (!process.env.MYSQL_URL) return snapshot;
  const { db, pool } = createDb();
  try {
    const now = new Date();
    await db.insert(weatherSnapshots).values({ id: randomUUID(), stateCode: request.state.code, source: 'nws', observedAt: snapshot.observedAt, metric: 'current', value: null, unit: null, sourceUpdatedAt: now, cacheExpiresAt: new Date(now.getTime() + 900_000), rawPayload: snapshot.raw, createdAt: now });
    if (request.period) { const climate = await fetchStateClimate(request.state, request.period); await db.insert(climateOutlooks).values({ id: randomUUID(), stateCode: request.state.code, source: 'noaa-cpc', period: request.period, rawPayload: climate.raw, createdAt: now, cacheExpiresAt: new Date(now.getTime() + 21_600_000) }); }
    return snapshot;
  } finally { await pool.end(); }
}
