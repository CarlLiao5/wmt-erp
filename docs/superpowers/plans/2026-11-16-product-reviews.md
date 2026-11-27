# Product Reviews Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 增加商品评论页面与支持历史断点抓取、每96小时第一页增量的 Firecrawl Work。

**Architecture:** 复用 Express → BullMQ → Worker → Doke MySQL；页面仅查询本地数据。抓取客户端、Walmart解析器、任务状态机和持久化分别独立；专用串行队列及共享密钥分布式锁约束外部请求，商品级锁避免首次和增量并行。

**Tech Stack:** TypeScript、Express、BullMQ/Redis、Drizzle/mysql2、Vitest、现有原生前端渲染体系。

**Spec:** `docs/superpowers/specs/2026-11-16-product-reviews-design.md`

## Global Constraints

- 现有 Doke 数据库；不创建或使用 Docker 数据库。保留当前所有无关未提交变更。
- 首次逐页读取历史；下一页从真实返回提取，验证 Walmart 域名、Item ID 与最新评论排序。
- 持续增量每四天（96小时）只抓 `sort=submission-desc` 第一页；不自动开启全商品计划。
- 初步真实验证仅 Item ID `1201369196`，最多两页；验证通过才允许批量历史抓取。
- 共享 API key 并发默认1、最多2；429尊重 Retry-After，缺失时指数退避加抖动，最多5次重试。
- 密钥仅服务端加密保存，API、日志、测试快照不包含密钥。
- 评论按租户+Item ID+稳定评论标识去重，读取仍经可见店铺/SKU关联授权。
- 被拦截或解析失败不得作为无评论或历史完成；预算耗尽必须保存断点并暂停。
- 页面使用同源 `/api/`；管理员管理、成员只读；所有列表服务端分页。

## Review Focus

1. 提交 batch 后网络中断：不盲目重新提交收费任务，未知提交结果暂停并明确原因（Task 2/3）。
2. 商品被撤权或跨店共享 Item ID：列表、详情与手动抓取均不能通过原始 Item ID 绕过权限（Task 4）。
3. 页面布局改变、验证码或连续重复页：报失败或循环暂停，不能覆盖为零评论（Task 2/3）。
4. Worker 重启和多个 scheduler 同时运行：相同96小时槽不重复入队；恢复原 batch；互斥锁可续租（Task 3）。
5. 首次达到预算后点击继续，或增量撞上首次：断点不丢、不跳页，增量延后（Task 3/5）。

## File Map

- `packages/db/src/schema/product-reviews.ts`、`packages/db/migrations/0046_product_reviews.sql`：加密配置、目标/计划、评论、运行/页面检查点。
- `packages/db/src/product-reviews.ts`：持久化与事务，明确授权商品关系查询接口。
- `apps/worker/src/reviews/firecrawl-client.ts`：有限重试、提交/轮询、API结果分页。
- `apps/worker/src/reviews/walmart-review-parser.ts`：评论提取和安全分页。
- `apps/worker/src/jobs/syncProductReviews.ts`：历史/增量状态机。
- `apps/worker/src/sync/product-reviews-scheduler.ts`：持久化96小时计划。
- `apps/api/src/routes/product-reviews.ts`：本地查询、配置与管理员操作。
- `apps/web/src/pages/ProductReviewsPage.ts`：页面；沿用现有页面框架而非引入框架。

## Task 1: 数据模型与存储

**Files:** 上述两个 DB 新文件和 migration；修改 `packages/db/src/schema/index.ts`、`packages/db/index.ts`；测试 `packages/db/src/product-reviews.test.ts`。

**Interfaces:** 导出 `ReviewMode = 'initial' | 'incremental'`，`ReviewRecord`（itemId/reviewKey/rating/title/body/publishedAt/author/verifiedPurchase/sourceUrl/rawPayload），`ReviewTarget`（tenantId/itemId/initialStatus/nextPageUrl/enabled/nextRunAt）；`ProductReviewRepository` 提供 `upsertPage(input)`、`getCheckpoint(tenantId,itemId)`、`listReviews(scope,filters)`、`listTargets(scope,filters)`、`setSchedule(input)`、`addTarget({tenantId,itemId,createdBy})`（幂等，默认enabled=false）、`pauseTarget({tenantId,itemId})`。`scope` 必须携带租户及已解析商品可见范围。

