# ERP 外部端点标准化入库盘点

核查日期：2026-11-17。只读核查当前源码和 Doke 当前 schema（walmart），未修改数据库或启动同步。

## 判定口径

标准化指业务实体、关联标识、主要查询/统计字段有明确列及租户/店铺范围，Worker 实际写入；独立表只有 payload JSON 不算业务字段已标准化。保留原始 JSON 本身不是缺陷。认证、轮询、下载、健康检查和聚合展示端点不要求各建业务表。

范围为本仓库已接入、适配器已定义和后端实际消费的端点/资源族，不是 Walmart 官方全部 API。端点族合并展示；同一个异步报告的提交、状态、下载不重复计为三项缺口。数据库行数使用 COUNT(*)，不是 information_schema.TABLE_ROWS 估算值，查询时后台任务仍可能改变数量。

## 明确缺口与部分标准化

| 优先级 | 资源 / 端点 | 当前情况 | 缺口 / 建议 | 源码依据 |
|---|---|---|---|---|
| P1 | WFS 库存健康 GET /v3/wfs/inventory | 数量写 inventory_snapshots，部分商品信息写 skus；完整响应存 raw_payloads | 首次入库时间、库龄分布、预留量等仍在 JSON，库存页面运行时解析；建议建健康快照及库龄桶明细，保留 SKU/节点/抓取批次 | apps/worker/src/jobs/syncWfs.ts；packages/db/src/schema/inventory.ts；apps/api/src/routes/inventory.ts |
| P1 | 企业微信 ALLSKU2026 记录查询 | smartsheet_allsku_rows 有源行、租户、批次和 payload，但无业务列 | SKU、中文名称、负责人等仍依赖动态 JSON 解析；建议拆业务列/关系表，保留原字段归档 | packages/db/src/schema/smartsheet.ts；apps/worker/src/jobs/syncHeadFreight.ts；apps/api/src/routes/allskuOwnerMapping.ts |
| P2 | Walmart ITEM 异步报告 /v3/reports/reportRequests（ITEM）及下载 | SKU/Item ID/名称/品牌/上架状态/主图写 skus；其余报告字段放 details.itemReport | 仅部分标准化；没有报告逐商品历史快照表，后续报告合并覆盖 details；建议按实际报告字段建商品报告快照并提取常用列 | apps/worker/src/jobs/syncItemReport.ts:36；packages/walmart-client/src/adapters/itemReport.ts:46 |
| P2 | Firecrawl 抓取 Walmart 评论页 | 评论正文、星级、作者、时间、verifiedPurchase、实际变体 Item/名称/图片/规格、总评分及星级快照已有标准表 | sellerId/sellerName、fulfilledBy、推荐标记、反馈数、媒体、徽章、语言、reviewAspects 等仍在 raw_payload；按需要拆列/子表。review_features 是有边界的规格集合 JSON，不等于整条评论未标准化 | packages/db/src/schema/product-reviews.ts；apps/worker/src/reviews；Doke product_reviews 实际列 |
| P2 | 订单 GET /v3/orders | 订单主表和订单行主要金额、状态、地址区域、产品信息已标准化 | 全量响应并非每字段拆列，完整状态历史、包裹轨迹及部分金额子项等需逐字段扩展；不是订单完全没入库 | packages/db/src/schema/orders.ts；apps/worker/src/jobs/commerceRawStore.ts |
| 待确认用途 | ERP GET /api/wfs/reconciliations | 页面后端从 raw_payloads.resource=wfs_reconciliations 读取 | 未发现对应 Worker 上游适配/同步写入，也没有该资源原始记录或专用标准表；是预留/未闭环功能，不能当成已成功同步的资源 | apps/api/src/routes/wfs.ts:237；apps/worker/src/queue.ts 支持列表；Doke raw 资源分组 |

## 已标准化主要资源（实际 COUNT(*) 抽查）

