# Task 2 report

Implemented NWS/NOAA weather client, Redis-compatible cache-aside helpers, and independent `weather-sync` BullMQ worker queue.

- NWS points, forecast, hourly, observations, and active alerts with User-Agent and bounded 429 retry.
- NOAA NCEI climate fetch via `fetchStateClimate`.
- In-memory and Redis JSON TTL cache implementations.
- Worker persists weather snapshots and optional climate outlooks when MySQL is configured.
- Weather queue is isolated from commerce queues with concurrency 1.

Verification: `pnpm --filter @walmart-erp/api exec vitest run src/weather/weatherClient.test.ts` passed; worker typecheck passed.

## Review fixes

- Added CPC period adapters for 6-10 day, 8-14 day, monthly, and seasonal outlooks, state validation, climate TTL, and NCEI-independent CPC URLs.
- Added separate observation, forecast, alert, and climate TTLs; bounded retries for 429/5xx/timeouts; request spacing; server-side User-Agent.
- Added weather resource allowlist and worker request status persistence.

Fix commit: current HEAD.

## Remaining review fixes

- Weather now fetches point, observations, daily forecast, hourly forecast, and alerts sequentially with a minimum interval.
- Retries are limited to 429, 5xx, and timeout/abort failures; 4xx and JSON errors fail immediately.
- Climate periods are a strict union with CPC endpoint mapping.
- Worker persists forecast rows and failed request status, and closes the weather queue/worker/Redis resources on shutdown.

Latest fix commit: `ab7a623`.

## Scoped re-review fixes

- Shutdown now closes weather queue, worker, and Redis through `weatherQueueName`.
- Retry classification covers every 5xx and 429 plus timeout, while JSON parsing errors remain non-retryable.
- Added pacing between points and downstream requests and climate calls.
- Climate responses must be JSON objects; unavailable/HTML responses fail explicitly.
- Failure request status records the active weather/climate phase and retry budget attempts.

Latest commit: `ded8f15`.
