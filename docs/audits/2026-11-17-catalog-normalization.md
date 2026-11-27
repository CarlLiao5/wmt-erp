# 商品资料与 SKU / Item ID 标准化验证

- 数据源：Doke，未使用 Docker 数据库。
- 商品与库存读取 ALLSKU 独立 SKU、店铺、中文名和负责人字段；保留现有歧义拒绝与权限规则。
- 商品、库存图片和销售 SKU 聚合优先读取 skus 独立字段，移除这些主要查询中的 details 回退。
- WFS productId 作为条码，不推断为 Walmart Item ID；空值同步保留已有 Item ID、GTIN、名称，库存快照阶段不再覆盖 Item ID。
- 首次及持续增量共用现有 WFS 处理器，未新增同步模式。

## Doke 补录

- 673 条 SKU 中缺失 Item ID 从 466 条降至 16 条，补齐 450 条。
- 仅补空值；已有非空标识未改动，预览冲突为零。
- 剩余 16 个 Item ID 和 16 张图片无可靠来源，未猜测填充。
- 修改前备份：`/Users/carl/Documents/wmterp/backups/catalog-metadata-1794929795723.json`。
- 可复用脚本：`scripts/backfill-catalog-metadata.ts`，默认预览，`--apply` 写入。

## 验证

- `scripts/verify-catalog-metadata.ts` 实际 Doke 查询：中文名和负责人映射新旧一致；商品 308 条，308 条有 Item ID / 中文名 / 图片；库存 461 条，288 条有中文名、450 条有图片；商品响应不含原始 details。
- 相关 10 个测试文件 62 项通过；最后复跑 ALLSKU、catalog、syncInventory、queue 24 项通过。
- API 与 Worker TypeScript 检查通过；diff 空白检查通过。
- API 已重启且 `/api/health` 正常；新 Worker 心跳正常。旧 Worker 已收到 SIGTERM 排空。
- 本轮未重新执行完整店铺真实首次 / 增量同步，不将路由单测视为全量实跑。
- 已知无关测试失败：syncHeadFreight 的合同号期望单行 PO-1，实际含第二行；本轮未修改该行为。

## 后续真实同步测试

- 使用 `scripts/verify-catalog-live-sync.ts` 对 Doke 店铺 `10001133528`，经生产共用的 `processSyncRequest` 处理器依次运行 initial / incremental；本次直接调用处理器，不产生队列任务卡片。
- 补正 WFS 写库使用逐行解析的 `row.itemId`，支持批量响应中的显式 Item ID；相关 20 项测试及 Worker 类型检查通过。
- initial 批次 `catalog-initial-ff66a341-73f1-4ffb-8206-167992eae986`：747 货件、1026 明细、240 库存快照、343 页 / 6907 条日志，失败为零。
- initial 前后商品均 282 条，已有 Item ID 丢失 0、变化 0。
- incremental 批次 `catalog-incremental-8d0e1c1b-8a7b-4701-b0ba-3d75eced4ad4`：72 货件、106 明细、240 库存快照、343 页 / 6911 条日志，失败为零。
- incremental 前后商品均 282 条，已有 Item ID 丢失 0、变化 0；脚本退出码 0。
- initial 从 2026-11-17T15:47:39Z 至 16:20:41Z；incremental 至 16:34:56Z。首次货件请求不传日期限制，增量货件查询 today-5 并补查未完成货件；两轮库存日志均采用近五天窗口。
