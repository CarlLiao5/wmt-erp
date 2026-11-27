import { createDb, stores } from '../packages/db/index.ts';
const { db, pool } = createDb();
try { const rows = await db.select().from(stores); console.log(JSON.stringify(rows)); } finally { await pool.end(); }
