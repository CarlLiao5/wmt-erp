# ALLSKU 负责人权限应用到经营模块

## 目标

把已存在的 ALLSKU2026「当前负责人」SKU 可见范围应用到 Inventory、WFS、Pricing、Advertising 和 Targets。管理员保持现有全租户/全店铺视图；成员只能读取自己负责的店铺与 SKU，权限在服务端计算，前端筛选不能扩大范围。

## 已有权限来源

复用 `resolveCommerceVisibility()` 和 ALLSKU 负责人映射，不建立第二套授权数据。可见 SKU 以 `storeId + SKU` 为键；已有显式 `sku_assignments` 与店铺授权继续按现行权限模型工作。成员范围必须 fail closed：缺少可见范围时返回空结果，不回退为整店。

## 各模块行为

### Inventory

- `/api/inventory` 先按成员可见店铺+SKU筛选库存行，再应用请求中的 SKU、商品名、仓库、风险、库龄等筛选。
- `/api/inventory/:sku/logs` 先确认该 SKU 在请求店铺下可见；未授权按 404 处理，不返回库存日志、订单销量或月汇总。
- `/api/inventory/storage-fees` 的 Recon 仓储费是店铺级数据，现有标准化行没有 SKU 归属。成员请求不返回金额、费用行或账期明细；管理员逻辑不变。

### WFS

- `/api/wfs/shipments` 过滤货件的 SKU 明细，只返回至少含一个可见 SKU 的货件；货件汇总数量和已收/已发数量从过滤后的明细重算，不能沿用全货件汇总值。
- 货件头字段仅在过滤后货件中返回。成员只能读取可见 SKU 的收货和发货数字。
- `/api/wfs/reconciliations` 若记录无法可靠关联到可见 SKU，则成员返回空结果；如后续确认记录可按 SKU 归属，才允许返回对应可见行。管理员逻辑不变。

### Pricing

- `/api/pricing` 仅返回成员负责的 `storeId + sku` 价格、激励与促销快照。搜索、来源、日期筛选都在权限范围内进一步收窄。
- 未知/未映射 SKU 对成员不可见；管理员逻辑不变。

### Advertising

- SEM 商品、逐日 performance、搜索词记录含 SKU，可按成员负责 SKU 过滤；其所有列表、指标和词云输入都仅来自过滤后的行。
- 当前 `/api/advertising` 的一般广告事实为店铺/广告活动粒度，没有 SKU 字段，成员不返回这类整店记录；管理员逻辑不变。
- 不根据 Campaign、商品名或用户传入 SKU 推断权限归属。

### Targets

- 成员完成销售额从订单行按 `storeId + SKU` 权限范围内计算；店铺或租户 `daily_facts` 汇总不用于成员响应。
- 当前 `sales_targets` 是店铺/月级，无法可靠拆到个人 SKU。成员响应中不返回全店目标值和基于全店目标计算的完成率，目标字段返回 `null` 并标识不可按 SKU 分配。
- Targets 的目标导入、导入批次详情、导出和提交接口会暴露或修改不可按 SKU 分配的店铺目标，因此仅管理员可访问；成员请求返回 403。空白导入模板可按现有行为读取，因为不含业务数据。
- 管理员继续使用现有目标及 `daily_facts` 口径。

## 不在本次范围

- 不改 Dashboard、Orders、Returns、Performance 的页面或权限行为；本设计只确保被点名的五个模块接口不经其他粒度的数据泄漏。
- 不增加数据库迁移，不生成个人目标，不修改 ALLSKU 同步或 Walmart 同步。
- 不改变管理员当前结果、页面筛选样式和导航。

## API 与实现约束

- `app.ts` 将已有 visibility provider 传入 Inventory、WFS、Pricing、Advertising 和 Targets 路由。
- 将权限过滤器作为纯函数或路由边界的明确步骤，覆盖成员、管理员、无权限 SKU、同 SKU 跨店铺、空权限等情况。
- 聚合、计数、金额、分页总数和词云来源必须在过滤后计算。
- 查询参数只能缩小结果；成员不得通过省略 `storeId`、提交其他 SKU 或访问详情子路由扩大可见范围。
- 对不可拆分的店铺级数据，成员返回空/不可用状态或 403，不返回任何可反推全店规模的数值。

## 验收标准

1. 成员访问五个模块时只能得到当前负责人映射或明确 SKU 授权的 `storeId + SKU` 数据；不同店铺同名 SKU 不串权。
2. 没有可见 SKU 的用户得到空列表和空汇总；请求未授权的 SKU 日志不会得到 200 内容。
3. Inventory 指标、WFS 货件摘要、Advertising 指标/搜索词集合和 Targets 完成销售额与可见明细一致。
4. 成员看不到店铺级仓储费、无 SKU 归属的广告事实、整店 Recon 对账记录、店铺级目标值及目标导入业务记录。
5. 管理员的既有数据范围和计算保持不变。
6. 覆盖 API 层过滤测试与对应纯函数测试；修改后运行受影响 API 测试和 API TypeScript 检查，并检查 `git diff --check`。
