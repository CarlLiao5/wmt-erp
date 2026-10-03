import { pino, type DestinationStream, type Logger } from 'pino';

const sensitiveKey = /(?:secret|token|password|authorization|cookie|credential.*key|mysqlurl|redisurl)/i;
const redacted = '[REDACTED]';

function sanitize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, sensitiveKey.test(key) ? redacted : sanitize(child)]),
  );
}

export function createLogger(context: Record<string, unknown>, destination?: DestinationStream): Logger {
  return pino(
    {
      level: process.env.LOG_LEVEL ?? 'info',
      base: sanitize(context) as Record<string, unknown>,
      formatters: {
        bindings: (bindings) => sanitize(bindings) as Record<string, unknown>,
        log: (object) => sanitize(object) as Record<string, unknown>,
      },
    },
    destination,
  );
}
