# 美国天气与气候监控实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 ERP 中新增美国本土 48 州天气、短期预报、历史气候和 NOAA 气候展望页面。

**Architecture:** API 服务端统一调用 NWS、NOAA NCEI 和 CPC，使用 Redis 缓存及独立天气队列控制请求频率；MySQL 保存规范化快照和请求状态；Web 仅访问 ERP API，并提供州概览、详情图表和错误状态。

**Tech Stack:** TypeScript、Express、BullMQ、Redis、MySQL/Drizzle、原生 Web UI、现有图表组件。

**Spec:** `docs/superpowers/specs/2026-10-29-us-weather-climate-design.md`

## Global Constraints

- 覆盖美国本土 48 州，不包含阿拉斯加、夏威夷及其他领地。
- NWS 当前观测缓存 10 分钟，短期预报缓存 30 分钟，警报缓存 5 分钟，气候数据和 CPC 展望缓存 24 小时。
- 外部请求必须服务端发起，使用独立天气队列、统一 User-Agent、最小请求间隔、有限指数退避和 429 处理。
- NOAA token 只存服务端加密配置，不进入前端、日志或仓库。
- 任何州或数据源失败不得阻塞其他州；无数据显示“暂无数据”。

## Review Focus

- NWS/NOAA 返回 429 或 5xx：应退避并保留旧缓存，不无限重试（Task 2 测试）。
- 单州数据异常：应返回该州错误状态而不影响 47 个州（Task 3 测试）。
- CPC 概率展望：应显示概率类别而非伪造确定温度（Task 4 测试）。
- 缓存未命中和过期：应只产生一次外部请求并正确设置 TTL（Task 2 测试）。
- NOAA 凭证缺失或泄露风险：API 不返回 token，页面只显示数据源状态（Task 3/5 测试）。

### Task 1: 天气数据模型与 48 州配置

**Files:**
- Create: `packages/db/src/schema/weather.ts`
- Create: `packages/db/migrations/*_weather_snapshots.sql`
- Create: `packages/domain/src/usStates.ts`
- Test: `packages/domain/src/usStates.test.ts`

**Interfaces:**
- Produces `US_STATES_48`，以及天气快照、预报、气候展望和请求状态的表结构。

- [ ] **Step 1: 写失败测试**：断言州配置数量为 48、代码唯一、包含代表坐标；断言不含 AK、HI。
- [ ] **Step 2: 运行 `pnpm --filter @walmart-erp/domain exec vitest run src/usStates.test.ts`，确认测试因配置不存在而失败。**
- [ ] **Step 3: 实现州配置和 Drizzle schema/migration。**
- [ ] **Step 4: 重新运行测试并执行数据库迁移检查。**

### Task 2: NWS/NOAA 客户端、缓存和限流队列

**Files:**
- Create: `apps/api/src/weather/weatherClient.ts`
- Create: `apps/api/src/weather/weatherCache.ts`
- Create: `apps/worker/src/jobs/syncWeather.ts`
- Create: `apps/api/src/weather/weatherClient.test.ts`
- Modify: `apps/worker/src/queue.ts`, `apps/worker/src/main.ts`

**Interfaces:**
- `fetchStateWeather(state: StateConfig): Promise<StateWeatherSnapshot>`
- `fetchStateClimate(state: StateConfig, period: ClimatePeriod): Promise<ClimateSnapshot>`
- `weatherQueueName = 'weather-sync'`

- [ ] **Step 1: 写失败测试**：验证缓存命中不发请求、429 有限退避、缓存 TTL 和 User-Agent。
- [ ] **Step 2: 运行天气客户端测试并确认失败。**
- [ ] **Step 3: 实现 NWS points/forecast/hourly/observations/alerts、NOAA NCEI/CPC 客户端和 Redis cache-aside。**
- [ ] **Step 4: 实现独立 BullMQ 天气队列，限制请求间隔并落库快照。**
- [ ] **Step 5: 运行客户端、Worker 类型和队列测试。**

### Task 3: 天气 API 和运行状态

**Files:**
- Create: `apps/api/src/routes/weather.ts`
- Create: `apps/api/src/routes/weather.test.ts`
- Modify: `apps/api/src/app.ts`

**Interfaces:**
- `GET /api/weather/states?q=&sort=&page=&pageSize=`
- `GET /api/weather/states/:stateCode`
- `GET /api/weather/health`

- [ ] **Step 1: 写失败测试**：验证 48 州概览、单州失败隔离、鉴权、token 不出现在响应。
- [ ] **Step 2: 运行路由测试并确认失败。**
- [ ] **Step 3: 实现 API，返回脱敏状态和缓存数据。**
- [ ] **Step 4: 运行路由测试和 API 类型检查。**

### Task 4: 气候展望和历史数据适配

**Files:**
- Create: `apps/api/src/weather/climate.ts`
- Create: `apps/api/src/weather/climate.test.ts`

**Interfaces:**
- `ClimateOutlook` 使用 `aboveNormal/nearNormal/belowNormal` 概率字段。
- `ClimateSnapshot` 包含历史均值、极值、降水和更新时间。

- [ ] **Step 1: 写失败测试**：验证 CPC 概率类别保留原值，缺失字段不转成确定温度。
- [ ] **Step 2: 运行测试确认失败。**
- [ ] **Step 3: 实现 NCEI 月度聚合和 CPC 6–10 天、8–14 天、月度、季节性适配器。**
- [ ] **Step 4: 运行气候适配器测试。**

### Task 5: Web 页面和导航

**Files:**
- Create: `apps/web/src/pages/WeatherClimatePage.tsx`
- Modify: `apps/web/src/dashboard.ts`, `apps/web/src/styles.css`
- Test: `apps/web/src/pages/WeatherClimatePage.test.ts`

**Interfaces:**
- 页面调用 `/api/weather/states` 和 `/api/weather/states/:stateCode`。
- 提供州搜索、排序、详情切换、天气/气候图表、悬停数值和空状态。

- [ ] **Step 1: 写失败渲染测试**：验证 48 州列表、温度/降水显示、概率展望标签和无数据状态。
- [ ] **Step 2: 运行 Web 测试确认失败。**
- [ ] **Step 3: 实现页面、导航入口和响应式样式。**
- [ ] **Step 4: 运行 Web 类型检查和页面测试。**

### Task 6: 联调、部署配置和安全验证

**Files:**
- Modify: `.env.example`, `RUNBOOK.md`, `docker-compose.yml`
- Create: `apps/api/src/weather/weather.e2e.test.ts`

- [ ] **Step 1: 添加 NOAA 配置项说明和迁移/缓存运行说明，不写入真实 token。**
- [ ] **Step 2: 编写端到端测试，验证缓存命中、队列隔离、单州失败隔离和响应脱敏。**
- [ ] **Step 3: 运行 API/Worker/Web 类型检查、相关测试和 `git diff --check`。**
- [ ] **Step 4: 重启 API、Worker、Web，验证天气健康接口和页面加载。**