- [ ] 写失败测试：同租户同商品同reviewKey两次upsert只有一条，另一租户独立；评论写入与检查点更新同事务回滚；日期/星级/搜索及分页总数正确。
- [ ] 运行 `./node_modules/.bin/vitest run packages/db/src/product-reviews.test.ts`，确认新增接口缺失导致失败。
- [ ] 实现五张表：`product_review_configs`、`product_review_targets`、`product_reviews`、`product_review_runs`、`product_review_pages`。目标唯一(tenant,item)，评论唯一(tenant,item,reviewKey)，页记录保存batch ID、状态、内容指纹、next URL、实际计费信息和异常。配置保存encryptedApiKey；目标到期索引(enabled,next_run_at)，评论索引(tenant,item,published_at,review_key)。迁移前重新确认0046未占用；混合collation连接用现有规范显式统一，不修改旧业务表。
- [ ] 实现仓储接口；原始内容限量存储且不回传列表；API查询只选择需要字段。
- [ ] 重跑上述测试并确认PASS。仅在用户要求提交时提交本任务精确文件，禁止包含无关改动。

## Task 2: Firecrawl客户端与真实解析契约

**Files:** 新建客户端/解析器及各自 `.test.ts`，脱敏 fixture 放 `apps/worker/src/reviews/fixtures/`。

**Interfaces:** `FirecrawlClient.submit(urls: string[]): Promise<{batchId:string}>`；`poll(batchId:string): Promise<BatchSnapshot>`；`parseWalmartReviewPage(input:{itemId:string,url:string,html?:string,markdown?:string}): ParsedReviewPage`，返回reviews/nextPageUrl/contentHash/explicitEmpty，无法识别则抛类型化错误。

- [ ] 阅读官方v2 batch scrape提交/状态文档，确认html/rawHtml格式、结果分页和实际错误语义；写mock失败测试覆盖429 Retry-After、5次重试上限、结果next分页、密钥脱敏、外域或错商品next URL拒绝。
- [ ] 运行 `./node_modules/.bin/vitest run apps/worker/src/reviews`，确认失败。
- [ ] 实现客户端，注入fetch/clock/sleep/random；轮询超时保存batch并返回待续，不重新提交。锁覆盖共享密钥请求，禁止只用进程内计数实现全局限制。未知POST提交结果单列为待核对，不自动重发。
- [ ] 在密钥已安全保存且数据库身份确认为Doke后，使用目标商品做第一页真实验证；把原batch结果保存脱敏fixture，不反复收费探测。检查稳定评论ID、排序和下一页；再验证第二页，两页累计上限2。若实际响应不提供可靠标识/分页，记录阻塞证据，停止收费请求而非猜测。
- [ ] 基于真实fixture写解析测试：星级正文日期提取、明确空页面、验证码/异常HTML报错、重复内容指纹一致。优先页面稳定ID；没有ID时停止上线并说明替代标识方案。
- [ ] 实现解析器并重跑本任务测试，确认PASS。

## Task 3: Work、断点与96小时调度

**Files:** 新建job、scheduler及 `.test.ts`；修改 `apps/worker/src/queue.ts`、`apps/worker/src/main.ts`、`apps/worker/src/sync/scheduler.ts`。

**Interfaces:** resource=`product-reviews`；`SyncRequest.state={itemId,mode,pageBudget}`；`syncProductReviews(request,deps): Promise<ReviewRunSummary>`；`enqueueDueProductReviewSchedules(pool,enqueue,now): Promise<void>`；`nextProductReviewRunAt(from:Date):Date` 精确加96小时。

- [ ] 写失败测试：两页历史写入、budget=1暂停、继续从next URL、重复URL/指纹暂停、blocked失败、恢复保存的batch不submit、增量绝不请求第二页、同商品初始/增量互斥、两个scheduler相同槽只入队一次。
- [ ] 运行 `./node_modules/.bin/vitest run apps/worker/src/jobs/syncProductReviews.test.ts apps/worker/src/sync/product-reviews-scheduler.test.ts`，确认失败。
- [ ] 实现状态机：先保存页面意图，再提交保存batch，再取结果事务提交评论及checkpoint；初始与增量checkpoint隔离。只在真实末页标记初始完成；预算、循环、解析错误分别显示。Redis商品锁使用token校验释放及续租。
- [ ] 添加专用队列默认并发1，所有请求仍遵守共享密钥锁。调度记录保存scheduledAt及确定性batch ID，入队后更新nextRunAt；崩溃重试相同ID，周期不随重启重置。未完成initial不执行incremental。排队错误不能前移计划。
- [ ] 接入同步状态台账：queued/running/completed/failed/paused，输出读取页数、写入/更新数、失败原因和批次ID，不记录原始密钥。
- [ ] 重跑任务测试及 `apps/worker/src/queue.test.ts`，确认PASS。

## Task 4: API与权限

**Files:** 新建route及 `.test.ts`；修改 `apps/api/src/app.ts`、`apps/api/src/routes/sync.ts`（resource白名单/租户资源范围）。复用 `security/credentials.ts` 和 `routes/sku-visibility.ts`。

