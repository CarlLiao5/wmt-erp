import {createDb} from '../../../../packages/db/src/db.js';
import {monthlyProfit} from '../../../api/src/routes/profit.js';

type DueProfit = {
  tenantId: string;
  month: string;
  revision: number;
  exchangeRate: string;
  semDiscount: string;
};

function currentPacificMonth() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit',
  }).formatToParts(new Date());
  return parts.find(part => part.type === 'year')!.value + '-' + parts.find(part => part.type === 'month')!.value;
}

export async function refreshDueMonthlyProfit(intervalMinutes: number) {
  const pool = createDb().pool;
  const connection = await pool.getConnection();
  const lockName = 'wmterp-monthly-profit';
  let locked = false;
  try {
    const [locks] = await connection.query('SELECT GET_LOCK(?, 0) AS acquired', [lockName]);
    locked = (locks as Array<{acquired:number}>)[0]?.acquired === 1;
    if (!locked) return false;
    const currentMonth = currentPacificMonth();
    await connection.query(
      `INSERT IGNORE INTO monthly_profit_snapshots (tenant_id, profit_month, next_run_at)
       SELECT tenant_id, ?, UTC_TIMESTAMP(3) FROM profit_settings`, [currentMonth],
    );
    const [rows] = await connection.query(
      `SELECT p.tenant_id AS tenantId, p.profit_month AS month, p.revision,
              s.exchange_rate AS exchangeRate, s.sem_discount AS semDiscount
       FROM monthly_profit_snapshots p JOIN profit_settings s ON s.tenant_id=p.tenant_id
       WHERE p.next_run_at <= UTC_TIMESTAMP(3)
       ORDER BY p.next_run_at, p.tenant_id, p.profit_month LIMIT 1`,
    );
    const [job] = rows as DueProfit[];
    if (!job) return false;
    const [claim] = await connection.query(
      `UPDATE monthly_profit_snapshots SET run_connection_id=CONNECTION_ID(), failed_at=NULL
       WHERE tenant_id=? AND profit_month=? AND revision=? AND next_run_at<=UTC_TIMESTAMP(3)`,
      [job.tenantId, job.month, job.revision],
    );
    if (!(claim as {affectedRows:number}).affectedRows) return true;
    try {
      const result = await monthlyProfit(job.tenantId, job.month, {
        exchangeRate:Number(job.exchangeRate), semDiscount:Number(job.semDiscount),
      });
      const delay = job.month === currentMonth ? intervalMinutes : Math.max(intervalMinutes, 1440);
      await connection.query(
        `UPDATE monthly_profit_snapshots
         SET run_connection_id=NULL, failed_at=NULL, result=?, calculated_at=UTC_TIMESTAMP(3), exchange_rate=?, sem_discount=?,
             next_run_at=DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? MINUTE)
         WHERE tenant_id=? AND profit_month=? AND revision=?`,
        [JSON.stringify(result), job.exchangeRate, job.semDiscount, delay, job.tenantId, job.month, job.revision],
      );
    } catch (error) {
      await connection.query(
        `UPDATE monthly_profit_snapshots SET run_connection_id=NULL, failed_at=UTC_TIMESTAMP(3), next_run_at=DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 5 MINUTE)
         WHERE tenant_id=? AND profit_month=? AND revision=?`,
        [job.tenantId, job.month, job.revision],
      );
      throw error;
    }
    return true;
  } finally {
    try {
      if (locked) await connection.query('SELECT RELEASE_LOCK(?)', [lockName]);
    } catch (error) {
      connection.destroy();
      throw error;
    } finally {
      connection.release();
    }
  }
}

export function startProfitScheduler() {
  const configured = Number(process.env.PROFIT_REFRESH_MINUTES ?? 1440);
  const intervalMinutes = Number.isSafeInteger(configured) && configured >= 5 && configured <= 1440 ? configured : 1440;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<void> | undefined;
  const tick = async () => {
    let worked = false;
    try {
      worked = await refreshDueMonthlyProfit(intervalMinutes);
    } catch (error) {
      console.error('Monthly profit refresh failed:', error instanceof Error ? error.message : String(error));
    }
    if (!stopped) timer = setTimeout(run, worked ? 1000 : 30_000);
  };
  const run = () => { running = tick(); };
  run();
  return async () => {
    stopped = true;
    clearTimeout(timer);
    await running;
  };
}
