# 库存加载性能核对（2026-11-18）

环境：Doke MySQL，default 租户；不使用 Docker 数据库。

## 实测

原 mysqlInventorySource：296910 ms，462 行。最新库存 33387 ms，健康快照 54433 ms，库龄三批 9945/11932/2950 ms，全部货件收货日志汇总 215979 ms。

优化后 source：5891 ms，462 行。最新库存 1268 ms，健康快照 3417 ms，库龄单批 484 ms，当前头程货件收货汇总 715 ms。

重启真实 API listener 后，登录态 HTTP /api/inventory：首次 7907 ms、紧接缓存命中 8 ms，均 HTTP 200、462 行。网络及数据库负载会影响冷请求耗时；这不是浏览器端渲染耗时。

## 修改

- 最新库存先只按 ID 排序选最新记录，再关联 SKU；保留历史 store:SKU 身份兼容。
- 健康快照只对窄索引记录排序，再读取选中的必要字段。
- 库龄每批上限 1000；新增覆盖索引 wfs_inventory_age_cover_idx (tenant_id,snapshot_id,bucket_name,quantity)，SQL migration 0057 已在 Doke 在线执行。
- 收货汇总复用 shipmentReceiptTotals，只查询已发货头程货件，使用已有 receipt covering index。
- 库存页异常货件卡片改用 WFS summary 端点，继续独立异步加载。
- 原 5 秒缓存及请求合并保持；每个请求仍执行原可见性过滤。

## 数据与检查

/tmp/inventory-before.json 与 /tmp/inventory-after.json 按 store/SKU/node 及货件明细排序后 deepStrictEqual；462 条所有字段一致，含库存、在途、库龄、名称及图片。

20 项定向测试通过：inventory、inventory-transit、InventoryPage、inventory-health-loading。API/Web/DB tsc 通过，git diff --check 通过。

复测工具 scripts/benchmark-inventory-loading.ts 和 scripts/verify-inventory-http-performance.mjs。未进行浏览器 UI 自动化验证。
