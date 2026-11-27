# 商品分析页面实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增一个按授权商品查看销售、退货、广告和词项表现的商品分析页面。

**Architecture:** 后端提供商品搜索与单次聚合接口，先应用租户、店铺和 SKU 可见性，再从现有订单、退货、广告事实和商品目录聚合。前端新增独立页面，复用现有日期选择器、图片、SVG/柱状图/词云模式，所有指标和图表由同一次聚合响应驱动。

**Tech Stack:** TypeScript、Fastify、Drizzle/MySQL、React、现有 SVG/CSS 图表组件。

**Spec:** `docs/superpowers/specs/2026-10-22-product-analysis-design.md`

## Global Constraints

- 默认日期范围为最近 30 天；开始日期不得晚于结束日期。
- 后端先按 tenant/store/SKU 权限过滤，再做任何聚合。
- 不新增第三方图表依赖。
- 无数据显示“暂无数据”，不把空结果伪装成 0。
- 金额返回数值，前端按 USD 格式化；比率返回 0-1 数值。

## Review Focus

- 跨店铺同 SKU：搜索结果和聚合必须携带并使用 `storeId`，避免串店。
- 反向日期和无效日期：接口返回 400，页面阻止提交并保留选择状态。
- 无订单销售额为 0：退货率和广销比必须为 `null`，前端显示暂无数据。
- 普通成员越权搜索：搜索与分析接口都不能返回未授权商品或事实。
- 词项和退货原因为空：图表显示空状态，不能渲染 NaN、空 SVG 或伪造词项。

### Task 1: 商品搜索与分析聚合后端

**Files:**
- Create: `apps/api/src/routes/product-analysis.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/routes/items.ts`（复用或抽取授权商品搜索查询）
- Test: `apps/api/src/routes/product-analysis.test.ts`

**Interfaces:**
- `GET /api/product-analysis/products?q=<sku|name|itemId>&limit=<n>` 返回授权商品摘要 `{storeId, sku, itemId, productName, imageUrl}`。
- `GET /api/product-analysis?sku=<sku>&storeId=<id>&from=YYYY-MM-DD&to=YYYY-MM-DD` 返回设计文档中的 `product`、`range`、`metrics`、四类趋势、退货原因和两组词项。

- [ ] **Step 1: Write failing route tests**：覆盖商品搜索、正常聚合、跨店铺隔离、反向日期 400、销售额为 0 的 null 比率、空词项空原因。
- [ ] **Step 2: Run `node node_modules/vitest/vitest.mjs run apps/api/src/routes/product-analysis.test.ts`**，确认测试先失败。
- [ ] **Step 3: Implement authorization-aware product search and aggregation**：复用现有可见性查询；订单按 `orderedAt` 聚合 `quantity/amount`；退货按 SKU、店铺和 `returnedAt` 聚合；广告按现有站内/SEM事实字段过滤；统一生成每日序列并计算比率。
- [ ] **Step 4: Register routes and run the focused test**，确认全部通过。
- [ ] **Step 5: Run API typecheck**：`node node_modules/typescript/bin/tsc --noEmit -p apps/api/tsconfig.json`。

### Task 2: 商品分析页面与导航入口

**Files:**
- Create: `apps/web/src/pages/ProductAnalysisPage.tsx`
- Modify: `apps/web/src/app.ts`
- Modify: `apps/web/src/styles.css`
- Test: `apps/web/src/pages/ProductAnalysisPage.test.tsx`（若现有前端测试配置支持页面测试）

**Interfaces:**
- 页面调用 Task 1 的搜索和分析接口；选择商品后仅发起一次聚合请求。
- 页面默认 `from/to` 为最近 30 天，沿用 `DateRangePicker`。

- [ ] **Step 1: Add failing UI tests or route-level assertions**：验证导航入口、商品搜索选择、默认日期、反向日期禁用提交、loading 保留筛选控件。
- [ ] **Step 2: Implement page shell**：顶部搜索/商品摘要/日期筛选，指标区显示销售额、销量、退货、退货率、站内花费及广销比、SEM 花费及广销比、总广销比。
- [ ] **Step 3: Implement chart sections**：销售趋势双序列、广告花费三序列可切换、退货原因可点击 SVG 扇形图、退货趋势按日点击收窄日期、SEM 与站内词云点击展示明细；所有空状态和 loading 稳定渲染。
- [ ] **Step 4: Add responsive styling and navigation wiring**：移动端单列、长文本截断并保留 title、禁止页面级横向滚动。
- [ ] **Step 5: Run web typecheck**：`node node_modules/typescript/bin/tsc --noEmit -p apps/web/tsconfig.json`。

### Task 3: 端到端复核与运行验证

**Files:**
- Modify: `apps/api/src/routes/product-analysis.test.ts`（补齐发现的问题）
- Modify: `apps/web/src/pages/ProductAnalysisPage.tsx`（补齐发现的问题）

- [ ] **Step 1: Run focused API and web tests/typechecks**，确认接口结构和页面调用一致。
- [ ] **Step 2: Run `git diff --check`**，修复格式问题。
- [ ] **Step 3: 重启 API/Web，访问商品分析入口**，验证默认 30 天、搜索选择、指标、四类趋势、退货原因和两组词云。
- [ ] **Step 4: 验证普通成员与管理员账号**，确认 SKU 可见性和店铺隔离符合现有规则。
