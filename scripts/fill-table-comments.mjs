import fs from 'node:fs';
import { createRequire } from 'node:module';

// Run from the repo root with the Doke env files. Dry-run unless --apply is supplied.
const require = createRequire(process.cwd() + '/packages/db/package.json');
const mysql = require('mysql2/promise');
const comments = {
  climate_outlooks: '按州和预测周期保存的气温与降水气候展望概率',
  lingxing_configs: '租户领星 MCP 接入配置与广告主映射，密钥加密保存',
  'orders old': '导入的历史订单数据，用于历史订单核对与补漏',
  product_review_configs: '租户商品评论采集配置，Firecrawl API 密钥加密保存',
  product_review_pages: '商品评论分页采集状态、续抓游标与采集额度记录',
  product_review_runs: '商品评论首次历史与增量采集运行记录',
  product_review_snapshots: '商品总评分、评论总数与各星级数量占比历史快照',
  product_review_targets: '商品评论监控 Item 及启停、历史进度和定时增量配置',
  product_reviews: '按租户和 Item 保存的商品原生评论明细',
  recon_transactions: 'Walmart 对账报告标准化交易及订单商品费用明细',
  return_records: '租户店铺退货明细，包含原因、原因代码及退款责任归属',
  return_records_reason_backup_20261110: '2026-11-10 退货原因治理相关的 return_records 备份',
  return_records_reference_backup_20261110: '2026-11-10 退货引用核对相关的 return_records 备份',
  return_records_resp_missing_backup_20261111: '2026-11-11 退货责任字段缺失记录修复相关备份',
  return_records_responsibility_backup_20261110: '2026-11-10 退货责任字段治理相关的 return_records 备份',
  return_records_responsibility_prebackfill_20261110: '2026-11-10 退货责任字段回填前的 return_records 备份',
  return_status_events: '退货状态与退款金额变更事件及原始响应引用',
  returns: '原有退货明细表，保存退货原因与代码、退款及店铺信息',
  weather_forecasts: '按州保存的天气预报及有效时段缓存',
  weather_request_status: '天气数据请求状态、重试次数与错误记录',
  weather_snapshots: '按州和观测时间保存的天气指标历史快照',
  wfs_fee_preview_items: 'WFS 货件 ITS 转运费用预估方案的商品数量与费用明细',
  wfs_fee_preview_options: 'WFS 货件 ITS 转运费用预估方案、目的仓与费用响应',
  wfs_fee_preview_runs: 'WFS 货件 ITS 转运费用预估执行状态与请求记录',
};
const connection = await mysql.createConnection({ uri: process.env.MYSQL_URL, charset: 'utf8mb4' });
try {
  await connection.query('SET SESSION lock_wait_timeout=10');
  const [rows] = await connection.query("SELECT TABLE_NAME, TABLE_COMMENT FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME");
  const missing = rows.filter(row => !row.TABLE_COMMENT.trim());
  const unknown = missing.filter(row => !comments[row.TABLE_NAME]);
  if (unknown.length) throw new Error('Unmapped tables: ' + unknown.map(row => row.TABLE_NAME).join(', '));
  const changes = missing.map(row => ({ table: row.TABLE_NAME, before: row.TABLE_COMMENT, after: comments[row.TABLE_NAME] }));
  if (!process.argv.includes('--apply')) {
    console.log(JSON.stringify({ dryRun: true, changes }, null, 2));
  } else {
    fs.mkdirSync('artifacts/db-table-comments', { recursive: true });
    const auditPath = 'artifacts/db-table-comments/' + new Date().toISOString().replaceAll(':', '-') + '.json';
    fs.writeFileSync(auditPath, JSON.stringify({ changes }, null, 2) + '\n');
    for (const change of changes) {
      const [current] = await connection.query('SELECT TABLE_COMMENT FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?', [change.table]);
      if (current[0]?.TABLE_COMMENT.trim()) continue;
      await connection.query('ALTER TABLE ' + connection.escapeId(change.table) + ' COMMENT = ' + connection.escape(change.after));
    }
    const [after] = await connection.query("SELECT TABLE_NAME, TABLE_COMMENT FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE='BASE TABLE'");
    const remaining = after.filter(row => !row.TABLE_COMMENT.trim());
    for (const row of rows.filter(row => row.TABLE_COMMENT.trim())) {
      if (after.find(item => item.TABLE_NAME === row.TABLE_NAME)?.TABLE_COMMENT !== row.TABLE_COMMENT) throw new Error('Existing comment changed: ' + row.TABLE_NAME);
    }
    for (const change of changes) {
      if (after.find(row => row.TABLE_NAME === change.table)?.TABLE_COMMENT !== change.after) throw new Error('Comment verification failed: ' + change.table);
    }
    console.log(JSON.stringify({ updated: changes.length, totalTables: after.length, missingComments: remaining.length, auditPath }));
    if (remaining.length) throw new Error('Some table comments remain empty');
  }
} finally {
  await connection.end();
}
