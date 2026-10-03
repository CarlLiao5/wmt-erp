import mysql, { type Pool } from 'mysql2/promise';

export function createMysqlTestPool(connectionString = process.env.MYSQL_URL): Pool {
  if (!connectionString) throw new Error('MYSQL_URL is required to create a MySQL test pool');

  return mysql.createPool({
    uri: connectionString,
    connectionLimit: 2,
    waitForConnections: true,
    queueLimit: 0,
    timezone: 'Z',
    decimalNumbers: false,
  });
}
