import { describe, expect, it } from 'vitest';
import { summarizePlanWindows } from './planProgress.js';

describe('summarizePlanWindows', () => {
  it('keeps a plan running while queued or running windows remain', () => {
    expect(summarizePlanWindows(['completed', 'queued', 'running'])).toMatchObject({ status: 'running', completed: 1, failed: 0, total: 3 });
  });

  it('marks a plan partial when any window failed', () => {
    expect(summarizePlanWindows(['completed', 'failed'])).toMatchObject({ status: 'partial', completed: 1, failed: 1, total: 2 });
  });

  it('marks all completed windows completed', () => {
    expect(summarizePlanWindows(['completed', 'completed'])).toMatchObject({ status: 'completed', completed: 2, failed: 0, total: 2 });
  });

  it('ignores superseded windows when calculating plan progress', () => {
    expect(summarizePlanWindows(['completed', 'superseded'])).toMatchObject({ status: 'completed', total: 1, completed: 1 });
  });
});
