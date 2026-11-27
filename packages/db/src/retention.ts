export interface RetentionPolicy { rawPayloadDays: number; syncJobDays: number; }
export interface RetentionCutoffs { rawPayloadBefore: Date; syncJobBefore: Date; }

export function retentionCutoffs(now: Date, policy: RetentionPolicy): RetentionCutoffs {
  if (!Number.isInteger(policy.rawPayloadDays) || policy.rawPayloadDays < 1) throw new Error('rawPayloadDays must be a positive integer');
  if (!Number.isInteger(policy.syncJobDays) || policy.syncJobDays < 1) throw new Error('syncJobDays must be a positive integer');
  return { rawPayloadBefore: new Date(now.getTime() - policy.rawPayloadDays * 86_400_000), syncJobBefore: new Date(now.getTime() - policy.syncJobDays * 86_400_000) };
}

export function retentionPlan(now: Date, policy: RetentionPolicy) {
  const cutoffs = retentionCutoffs(now, policy);
  return [
    { table: 'raw_payloads', cutoff: cutoffs.rawPayloadBefore, sql: 'DELETE FROM raw_payloads WHERE received_at < ?' },
    { table: 'sync_jobs', cutoff: cutoffs.syncJobBefore, sql: 'DELETE FROM sync_jobs WHERE created_at < ? AND status IN (\'completed\', \'failed\')' },
  ] as const;
}
