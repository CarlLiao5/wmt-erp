import express, { type Express } from 'express';

export function createTestApp(configure?: (app: Express) => void): Express {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  configure?.(app);
  return app;
}
