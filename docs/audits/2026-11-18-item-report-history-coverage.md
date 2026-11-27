# 商品报告历史快照覆盖核验（2026-11-18）

## 范围与数据来源

直接连接 Doke 数据库；覆盖全部 5 家有生产凭据的店铺。未配置生产凭据的测试店铺 001 不在本次范围。新报告调用现有生产持久化处理器，首次和持续同步共用此处理器。本次未修改生产同步逻辑，无需重启。

旧报告通过原始 requestId 下载 Walmart 留存的真实 CSV；不使用当前商品资料重建历史。保留原始 raw 记录，另附完整原始行与恢复来源；快照保留原始 received_at，provenance 为 api-recovered。恢复流程不更新当前 skus 元数据。

## 跨店新报告验证

| 店铺 | 新报告 requestId | 原始行/快照 | 字段值 |
|---|---|---:|---:|
| 禹铮沃尔玛 | 01a1ea97-92a9-74fe-8630-aab8f18acdbb | 203 / 203 | 7714 |
| 兴隆德沃尔玛 | 01a1ea97-97ae-7566-abcc-ede924dd3439 | 52 / 52 | 1976 |
| 亿辰沃尔玛 | 01a1ea97-a192-7173-9f84-43ddb142e96b | 31 / 31 | 1178 |
| 鑫启典沃尔玛 | 01a1ea97-9c29-7b3e-8ee7-3492bffb056c | 90 / 90 | 3420 |
| 厦门多壳沃尔玛 | 01a1ea97-8c6d-76f0-ae9d-9afbd9b814ab | 281 / 281 | 10678 |

## 历史报告恢复

34 / 34 份恢复成功，下载失败 0 份；每份 CSV 行数均与旧归档 rowCount 一致。

| 店铺 ID | 恢复报告 | 历史快照 | 字段值 |
|---|---:|---:|---:|
| 10001133528 | 7 | 1606 | 61028 |
| 10001156838 | 6 | 1013 | 38494 |
| 10001578336 | 6 | 261 | 9918 |
| 10002512034 | 8 | 631 | 23978 |
| prod-001 | 7 | 187 | 7106 |

## 可复查脚本

- scripts/verify-item-report-coverage-live.ts：生成新报告，验证原始行、快照 ID 和所有字段值；可用 ITEM_REPORT_RESUME_LOG 续查已提交请求。
- scripts/recover-item-report-history.ts：按原 requestId 恢复缺失历史行，幂等跳过已恢复报告。
- scripts/audit-item-report-snapshots.ts：只读逐字段审计，包括报告与快照的采集时间。

运行环境：先加载 .env.runtime，再加载 .env.db-connection，使用项目 vite-node 执行。遵守现有客户端每店请求节流，不绕过限速。

## 验证

同步处理器、客户端解析、标准化相关测试共 9 项通过。最终数据库审计结果见下方。

最终只读审计退出码 0：41 份完整报告、4,917 条快照、186,846 个字段值逐项一致；报告与快照 captured_at 均与原始归档 received_at 一致；34 份元数据旧报告均已对应 api-recovered 记录，未解决 0 份。legacy-current 快照不作为真实历史报告计入本结果。

```json
{
  "complete": true,
  "rawCompleteReports": 41,
  "distinctVerifiedRuns": 41,
  "snapshots": 4917,
  "fields": 186846,
  "oldMetadataOnly": 34,
  "oldRecovered": 34,
  "oldUnresolved": 0,
  "stores": {
    "10001133528": {
      "reports": 10,
      "snapshots": 2449,
      "fields": 93062
    },
    "10001156838": {
      "reports": 7,
      "snapshots": 1216,
      "fields": 46208
    },
    "10001578336": {
      "reports": 7,
      "snapshots": 313,
      "fields": 11894
    },
    "10002512034": {
      "reports": 9,
      "snapshots": 721,
      "fields": 27398
    },
    "prod-001": {
      "reports": 8,
      "snapshots": 218,
      "fields": 8284
    }
  }
}
```
