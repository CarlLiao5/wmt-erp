import { createDb } from './db.js';
import { retentionCutoffs } from './retention.js';

function option(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

const execute = process.argv.includes('--execute');
const rawPayloadDaysInput = option('raw-payload-days') ?? process.env.RETENTION_RAW_PAYLOAD_DAYS;
const syncJobDaysInput = option('sync-job-days') ?? process.env.RETENTION_SYNC_JOB_DAYS;
if (!rawPayloadDaysInput || !syncJobDaysInput) {
  throw new Error('Set --raw-payload-days and --sync-job-days (or their RETENTION_* environment variables)');
}
const rawPayloadDays = Number(rawPayloadDaysInput);
const syncJobDays = Number(syncJobDaysInput);
const cutoffs = retentionCutoffs(new Date(), { rawPayloadDays, syncJobDays });
const { pool } = createDb();

try {
  if (execute) throw new Error('Direct retention deletion is disabled. Use raw-archive-cli.ts to archive, verify coverage and purge bounded batches.');

  const rawCutoff = cutoffs.rawPayloadBefore.toISOString().slice(0, 19).replace('T', ' ');
  const jobsCutoff = cutoffs.syncJobBefore.toISOString().slice(0, 19).replace('T', ' ');
  if (!execute) {
    const [[raw], [jobs]] = await Promise.all([
      pool.query('SELECT COUNT(*) AS total FROM raw_payloads WHERE received_at < ?', [rawCutoff]),
      pool.query("SELECT COUNT(*) AS total FROM sync_jobs WHERE created_at < ? AND status IN ('completed', 'failed')", [jobsCutoff]),
    ]) as any;
    console.log(JSON.stringify({ mode: 'dry-run', rawPayloadBefore: cutoffs.rawPayloadBefore.toISOString(), syncJobBefore: cutoffs.syncJobBefore.toISOString(), candidates: { rawPayloads: Number(raw[0].total), syncJobs: Number(jobs[0].total) } }, null, 2));
  }
} catch(error) {
  console.error(error instanceof Error ? error.message : String(error));process.exitCode=1;
} finally {
  await pool.end();
  process.exit(process.exitCode ?? 0);
}
