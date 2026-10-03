import express, { type ErrorRequestHandler, type Express } from 'express';
import { randomUUID } from 'node:crypto';
import { healthRouter } from './routes/health.js';
import { dashboardRouter } from './routes/dashboard.js';
import { syncStatusRouter } from './routes/sync-status.js';
export function createApp(): Express {
  const app = express();
  app.use(express.json());
  app.use((_req, res, next) => { res.locals.requestId = randomUUID(); next(); });
  app.use('/api', healthRouter());
  app.use('/api', dashboardRouter());
  app.use('/api', syncStatusRouter());
  const errors: ErrorRequestHandler = (error, _req, res, _next) => res.status(500).json({ requestId: res.locals.requestId, data: null, error: { message: error instanceof Error ? error.message : 'Internal Server Error' } });
  app.use(errors);
  return app;
}
