# 货代物流轨迹同步 Work 实施计划

> **For Codex:** REQUIRED SUB-SKILL: use executing-plans to implement this plan. Tasks use TDD: add focused failing tests, implement the smallest change, run the targeted suite, then proceed. Preserve all existing worktree changes.

**Goal:** 把 `/Users/carl/Downloads/new_system/` 的多品牌物流追踪功能接入现有 ERP 同步队列，按头程货代入库号查询，轨迹与事件保存到 `walmart_erp`。

**Architecture:** API 只接受管理员提交的租户级 `freight-tracking` work；BullMQ payload 仅带租户、日期窗口和 batch ID。Worker 从同一租户的 `head_freight_rows` 读取去重货代入库号，按前缀将工作分给四个品牌客户端，从 `WuLiulogin` 运行时读取配置和凭证，归一化后将路线、事件和原始响应持久化到两张新表及 `raw_payloads`。Sync Status 复用现有任务入口展示触发按钮和处理统计。

**Tech Stack:** TypeScript、Express、BullMQ、Drizzle ORM、MySQL、Vitest、现有 React/HTML Sync Status 实现。

**Approved design:** [`../specs/2026-10-23-freight-tracking-sync-design.md`](../specs/2026-10-23-freight-tracking-sync-design.md)

## Implementation Tasks

### Task 1: 提取物流品牌识别与轨迹归一化规则

**Files:**
- Create: `apps/worker/src/freight-tracking/brands.ts`
- Create: `apps/worker/src/freight-tracking/brands.test.ts`
- Create: `apps/worker/src/freight-tracking/normalize.ts`
- Create: `apps/worker/src/freight-tracking/normalize.test.ts`

1. 先写前缀识别测试：只接受 `QT → qitexp`、`TT → skytuo`、`DSL → desu`、`YLD/DP → depaex`；忽略大小写和首尾空白；其他前缀返回 unmatched。
2. 先写轨迹归一化测试：从脚本返回结构提取已发生事件；最新事件按时间戳选择；将已签收映射成 `delivered`；无已发生事件不伪造时间或状态。
3. 运行以上测试，确认新增断言先失败。
4. 实现纯函数，不引入新的运行时依赖；事件保留来源顺序、原始展示时间和 event JSON。
5. 运行 `./node_modules/.bin/vitest run apps/worker/src/freight-tracking/brands.test.ts apps/worker/src/freight-tracking/normalize.test.ts`。

**Acceptance:** 前缀和状态判定与脚本一致；未知前缀不误分配；时间缺失不会伪造最新事件。

### Task 2: 新增路线、事件数据库 schema 和迁移

**Files:**
- Create: `packages/db/src/schema/freight-tracking.ts`
- Modify: `packages/db/src/schema/index.ts`
- Create: `packages/db/src/schema/freight-tracking.test.ts`
- Create: `packages/db/migrations/0030_freight_tracking.sql`
- Modify: `packages/db/migrations/meta/_journal.json`

1. 先写 schema 测试：路线表按 `(tenant_id, freight_forwarder_inbound_number)` 唯一；事件表按 `(route_id, route_order)` 唯一；两表均带 tenant scope 和查询索引；原始响应引用现有 `raw_payloads`。
2. 运行针对 schema 的测试确认失败。
3. 新增 `freight_tracking_routes`，保存货代入库号、品牌、标准状态、状态原文、最后事件 UTC 时间、最后成功抓取时间、batch/raw payload 关联、头程来源行 ID 列表及审计时间。
4. 新增 `freight_tracking_events`，保存路线 ID、事件顺序、来源时间文本、事件 UTC 时间、描述、事件代码和原始 JSON。
5. 增加与 Drizzle 定义一致的编号迁移及 journal 条目；不在本任务自动执行数据库迁移。
6. 更新 schema 导出并运行 schema 测试、`packages/db` 类型检查。

**Acceptance:** migration 和 Drizzle 定义一致；路线唯一键允许不同租户使用相同入库号；事件快照可按路线和顺序读取。

### Task 3: 从 `WuLiulogin` 安全加载品牌配置

**Files:**
- Create: `apps/worker/src/freight-tracking/credentials.ts`
- Create: `apps/worker/src/freight-tracking/credentials.test.ts`

