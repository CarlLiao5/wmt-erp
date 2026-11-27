import {it,expect} from 'vitest';
import {reviewScheduleRequest} from './product-reviews-scheduler.js';
it('uses deterministic item-specific 96 hour slot',()=>{const row={tenantId:'t',itemId:'123',nextRunAt:new Date('2026-11-16T00:00:00Z')};expect(reviewScheduleRequest(row)).toEqual(reviewScheduleRequest(row));expect(reviewScheduleRequest(row).state).toMatchObject({mode:'incremental',pageBudget:1,itemId:'123'});});
