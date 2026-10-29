import { datetime, decimal, index, int, json, mysqlTable, text, unique, varchar } from 'drizzle-orm/mysql-core';

export const weatherSnapshots = mysqlTable('weather_snapshots', {
  id: varchar('id', { length: 36 }).primaryKey(),
  stateCode: varchar('state_code', { length: 2 }).notNull(),
  source: varchar('source', { length: 32 }).notNull(),
  observedAt: datetime('observed_at', { mode: 'date', fsp: 3 }),
  metric: varchar('metric', { length: 64 }).notNull(),
  value: decimal('value', { precision: 12, scale: 4 }),
  unit: varchar('unit', { length: 16 }),
  sourceUpdatedAt: datetime('source_updated_at', { mode: 'date', fsp: 3 }),
  cacheExpiresAt: datetime('cache_expires_at', { mode: 'date', fsp: 3 }),
  rawPayload: json('raw_payload'),
  createdAt: datetime('created_at', { mode: 'date', fsp: 3 }).notNull(),
}, (table) => [index('weather_snapshots_state_time_idx').on(table.stateCode, table.observedAt), index('weather_snapshots_source_idx').on(table.source, table.sourceUpdatedAt)]);

export const weatherForecasts = mysqlTable('weather_forecasts', {
  id: varchar('id', { length: 36 }).primaryKey(),
  stateCode: varchar('state_code', { length: 2 }).notNull(),
  source: varchar('source', { length: 32 }).notNull().default('nws'),
  forecastAt: datetime('forecast_at', { mode: 'date', fsp: 3 }).notNull(),
  validFrom: datetime('valid_from', { mode: 'date', fsp: 3 }).notNull(),
  validTo: datetime('valid_to', { mode: 'date', fsp: 3 }),
  temperature: decimal('temperature', { precision: 8, scale: 2 }),
  precipitationProbability: decimal('precipitation_probability', { precision: 5, scale: 2 }),
  unit: varchar('unit', { length: 8 }),
  condition: varchar('condition', { length: 128 }),
  rawPayload: json('raw_payload'),
  cacheExpiresAt: datetime('cache_expires_at', { mode: 'date', fsp: 3 }),
  createdAt: datetime('created_at', { mode: 'date', fsp: 3 }).notNull(),
}, (table) => [unique('weather_forecasts_state_valid_unique').on(table.stateCode, table.validFrom, table.source), index('weather_forecasts_state_time_idx').on(table.stateCode, table.validFrom)]);

export const climateOutlooks = mysqlTable('climate_outlooks', {
  id: varchar('id', { length: 36 }).primaryKey(),
  stateCode: varchar('state_code', { length: 2 }).notNull(),
  source: varchar('source', { length: 32 }).notNull().default('noaa-cpc'),
  period: varchar('period', { length: 32 }).notNull(),
  validFrom: datetime('valid_from', { mode: 'date', fsp: 3 }),
  validTo: datetime('valid_to', { mode: 'date', fsp: 3 }),
  temperatureAboveNormal: decimal('temperature_above_normal', { precision: 5, scale: 2 }),
  temperatureNearNormal: decimal('temperature_near_normal', { precision: 5, scale: 2 }),
  temperatureBelowNormal: decimal('temperature_below_normal', { precision: 5, scale: 2 }),
  precipitationAboveNormal: decimal('precipitation_above_normal', { precision: 5, scale: 2 }),
  precipitationNearNormal: decimal('precipitation_near_normal', { precision: 5, scale: 2 }),
  precipitationBelowNormal: decimal('precipitation_below_normal', { precision: 5, scale: 2 }),
  rawPayload: json('raw_payload'),
  cacheExpiresAt: datetime('cache_expires_at', { mode: 'date', fsp: 3 }),
  createdAt: datetime('created_at', { mode: 'date', fsp: 3 }).notNull(),
}, (table) => [unique('climate_outlooks_state_period_unique').on(table.stateCode, table.source, table.period, table.validFrom), index('climate_outlooks_state_period_idx').on(table.stateCode, table.validFrom)]);

export const weatherRequestStatus = mysqlTable('weather_request_status', {
  id: varchar('id', { length: 36 }).primaryKey(),
  stateCode: varchar('state_code', { length: 2 }).notNull(),
  source: varchar('source', { length: 32 }).notNull(),
  requestType: varchar('request_type', { length: 32 }).notNull(),
  status: varchar('status', { length: 24 }).notNull(),
  httpStatus: int('http_status'),
  attempts: int('attempts').notNull().default(0),
  requestedAt: datetime('requested_at', { mode: 'date', fsp: 3 }).notNull(),
  completedAt: datetime('completed_at', { mode: 'date', fsp: 3 }),
  errorMessage: text('error_message'),
}, (table) => [index('weather_request_status_state_time_idx').on(table.stateCode, table.requestedAt), index('weather_request_status_source_idx').on(table.source, table.status)]);
