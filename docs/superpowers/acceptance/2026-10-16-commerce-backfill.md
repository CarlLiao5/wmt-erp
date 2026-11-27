# Walmart 数据首次回填与持续增量同步验收记录

## 本次范围

本次实现覆盖首次接入计划、资源窗口、订单回填边界、Returns 历史探测、Recon 分页、WFS 库存日志日期范围、Sync Status 覆盖展示和增量计划执行器。

## 数据边界

- 订单明细：当前日期向前 180 天；单次筛选结果最多 10,000 条；单页最多 200 条。超过 10,000 条时按日期窗口拆分。
- Returns：首次接入使用接口探测实际最早可用日期；后续默认重叠 7 天。
- Recon：使用 Walmart 返回的可用账期；每页最多 1,000 条，按 `nextOffset` 到结束。
- WFS 库存日志：直接接口最多 365 天；查询窗口通过 `startDate`/`endDate` 传入，超过范围返回明确错误信号。
- SEM、广告、价格和绩效：保留实际报告覆盖范围，不把空结果或未确认保留期标记为完整历史。

## 实现内容

- `sync_plans`：租户/店铺/资源/模式级计划。
- `sync_windows`：日期窗口、批次、游标、分页数、记录数、覆盖范围、来源和错误。
- `sync_jobs.sync_window_id`：将执行任务关联到窗口。
- `POST /api/sync/plans` 和 `GET /api/sync/plans/:id`：创建计划和查看覆盖状态。
- Sync Status 增加“首次全量回填”，显示窗口完成数、覆盖日期、订单 180 天边界和可重试失败窗口。
- 计划执行器跳过已完成窗口，只重试失败/未完成窗口；增量计划默认按资源重叠日期窗口生成。

## 数据库迁移

已在本地 MySQL `walmart_erp` 手动执行：

```text
packages/db/migrations/0022_sync_plans_and_windows.sql
```

已核验 `sync_plans`、`sync_windows`、`sync_jobs.sync_window_id` 及窗口索引存在。

## 验证结果

- Vitest：61 个测试文件、195 项测试通过。
- Workspace typecheck：Web、API、Worker、DB、Domain、Walmart Client、Config、Testkit 全部通过。
- API 健康检查：`GET http://localhost:3000/api/health` 返回 HTTP 200。
- Web 健康检查：`GET http://localhost:5173/` 返回 HTTP 200。
- `git diff --check`：通过。

## 尚未执行

- 未使用生产凭证触发全量同步；避免在没有明确生产同步窗口和凭证授权时写入生产数据。
- 未执行 Sandbox 端到端回填；本次环境未提供可用于该验收的 Sandbox 店铺凭证。
- 订单 180 天以前的完整明细仍需 Walmart Seller Center 历史导出或后续人工导入，不能由 `/v3/orders` 伪造覆盖。
