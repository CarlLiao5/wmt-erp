# WFS 月度库存对账 Worker

- 资源：inventory-recon；手动/首次回填/定时入口共用店铺级报告队列。
- 默认每月 2、8 日 04:00 UTC（北京时间 12:00），获取上月完整自然月。按 Walmart 报告日期保存，不将 UTC 报告冒充本地时区的午夜库存。
- 手动通过同步状态选择历史月份；首次回填按整月拆分，默认上一完整月份；历史最大一次 120 个月是应用保护上限，并非已证实的 Walmart 历史保留期。
- 申请体必须含毫秒，例如 2026-10-01T00:00:00.000Z。报告异步生成，申请编号先落 Doke，重试复用原编号；每 10 分钟检查状态，最多等待约 1 小时。
- 原始 CSV 和状态响应存 raw_payloads；wfs_inventory_recon_runs 保存运行版本，wfs_inventory_recon_rows 保存 SKU × 仓库带符号变动。
- difference = Final Quantity - Starting Quantity - 所有带符号变动。差异行保留，不自动改平。不同运行版本不能直接相加；业务查询应选择每店铺每月份最新 completed 版本。
- 当前报告只包含 WFS，不包含自发货和头程在途，不代表单独可售库存。
- 迁移：packages/db/migrations/0065_inventory_reconciliation.sql。
- 持续计划沿用 sync_plans，店铺暂停/开启统一生效；定时错过的窗口不洪泛补跑，可手动补拉。
- 已知边界：Walmart ERROR/FAILED 的报告需人工排查并用新批次重试，原批次保留失败记录。数据库写入失败时事务回滚，下次继续下载同一 requestId。
