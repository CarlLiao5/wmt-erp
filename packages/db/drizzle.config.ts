import { defineConfig } from 'drizzle-kit';
export default defineConfig({ schema: './src/schema/index.ts', out: './migrations', dialect: 'mysql', dbCredentials: { url: process.env.MYSQL_URL ?? 'mysql://walmart:walmart_dev@127.0.0.1:3306/walmart_erp' } });