1. 先用注入的 query function 编写配置读取测试，覆盖四品牌映射、字段缺失和安全行为；断言任何返回结果/错误文本不含模拟密码。
2. 运行测试确认失败。
3. 从 Worker 的 ERP MySQL 连接读取 `WuLiulogin` 中单个品牌的 `display_name`、`login_url`、`search_url`、`username`、`password`、`prefix_patterns`、`extras_json`。使用参数化 SQL；仅在客户端构造期间传递必要凭证，不写日志。
4. 不把凭证放入 BullMQ job、Sync Job 结果、`raw_payloads` 或 API；登录客户端禁止将 request/response headers 和认证响应原样记录。
5. 运行凭证单元测试和 Worker 类型检查。

**Acceptance:** 成功读取时只有 Worker 内存含凭证；缺少配置的错误指出品牌和缺失字段，不回显凭证内容。

### Task 4: 实现四个品牌的 HTTP 客户端和响应解析

**Files:**
- Create: `apps/worker/src/freight-tracking/clients.ts`
- Create: `apps/worker/src/freight-tracking/clients.test.ts`
- Create: `apps/worker/src/freight-tracking/fixtures/`（仅脱敏的小型响应 fixture）

1. 基于 `new_system/src/qitexp_client.py`、`src/desu_client.py` 和 `src/parsers.py` 的真实请求与响应字段写 mock-fetch 测试，不访问真实货代服务。
2. 覆盖 qitexp 系客户端登录、关键词查询、内部 ID 详情、token 过期后重登；覆盖 desu 登录、订单分页映射、详情与轨迹查询及 multipart 读请求。
3. 确认测试先失败。
4. 实现 `qitexp/skytuo/depaex` 共用客户端及独立 `desu` 客户端；URL 使用 `WuLiulogin` 配置。每品牌任务只登录一次，token 只驻留实例内存。
5. 为 desu 在单个 Worker 任务内按页建订单号到内部 ID 的内存映射，不读取/写入 `~/.wuliu/desu_code_to_id.json`。分页用总数和游标/页码终止条件，并防止重复页或空页死循环。
6. 为每个网络调用设置超时；保留脚本中 token 失效后的单次重登和默认逐号 500ms 间隔。错误转换时删除认证头、密码和完整认证响应。
7. 运行客户端与解析器测试。

**Acceptance:** 四品牌按原脚本协议工作；解析失败会抛出脱敏错误；认证资料不会进入错误文本；所有测试仅用 mock fetch。

### Task 5: 实现按租户同步、过滤和原子持久化

**Files:**
- Create: `apps/worker/src/jobs/syncFreightTracking.ts`
- Create: `apps/worker/src/jobs/syncFreightTracking.test.ts`

1. 先写 job 测试：只查当前租户头程表、货代号去重、前缀路由、已签收跳过、超过 30 天跳过、首次查询、单号失败隔离、跨品牌继续、结果计数准确。
2. 写持久化测试：成功后新增/更新路线、保存成功原始响应并以事务替换事件快照；失败和解析失败不修改已有路线/事件；连续运行不产生重复路线或事件。
3. 用 fake repository 和 fake carrier client 注入依赖，确认 RED 后再实现 job。
4. 按 `tenant_id` 查询 `head_freight_rows` 中非空的 `freight_forwarder_inbound_number`，收集每个入库号对应的头程行 ID，并按规范化入库号去重。
5. 按四品牌并行、品牌内部串行逐号执行；默认 0.5 秒节流。每条记录失败独立捕获。未知前缀不发请求。
6. 过滤规则：若现有路线 `current_status === 'delivered'`，或最后事件早于 `now - 30 days` 则跳过；无路线记录则首次查询。只有成功获取并完成解析后，才在事务内 upsert 路线、追加一条关联本批次的新 `raw_payloads` 原始响应、替换事件列表。原始响应只追加不覆盖；查询失败不写空 payload，也不修改已有路线/事件。
7. 结果返回 `sourceShipments/matched/queried/written/notFound/skippedDelivered/skippedStale/skippedUnmatched/failed` 和少量脱敏错误摘要。批次完整运行后正常返回，保留逐货件失败计数；任务级错误抛出。
8. 运行 job 测试和 Worker 类型检查。

**Acceptance:** 同一任务只查一次每个不同货代号；租户隔离；重抓幂等；失败保留旧数据；任务统计总数可核对。

