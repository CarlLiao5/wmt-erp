import { defineConfig } from 'vite';
export default defineConfig({ server: { host: '::', proxy: { '/api': { target: 'http://127.0.0.1:3000' } } } });
