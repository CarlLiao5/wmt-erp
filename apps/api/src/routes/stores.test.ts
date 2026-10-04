import { expect, it } from 'vitest';
import { storesRouter } from './stores.js';
it('exposes a local onboarding router without a Walmart client', () => { const router = storesRouter(async () => ({ id: 'job' })); expect(router).toBeTruthy(); });
