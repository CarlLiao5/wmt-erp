# 增量同步定时调度设计

## 目标与范围

首次回填计划进入终态后，自动为支持的资源启用持续增量同步；按资源节奏重拉重叠日期范围，保留现有 BullMQ、原始响应和幂等写入。Worker 仍保持单实例。

站内广告 `/v3/advertising` 的 404 不在本次处理范围：不改端点、不做 404 兼容或降级，也不把失败伪装成成功。自动计划不为站内广告创建增量任务；SEM 是独立资源，继续按已确认的 SEM 报告端点处理。

## Walmart 限速核对

核对来源：

- Walmart API MCP 的 US OpenAPI 目录：确认订单、退货、库存、Payment Reports、Price Management 和 SEM 路径及方法。MCP 规格未提供限速扩展字段或配额数值。
- Walmart 官方 [Rate limiting 文档](https://developer.walmart.com/us-marketplace/docs/rate-limiting)：限额按卖家及 API 分配，使用 token bucket；超限返回 429。响应头 `x-current-token-count` 表示当前令牌数，`X-Next-Replenishment-Time` 表示下次补充令牌时间。
- 官方文档列出的当前相关默认值：

| API | Walmart 默认限额 |
| --- | ---: |
| `GET /v3/orders` | 5000 次/分钟 |
| `GET /v3/returns` | 50 次/分钟 |
| `GET /v3/fulfillment/inventory-log` | 500 次/分钟 |
| `GET /v3/report/payment/performance` | 15 次/分钟 |
| `POST /v3/price/getPricingInsights` | 2 次/分钟 |
| `GET /v3/price/incentives` | 60 次/分钟 |
| `GET /v3/promo/sku/{sku}` | 1000 次/分钟 |
| `POST /v3/advertising/sem/campaigns/performance-summary` | 10 次/分钟 |
| `GET /v3/reports/reportRequests/{requestId}` | 20 次/小时 |
| `GET /v3/reports/downloadReport` | 20 次/小时 |

Recon 官方表列出旧版 `GET /v3/report/reconreport/reconFile` 为 100 次/分钟；当前 ERP 使用 `availableReconFiles` 和 `reconFileJson`，MCP 与官方限速表未给出这两个实际路径的单独配额，因此按未知配额保守串行并遵守响应头，不把旧端点额度外推为已确认事实。

这些是官方文档的默认值，卖家实际额度以 Walmart 响应头和账号配置为准。调度频率远低于 API 额度；对有调用频率的限制，还需在请求发送层按店铺/卖家限速，而不能只靠降低定时频率。

## 调度行为

1. Worker 内增加分钟级调度检查。只有状态为 `completed` 或 `partial` 的 `initial` 计划可生成 `incremental` 计划；重试中的历史窗口仍由原有窗口状态管理。已存在的增量计划采用幂等创建，不重复建计划。
2. 只将订单、退货、库存、Recon 仓储费用、价格、SEM 广告/报表、绩效纳入自动增量。站内广告资源保持现状，不创建增量任务。
3. 对计划增加 `interval_minutes`、`overlap_days`、`next_run_at`、`enabled` 字段；Worker 只取到期计划，成功或失败后均推进下次调度时间，失败窗口记录在 `sync_windows`，下一个周期按重叠范围再拉，不在本轮内密集重试。
4. 调度器每次只创建到期窗口并将执行交给 BullMQ；每店铺串行执行，避免回填、人工同步和定时任务同时打满 API。窗口 batch/idempotency key 由计划与计划周期确定，防止多个 tick 重复入队。
5. 首次上线时，调度器为已存在且已结束的首次计划补建增量计划；不需要用户重新手动创建。

## 建议默认周期

| 资源 | 周期 | 重叠窗口 | 依据 |
| --- | ---: | ---: | --- |
| 订单 | 15 分钟 | 2 天 | 订单状态和最后修改可能变化；配额充足 |
| 退货 | 1 小时 | 7 天 | 退货状态需要回补；限额低于订单 |
| 库存/WFS 日志 | 6 小时 | 7 天 | 当前库存定期刷新，日志可能补录 |
| Recon 仓储费 | 24 小时 | 最近可用账期 | Walmart 按可用账期发布，不把请求日期当作账期范围 |
| 价格/激励/促销 | 24 小时 | 7 天 | 价格洞察仅 2 次/分钟，SKU 促销读取需串行节流 |
| SEM 汇总、商品、搜索词 | 6 小时 | 最近 30 天 | 报告可能回补；异步报告状态接口仅 20 次/小时 |
| Seller Performance | 24 小时 | 最近 30 天 | 日级数据定期校准 |

周期是应用层默认策略，不是 Walmart 对同步新鲜度的承诺；按卖家响应头动态延后比硬编码额度更权威。调度频率以后应可配置，但本次不增加 UI 控件。

## 限速与重试要求

- 每个卖家/API 使用共享限流器读取 `x-current-token-count` 与 `X-Next-Replenishment-Time`；请求分页、逐 SKU 读取和 SEM 报告状态轮询共享相同预算。
- 未公开配额的调用按每卖家串行发送；有明确配额的调用也保留余量，不以官方最大值作为目标吞吐。
- 收到 429 时不启动并行重试；按 `Retry-After` 或 `X-Next-Replenishment-Time` 延迟 BullMQ 重试。调度 tick 不得绕过该延迟再次排入相同窗口。
- SEM 报告状态查询按 20 次/小时约束；当前每 10 分钟轮询一次在单个报告内低于默认额度，但多个报告需共享预算。
- 不自动重试 4xx；站内广告 404 保留失败状态，不做错误改写或响应兜底。

## 验收标准

- 首次计划完成/部分完成后可幂等生成增量计划；已存在计划重复启动不会复制。
- Worker 只有一个调度入口，重启后可从 MySQL 恢复到期任务，不依赖进程内计时状态。
- 到期窗口只入队一次，按计划的 overlap 生成范围，成功/失败都更新下次执行时间和可观测状态。
- 每店铺队列串行；请求限流尊重响应头，429 不导致高频重试或 tick 重复入队。
- 订单、退货、库存、Recon、价格、SEM、绩效使用表中默认周期；站内广告不被自动排程，已有 404 仍按原逻辑呈现。
- 不改变业务 API 只读约束、租户/店铺隔离和现有原始/标准化落库方式。