| 资源族 | 标准表 | 抽查行数 / 备注 |
|---|---|---|
| 货件及 SKU 明细 /v3/fulfillment/inbound-shipments、inbound-shipment-items | wfs_shipments / wfs_shipment_items | 1,407 / 585；已切标准表查询 |
| 库存数量 | inventory_snapshots | 32,465；健康扩展字段见缺口 |
| 库存日志 /v3/fulfillment/inventory-log | wfs_inventory_logs | 已有明确数量、原因、货件、SKU、时间、仓库字段 |
| 商品主数据 | skus | 673；报告扩展字段见缺口 |
| 订单 /v3/orders | orders / order_lines | 134,771 / 148,619 |
| 退货 /v3/returns | return_records / return_status_events | 29,086 / 26,052；reason/code、责任等已有列 |
| 价格洞察 /v3/price/getPricingInsights、激励 /v3/price/incentives、促销 /v3/promo/sku/:sku | price_snapshots | 9,483；核心价格、类型、激励、促销周期拆列 |
| SEM 活动 performance-summary | advertising_facts | 404（含各 channel） |
| SEM 商品 item-level-summary | sem_item_advertising_facts | 2,367 |
| SEM_PERFORMANCE 异步报告 | sem_performance_daily | 15,178 |
| SEM_SEARCH_TERMS 异步报告 | sem_search_terms_daily | 22,839 |
| 站内广告领星来源 | ad_item_report / ad_keyword_report / ad_Placement | 已有字段化业务表；当前仓库 Worker 领星脚本直接写 ad_item_report，关键词/位置的历史表有数据，不据此声称当前 Worker 覆盖三表同步 |
| 卖家绩效 | performance_snapshots | 2,800；metric/value 周期快照 |
| Recon 财务报告 availableReconFiles / reconFileJson | payment_reports / recon_transactions / storage_fees | 原始报告页 437；交易 406,394；仓储聚合 23。payment_reports 是原始报告容器，已有 recon_transactions 不应误判为整族未标准化 |
| 企业微信头程 | head_freight_rows | 680；数量/日期/金额部分仍是 varchar，有类型优化空间 |
| 货代轨迹 | freight_tracking_routes / freight_tracking_events | 269 / 3,009 |
| 领星货件 SKU 成本 | lingxing_shipment_sku_costs | 204 |
| 外部库存 Bright Data | brightdata_item_names / brightdata_product_inventory | 商品库存、价格、评分等快照已有列 |
| 评论抓取 | product_reviews / product_review_snapshots | 1,108 / 223；扩展字段见缺口 |
| NWS/NOAA 天气 | weather_snapshots / weather_forecasts / climate_outlooks / weather_request_status | 实况、预报、气候和请求状态已有表；地理发现/站点查询为辅助缓存 |
| ITS 预估 /inbound-preview | wfs_fee_preview_runs / options / items | 已有标准化结构；任务此前按用户要求搁置，空表/少成功不等于没建标准化 |

## 已有标准表但仍依赖旧原始源

1. 库存页面：健康字段仍读 raw_payloads，再与 inventory_snapshots 合并。
2. ITS 预估任务：syncWfsFeePreview.ts:208-209 仍从 raw_payloads 读取货件和商品；应切 WfsShipmentRepository。结果端已标准化；任务保持搁置。
3. ALLSKU 负责人/中文名称映射：从 smartsheet_allsku_rows.payload 解析业务值。
4. 商品报告：读取 skus.details.itemReport 中未拆列的字段。
5. 价格同步含从历史 pricing-incentives 原始归档重放标准化的兼容逻辑；这不等于 price_snapshots 未标准化。

## 仅有适配器、未接当前业务同步的端点

- /v3/items：listItems 有定义；当前正式商品路径是 ITEM 报告。
- /v3/inventories、/v3/fulfillment/inventory：适配器存在；当前 WFS 路径显式使用 /v3/wfs/inventory，旧路径无正式调用。
- /v3/price：listPriceSnapshots 定义存在，实际价格同步使用洞察/激励/促销三个来源。
- /v3/reports：listExistingReports 定义存在，无正式消费链路；不能等同于具体异步 ITEM/SEM 报告没入库。
- /v3/report/payment/statement：getPaymentStatement 定义存在，无正式调用；当前财务业务走 Recon JSON。若需要结算单独有余额/结算状态，需另接入标准化。

## 本次未做的事

未修改业务口径、表结构或同步任务；未额外调用外部 API。此审计确认资源级标准化和已识别的字段级缺口，不宣称已逐个比对所有上游版本的每一个返回字段。暂未将未接入的官方端点列为 ERP 缺陷。
