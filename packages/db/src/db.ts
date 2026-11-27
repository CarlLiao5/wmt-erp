import { drizzle, type MySql2Database } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import * as schema from './schema/index.js';

export type AppDatabase = MySql2Database<typeof schema>;

const pools = new Map<string, mysql.Pool>();

export function createDb(connectionString = process.env.MYSQL_URL): { db: AppDatabase; pool: mysql.Pool } {
  if (!connectionString) throw new Error('MYSQL_URL is required');
  // SmartSheet and other upstream payloads contain Chinese text. Explicitly
  // negotiate utf8mb4 so mysql2 does not downgrade strings before insertion.
  let pool = pools.get(connectionString);
  if (!pool) {
    const configuredLimit = Number(process.env.DB_POOL_SIZE ?? 10);
    const connectionLimit = Number.isFinite(configuredLimit) ? Math.min(32, Math.max(2, Math.floor(configuredLimit))) : 10;
    pool = mysql.createPool({ uri: connectionString, charset: 'utf8mb4', timezone: 'Z', decimalNumbers: false, connectionLimit, enableKeepAlive: true });
    // Route handlers historically call pool.end() after each query. The pool is
    // shared for the whole process, so those calls must not tear down the pool.
    const sharedPool = pool;
    sharedPool.end = (async () => undefined) as typeof sharedPool.end;
    pools.set(connectionString, sharedPool);
  }
  return { db: drizzle(pool, { schema, mode: 'default' }), pool };
}
