# 标准化覆盖核验（2026-11-17）

数据库：Doke；租户：default。全程只读，未回填、删除或改写业务数据。

## 覆盖范围

订单：5 家店铺各最近 100 页原始响应。全历史核验因长查询及连接中断未完成，不能将样本结论外推到全部历史。
商品报告：当前保留的 36 份原始响应。

## 记录身份对账

| 表 | 样本期望身份数 | 未匹配 ID | 未匹配业务记录 |
|---|---:|---:|---:|
| order_shipping_details | 7535 | 0 | 0 |
| order_line_extensions | 8486 | 0 | 0 |
| order_line_charges | 8919 | 0 | 0 |
| order_line_status_history | 8605 | 0 | 0 |
| order_line_tracking | 7725 | 71 | 0 |
| order_line_serials | 140 | 0 | 0 |
| item_report_runs（完整 API 原始报告） | 2 | 0 | 0 |
| item_report_snapshots（完整 API 原始报告） | 562 | 0 | 0 |
| item_report_field_values（完整 API 原始报告） | 21356 | 0 | 0 |

71 个物流 ID 差异均按租户、店铺、订单号、行号、物流单号、承运商匹配到已有业务记录。应继续诊断 ID 不一致根因，不能将其当成 71 条漏写后直接回填。
首次核验期间的订单头及状态差异已在重查时消失，说明需要在存在并发同步时对未匹配 ID 做二次确认。

34 份旧商品报告原始响应没有 rows，不能仅靠它们重建历史行快照。5 家店铺均有 legacy-current 恢复记录；只有厦门多壳目前保留了 2 份带完整 rows 的 API 报告。legacy-current 不是历史快照。

## 后续

1. 诊断并统一物流 ID 生成规则，同时验证重复数据治理方案；不要直接删除或批量回填。
2. 用有检查点及单批超时的脚本完成全历史订单核验。
3. 验证其他店铺后续新商品报告是否落下完整 rows 和标准化快照。

复用命令：scripts/audit-normalization-coverage.ts --recent；商品报告单独核验使用 --reports-only。默认无参数的全历史模式会产生重查询，建议先按上述分批方案完善再运行。
