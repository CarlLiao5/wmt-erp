import { createRequire } from 'node:module';
const mysql = createRequire(new URL('../packages/db/package.json', import.meta.url))('mysql2/promise');
import { readFile } from 'node:fs/promises';
const url = new URL(process.env.MYSQL_URL ?? '');
if (url.hostname.toLowerCase() !== 'doke.synology.me') throw new Error('This migration must use Doke');
const connection = await mysql.createConnection({ host: url.hostname, port: Number(url.port || 3306), user: decodeURIComponent(url.username), password: decodeURIComponent(url.password), database: url.pathname.slice(1) });
try {
  const [columns] = await connection.query("SHOW COLUMNS FROM users LIKE 'username'");
  if (!columns.length) await connection.query(await readFile('packages/db/migrations/0068_user_login_username.sql', 'utf8'));
  const [indexes] = await connection.query("SHOW INDEX FROM users WHERE Key_name='users_tenant_username_unique'");
  if (indexes.length !== 2) throw new Error('Username uniqueness index is missing');
  console.log('Doke username column and tenant uniqueness index ready');
} finally { await connection.end(); }
