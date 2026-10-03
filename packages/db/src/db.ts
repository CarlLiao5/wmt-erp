import { drizzle, type MySql2Database } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import * as schema from './schema/index.js';

export type AppDatabase = MySql2Database<typeof schema>;

export function createDb(connectionString = process.env.MYSQL_URL): { db: AppDatabase; pool: mysql.Pool } {
  if (!connectionString) throw new Error('MYSQL_URL is required');
  const pool = mysql.createPool({ uri: connectionString, timezone: 'Z', decimalNumbers: false });
  return { db: drizzle(pool, { schema, mode: 'default' }), pool };
}
