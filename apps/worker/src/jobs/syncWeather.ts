import { randomUUID } from 'node:crypto';
import { createDb, weatherForecasts, weatherSnapshots, climateOutlooks, weatherRequestStatus } from '../../../../packages/db/index.js';
import { fetchStateWeather, fetchStateClimate, type ClimatePeriod } from '../../../api/src/weather/weatherClient.js';
import type { USStateConfig } from '../../../../packages/domain/src/usStates.js';

export interface WeatherSyncRequest { state: USStateConfig; period?: ClimatePeriod; }

export async function syncWeatherToDatabase(request: WeatherSyncRequest): Promise<unknown> {
  if (!request.state?.code) throw new Error('Weather state is required');
  const period = request.period ?? '8-14-day';
  const started = new Date();
  const snapshot = await fetchStateWeather(request.state);
  if (!process.env.MYSQL_URL) return snapshot;

  const { db, pool } = createDb();
  try {
    const now = new Date();
    const observed = snapshot.current.temperature as { value?: unknown; unitCode?: unknown } | undefined;
    await db.insert(weatherRequestStatus).values({ id: randomUUID(), stateCode: request.state.code, source: 'nws', requestType: 'weather', status: 'completed', httpStatus: 200, attempts: 1, requestedAt: started, completedAt: now });
    await db.insert(weatherSnapshots).values({
      id: randomUUID(), stateCode: request.state.code, source: 'nws', observedAt: snapshot.observedAt,
      metric: 'temperature', value: typeof observed?.value === 'number' ? String(observed.value) : null,
      unit: typeof observed?.unitCode === 'string' ? observed.unitCode.replace(/^wmoUnit:/, '') : null,
      sourceUpdatedAt: now, cacheExpiresAt: new Date(now.getTime() + 600000), rawPayload: snapshot.raw, createdAt: now,
    });

    const uniqueForecasts = new Map<number, { raw: unknown; properties: any; validFrom: Date }>();
    for (const raw of snapshot.forecast) {
      const properties = (raw as any).properties ?? raw;
      const validFrom = new Date(properties.startTime ?? now);
      if (!Number.isNaN(validFrom.getTime())) uniqueForecasts.set(validFrom.getTime(), { raw, properties, validFrom });
    }
    for (const { raw, properties, validFrom } of uniqueForecasts.values()) {
      const values = {
        forecastAt: now, validTo: properties.endTime ? new Date(properties.endTime) : null,
        temperature: properties.temperature ?? null, precipitationProbability: properties.probabilityOfPrecipitation?.value ?? null,
        unit: properties.temperatureUnit ?? null, condition: properties.shortForecast ?? null,
        rawPayload: raw, cacheExpiresAt: new Date(now.getTime() + 1800000), createdAt: now,
      };
      await db.insert(weatherForecasts).values({ id: randomUUID(), stateCode: request.state.code, source: 'nws', validFrom, ...values }).onDuplicateKeyUpdate({ set: values });
    }

    let climateStatus: 'completed' | 'failed' | 'not-requested' = 'not-requested';
    if (period) {
      const climateStarted = new Date();
      try {
        const climate = await fetchStateClimate(request.state, period, { minRequestIntervalMs: 250 });
        const t = climate.temperature;
        const p = climate.precipitation;
        const values = {
          stateCode: request.state.code, source: 'noaa-cpc', period,
          validFrom: climate.validFrom ?? null, validTo: climate.validTo ?? null,
          temperatureAboveNormal: t.aboveNormal === undefined ? null : String(t.aboveNormal),
          temperatureNearNormal: t.nearNormal === undefined ? null : String(t.nearNormal),
          temperatureBelowNormal: t.belowNormal === undefined ? null : String(t.belowNormal),
          precipitationAboveNormal: p.aboveNormal === undefined ? null : String(p.aboveNormal),
          precipitationNearNormal: p.nearNormal === undefined ? null : String(p.nearNormal),
          precipitationBelowNormal: p.belowNormal === undefined ? null : String(p.belowNormal),
          rawPayload: climate.raw, createdAt: now, cacheExpiresAt: new Date(now.getTime() + 86400000),
        };
        await db.insert(climateOutlooks).values({ id: randomUUID(), ...values }).onDuplicateKeyUpdate({ set: values });
        await db.insert(weatherRequestStatus).values({ id: randomUUID(), stateCode: request.state.code, source: 'noaa-cpc', requestType: 'climate', status: 'completed', httpStatus: 200, attempts: 1, requestedAt: climateStarted, completedAt: new Date() });
        climateStatus = 'completed';
      } catch (error) {
        await db.insert(weatherRequestStatus).values({ id: randomUUID(), stateCode: request.state.code, source: 'noaa-cpc', requestType: 'climate', status: 'failed', httpStatus: null, attempts: 1, requestedAt: climateStarted, completedAt: new Date(), errorMessage: error instanceof Error ? error.message : String(error) });
        climateStatus = 'failed';
      }
    }
    return { weather: snapshot, climateStatus };
  } finally {
    await pool.end();
  }
}
