# Bright Data 商品库存同步设计

## 1. 目标

将 `/Users/carl/Downloads/WBKC_BrightData` 的 Walmart Business 商品页面采集能力接入当前 ERP 的同步体系，同时在当前 ERP 数据库中建立独立数据表，保留旧项目的字段语义，便于未来从旧数据库迁移历史数据。

## 2. 已确认边界

- 不新建数据库，使用当前 ERP MySQL 数据库。
- 不复用或改写现有 `items`、`inventory` 业务表。
- Bright Data 结果写入独立表，并通过独立接口/页面读取。
- 商品 ID 来源为独立的 `brightdata_item_names` 表，迁移旧库 `item_names` 时保持原始 Item ID。
- 同步任务进入现有 Sync Status，并由现有 Worker 执行。
- 旧项目的每日北京时间 15:00 调度、失败继续、重试和运行统计语义保留。

## 3. 数据模型

### 3.1 `brightdata_item_names`

兼容旧表 `item_names` 的迁移输入，同时增加 ERP 所需的审计字段。

- `id`：ERP 内部主键
- `tenant_id`：租户归属
- `store_id`：可为空，旧数据迁移时允许未匹配店铺
- `item_id`：Walmart Item ID，建立租户 + Item ID 唯一约束
- `source_row_id`：旧表行标识，可为空
- `raw_payload`：旧表原始行 JSON，可为空
- `created_at`、`updated_at`

### 3.2 `brightdata_product_inventory`

保留旧 `product_inventory` 的业务字段：

- `item_id`
- `product_name`
- `available_quantity`，未知时为 NULL，不写成 0
- `queried_at`
- `price`
- `description`
- `rating`
- `review_count`

同时增加 `id`、`tenant_id`、`store_id`、`source_item_id`、`run_id`、`raw_payload`、`created_at`，并建立按租户、Item ID、查询时间的索引。

库存记录采用追加快照，不覆盖历史记录；同一运行的同一商品使用幂等键避免重复写入。

### 3.3 `brightdata_run_history`

兼容旧 `run_history` 的统计字段：

- `run_id`
- `started_at`、`ended_at`
- `total_items`
- `success_count`
- `fail_count`
- `status`
- `error_message`

同步任务 ID 与现有 `sync_jobs` 关联，便于在 Sync Status 查看批次状态和结果。

## 4. 同步流程

1. 用户点击同步或定时器创建 `brightdata-inventory` 任务。
2. Worker 读取当前租户的 `brightdata_item_names`，按 Item ID 去重。
3. 以 3 秒默认间隔调用 Bright Data Web Unlocker；超时/网络错误按 5、10 秒退避重试，4xx 直接记录失败并继续。
4. 解析商品名称、库存、价格、描述、评分和评论数。
5. 成功结果写入 `brightdata_product_inventory`；失败结果写入运行历史并保留错误原因。
6. 更新 `brightdata_run_history` 和 `sync_jobs.result_payload`，前端显示总数、成功数、失败数。

## 5. 配置与安全

Bright Data API Key、Zone、超时、请求间隔、最大重试次数进入 ERP 运行环境变量，不写入数据库明文、不提交到仓库。同步任务只允许服务端读取配置，前端只显示配置状态和最近运行结果。

## 6. 迁移方案

提供独立迁移脚本，不自动删除或改写旧库：

- 从旧库 `item_names` 映射到 `brightdata_item_names`。
- 从旧库 `product_inventory` 映射到 `brightdata_product_inventory`，保留原查询时间。
- 从旧库 `run_history` 映射到 `brightdata_run_history`。
- 使用 `source_row_id` 和幂等键支持重复执行。
- 迁移前执行行数、Item ID 数量和时间范围校验；迁移失败不得标记为完成。

## 7. 接口与页面

- 新增 Bright Data 数据查询接口，支持租户、店铺、Item ID、时间范围和分页。
- Sync Status 增加 `brightdata-inventory` 资源的手动同步入口和运行结果。
- 新增独立 Bright Data 面板入口，导航栏只显示一个“面板”按钮。
- 进入面板后提供页内切换：
  - **库存数据看板**：按商品卡片展示商品名称、Item ID、当前库存、库存变化、评分、评论数、价格和最近趋势；视觉采用深色背景、橙色库存、绿色评分、蓝色价格的分层卡片布局。
  - **产品管理**：按表格展示商品名称、Item ID、分类、创建人、创建时间和操作；支持搜索、分类筛选、分页和后续批量导入扩展。
- 两个视图共享同一组 Bright Data 商品数据和筛选条件，切换视图不改变筛选范围。
- 看板数据展示库存快照的最新值，并以时间序列生成趋势；没有历史数据时显示明确的暂无数据状态。
- Bright Data 面板对所有已登录用户开放完整数据，不应用负责人、店铺或 SKU 权限过滤。

## 8. 验收标准

- 空库迁移能建立三张表并通过 schema 检查。
- 旧库样例数据可重复迁移且不产生重复记录。
- 手动同步任务能在 Sync Status 完成、失败或重试，并记录统计。
- 缺少库存时显示 NULL/暂无数据，不误报为 0。
- Bright Data 4xx 不阻断整批任务，网络/5xx 按策略重试。
- API、Worker、Web 类型检查和相关单元测试通过。
