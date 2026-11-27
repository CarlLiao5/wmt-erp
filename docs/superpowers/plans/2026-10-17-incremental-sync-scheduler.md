# 增量同步定时调度实施计划

**目标：** 首次回填结束后自动持续增量同步，并按 Walmart 官方 API 限额约束请求频率。站内广告 404 保持当前行为，不纳入增量排程。

**设计：** `docs/superpowers/specs/2026-10-17-incremental-sync-scheduler-design.md`

**技术：** TypeScript、BullMQ/Redis、Drizzle/MySQL、Walmart Client。

## 实施边界

- 不改站内广告端点、不处理 404、不将站内广告加入自动增量计划。
- SEM 与 Seller Performance 保持现有读 API 路径和报表处理方式。
- 增量计划只在首次计划为 `completed` 或 `partial` 后启用；失败窗口仍保留独立状态。
- Worker 保持单实例；API 不直接调用 Walmart。
- 迁移由操作人按项目约定手动应用，不由 Worker/API 自动迁移。
- 本计划只使用当前工作区已有依赖，不添加调度/限速依赖。

## 文件范围

- 修改 `packages/db/src/schema/sync-plans.ts`
- 新增 `packages/db/migrations/0023_incremental_sync_schedule.sql`
- 修改 `packages/db/migrations/meta/_journal.json`
- 修改 `apps/api/src/routes/sync-plans.ts`（创建增量计划时套用策略默认值）
- 修改 `apps/worker/src/sync/planRunner.ts` 并新增/扩展其持久化 repository
- 修改 `apps/worker/src/main.ts`（Worker 生命周期内启动、停止分钟级 scheduler）
- 修改 `apps/worker/src/queue.ts`（窗口到 BullMQ 的幂等投递及计划状态）
- 修改 `packages/walmart-client/src/rateLimit.ts`、`transport.ts`、`request.ts` 或必要的 SEM 报告请求入口（集中应用配额策略并观察响应头）
- 修改 `RUNBOOK.md`（迁移、启动、单实例、调度观测和暂停办法）

## 任务

### 1. 持久化调度配置

- 给 `sync_plans` 增加 `interval_minutes`、`overlap_days`、`next_run_at`、`enabled`。
- 更新 Drizzle schema、迁移 journal 和手动迁移 SQL；保留既有计划数据。
- 增量计划按租户、店铺和资源唯一；创建/补建都使用幂等 upsert。
- 默认周期使用已审设计的策略表；站内广告资源设置为不可自动排程。

### 2. 首次计划收尾与增量计划补建

- Worker 调度周期内发现 `initial` 为 `completed`/`partial` 的计划后，幂等创建对应 `incremental` 计划。
- 兼容已有已完成/部分完成的首次计划，不要求重新创建计划。
- 处于 `planned`/`running` 的首次计划不提前启用增量，以免重复压占窗口。

### 3. 到期窗口与 BullMQ 投递

- 分离“生成窗口/推进 next-run”和“执行 Walmart 调用”；scheduler 只持久化窗口并投递 BullMQ。
- 使用计划的预定周期时间生成稳定 batch id；对窗口创建与 `next_run_at` 更新做原子条件更新，避免多 tick 重复。
- Worker 启动后扫描已创建但尚无可用 job 的 planned 窗口，恢复崩溃发生在持久化与入队之间的任务。
- 到期计划按每店铺串行进入现有队列；定时同步不得与同店铺的 initial 窗口并行。
- 成功、失败都落状态和下次调度时间；失败不在当前 scheduler tick 内快速重试。

### 4. Walmart 请求限速

- 在 Walmart 请求发送边界集中限速，按店铺/卖家和 API 路径组共享预算，覆盖普通 GET、已批准的读取型 POST、分页、逐 SKU 请求及 SEM report status/download。
- 将官方公开额度作为上限，不追求上限吞吐；未公开额度的 Recon 路径以串行为默认。
- 观察 `x-current-token-count` 和 `X-Next-Replenishment-Time`；429 延迟重试不得早于 Walmart 指定的补充时间，避免固定重试上限提前重打。
- 保留 401 重新认证和现有 5xx 退避；普通 4xx 不在本轮内重试。站内广告 404 原样失败。
- 在多店铺场景验证一个卖家的等待不会阻塞另一个卖家。

### 5. 手动迁移与本地验收

- 核对新增迁移 SQL 与当前 MySQL 方言，不自动执行迁移。
- 在本地 MySQL 手动应用 0023，再由一个 Worker 实例启动 scheduler。
- 确认已有的终态 initial plans 补建到期增量计划、pending 窗口只排一次、next-run 可在 Worker 重启后恢复。
- 通过真实本地数据库记录、BullMQ job id 和 Worker 日志检查计划周期、状态、API 429 等待时间；不触发额外生产历史回填。
- 更新 RUNBOOK，记录暂停自动调度的方法、如何恢复以及检查哪些表/队列。

## 完成门槛

- 首次计划结束后能自动建立增量计划，且旧计划重启/重复扫描不会产生重复计划或重复 job。
- 调度状态在 MySQL 可恢复，不依赖进程内 setInterval 状态。
- 每个计划按确认周期生成正确 overlap 窗口，并且调用顺序受同店铺队列约束。
- 429 遵循 `Retry-After`/`X-Next-Replenishment-Time`；异步 SEM 状态查询不超过官方 20 次/小时默认额度。
- 站内广告仍不进入自动计划；原有 404 行为未被吞掉、改写或伪造成功。
- 类型检查、数据库迁移审查、Worker 启停检查及 `git diff --check` 记录在交付结果中。