### Task 6: 接入 API 白名单和 BullMQ Worker 分发

**Files:**
- Modify: `apps/api/src/routes/sync.ts`
- Modify: `apps/api/src/routes/sync.test.ts`
- Modify: `apps/worker/src/queue.ts`
- Modify: `apps/worker/src/queue.test.ts`

1. 测试 API 接受管理员租户级 `freight-tracking` 请求并强制 `storeId: '__tenant__'`；拒绝成员、缺失窗口和普通店铺资源范围误用。
2. 测试 Worker 分发 `freight-tracking` 不加载 Walmart 店铺连接；确认 credentials 只由 Worker handler 读取。
3. 确认新增测试先失败。
4. 在 API tenant-resource whitelist 和 Worker resource dispatch 加入 `freight-tracking`，默认处理器调用 `syncFreightTracking`。
5. 保持通用窗口结构兼容 UI，但不按窗口裁剪要处理的头程货件；结果写入现有 `sync_jobs.result_payload`。
6. 运行 API/Worker 针对测试和类型检查。

**Acceptance:** API 只允许管理员触发；tenant 从认证 session 推导；Worker 不读取 Walmart credentials 或产生远端 Walmart 请求。

### Task 7: 增加 Sync Status 综合按钮与结果说明

**Files:**
- Modify: `apps/web/src/dashboard.ts`
- Modify: `apps/web/src/dashboard.test.ts`
- Modify: `apps/web/src/styles.css`（若现有按钮布局需要）

1. 测试管理员视图显示一个租户综合「同步物流轨迹」按钮，普通成员不显示；最近任务标签为「物流轨迹」。
2. 测试结果按统计显示写入、未找到、已签收跳过、30 天无更新跳过、未识别前缀及失败数量；不显示任何 credential 字段。
3. 确认测试先失败。
4. 将按钮接到 `/api/sync`，资源为 `freight-tracking`、store 为 `__tenant__`；复用现有通用点击处理与时间窗口。
5. 在最近任务中用结果摘要呈现计数，批次详情沿用现有格式；避免增加第二个同步入口或业务页面。
6. 运行对应 Web 测试和类型检查。

**Acceptance:** 管理员一键触发；成员无法看到/触发；完成任务可看清数量分类及批次 ID。

### Task 8: 迁移核对与端到端验收

**Files:**
- Review: `packages/db/migrations/0030_freight_tracking.sql`
- Review: `docs/superpowers/acceptance/`（新增验收记录）

1. 人工核对 migration、Drizzle schema、迁移 journal 三者结构一致；先用空 MySQL 结构验证脚本检查，再核对当前开发库是否缺表。迁移遵循仓库惯例，由用户/操作者审阅后手动应用，不自动执行。
2. 在 job + 客户端 fake 的集成测试中验证完整调用链：头程行 → 去重/前缀映射 → credentials provider → carrier adapter → raw/routes/events 落库 → result payload。
3. 用本地测试数据库 fixture 执行一次无外部网络同步；fixture 明确标记为测试数据。真实货代登录只在应用真实账号后由用户手动点击触发，本计划不执行真实服务请求。
4. 运行相关 Vitest、API/Worker/Web/DB `tsc --noEmit` 和 `git diff --check`。
5. 核对 `sync_jobs` 与新表使用同一 batch ID；检查日志和任务结果不包含密码或 token；确认旧头程数据和其他未提交改动未被修改/覆盖。
6. 按仓库运行方式仅重启受改动影响的 API、Worker、Web 服务，并检查 API/Web 健康状态及一个 fixture 同步任务的状态/计数（真实迁移需先完成）。

**Acceptance:** 迁移审阅完成、自动化验证通过、fixture end-to-end 通过、日志无敏感数据；用户可以在 Sync Status 发起后续的真实同步。

## Review Gates

- **Gate A — 设计**：已通过，参见已批准设计文档。
- **Gate B — 计划**：当前文档待用户审阅。
- **Gate C — 实施**：待计划确认并选定执行方式后开始；实现遵循 TDD，完成每个任务后汇报验证结果。
- **Gate D — 数据库迁移和真实外部请求**：只在迁移 SQL 经审阅、凭证字段兼容性确认后执行；默认先用 mock/fixture，不在开发验证期间打印或试探账号密码。