**Interfaces:** `GET /api/product-reviews/targets`；`POST /api/product-reviews/targets`（管理员手动输入itemId，不要求已关联ERP商品；重复返回已有目标）；`GET /api/product-reviews?itemId=&rating=&from=&to=&q=&page=&pageSize=`；`GET/PUT /api/product-reviews/config`（读取仅configured）；`POST /api/product-reviews/sync`（itemId/mode/pageBudget）；`PUT /api/product-reviews/targets/:itemId/schedule`（enabled）。所有接口使用现有session/visibility解析。

- [ ] 写失败测试：未登录401，成员写入403，越租户/越SKU读不到，授权店铺共享Item可读、无关联Item拒绝，pageSize上限100，非法mode/Item/预算400，配置响应及错误不含key。
- [ ] 运行 `./node_modules/.bin/vitest run apps/api/src/routes/product-reviews.test.ts`，确认失败。
- [ ] 实现上述路由和依赖注入；配置按现有加密存储；同步先验证目标属于当前租户且用户为管理员再入队；手动目标无ERP关联也允许管理员管理。成员只读必须存在可见商品关联。首次真实验证之前服务端限制示例Item与两页预算，验证记录确认后解除试运行限制。启用计划必须显式操作，不自动全开。
- [ ] 返回本地分页数据及产品图片/中文名/SKU、最近成功、下次运行、抓取模式、页数及失败/暂停原因。复用已有商品关联查询并避免N+1。
- [ ] 重跑测试及现有sync权限测试，确认PASS。

## Task 5: 商品评论页面

**Files:** 新建 `apps/web/src/pages/ProductReviewsPage.ts`、对应 `.test.ts`；修改 `apps/web/src/main.ts`、`apps/web/src/dashboard.ts`、`apps/web/src/styles.css`。

**Interfaces:** 导出 `renderProductReviewsPage(container,context)`，按当前页面实际接口适配；只调用Task 4同源API，不暴露Firecrawl地址或key。

- [ ] 阅读ui-ux-pro-max技能及现有页面生命周期接口，确定可复用表格/筛选/分页组件，不更换全站样式。
- [ ] 写失败测试：筛选回第一页、页码请求只读本地API、旧请求晚返回不覆盖新筛选、成员不显示操作、预算暂停显示继续历史、初始进行中禁用增量。
- [ ] 运行 `./node_modules/.bin/vitest run apps/web/src/pages/ProductReviewsPage.test.ts`，确认失败。
- [ ] 实现“添加Item ID”入口和每行独立同步操作、商品选择/筛选栏、图片中文名和省略名称、评论星级正文日期及验证购买标识、服务器分页；顶部显示抓取状态，管理员操作区区分首次/继续/立即增量和96小时计划开关。空数据、失败、暂停、加载分别呈现。手机单列且操作不溢出。
- [ ] 重跑测试；浏览器验证桌面及手机宽度、切换商品和翻页；确认浏览不会触发付费请求。

## Task 6: 集成、迁移与交付

**Files:** 更新本计划勾选状态；新增 `docs/product-reviews-operations.md` 记录配置、恢复、额度与排错。

- [ ] 汇总运行新增测试及受影响旧测试，确认PASS；执行 `./node_modules/.bin/tsc --noEmit -p packages/db/tsconfig.json`，对 `apps/api`、`apps/worker`、`apps/web` 各执行同样命令。既有失败须核实并单列，不误报通过。
- [ ] 核对现有迁移执行器与Doke数据库身份，仅应用新增迁移，不输出连接密码、不启动Docker。备份相关结构，检查新表索引与collation。
- [ ] 使用现有screen服务启动方式重启API/Worker/Web；验证健康检查、带鉴权API、页面资源返回JSON而非HTML、worker消费与状态台账。
- [ ] 复用Task 2两页真实批次结果验证评论持久化、去重和页面；不要为了验收再抓两页。模拟时间验证96小时计划，不默认开启所有目标，不制造额外收费调用。
- [ ] 自审密钥无泄漏、权限无绕过、无无关改动。按用户选择执行方式安排最终审查；汇报实际页数、写入数、预算状态及未解决限制。

## 补充验收：手动 Item 与独立控制

- [ ] Task 1 测试重复添加不重置断点、默认关闭计划且不发起抓取。
- [ ] Task 4 测试管理员可添加未关联Item；成员不能添加或读取未授权手动Item；其他租户无法查询或控制。
- [ ] Task 3 测试暂停只影响指定Item，当前页完成后保存断点并停止下一页；恢复不重抓已完成页。
- [ ] Task 5 展示每Item的首次/继续历史/立即增量/开启暂停计划，互不影响；未关联目标明确标注，缺失图片中文名使用占位。

## Self-review

已逐项对应spec：历史/增量/额度/权限/Work/页面/真实验证均有任务；五项Review Focus均落到具名测试。真实网页结构仍需Task 2确认，不把猜测写作既定字段；收费测试总预算两页。执行过程不自动提交、发布或全商品启用。
