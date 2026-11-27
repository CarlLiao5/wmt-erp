# 领星 SP 广告商品每日入库（ERP 内置脚本）

脚本已迁移到 ERP 仓库的 `ops/lingxing-etl`，由 Worker 的 `lingxing-advertising` 综合同步调用。
领星 MCP Key 和广告账户 ID 在 ERP「店铺管理 → 领星广告费用同步」中加密保存，Worker 运行时读取；不要把凭证文件或 Key 提交到仓库。

把领星 MCP 的 SP 广告**商品层级**每日数据写入 MySQL `walmart.ad_item_report`。
整个目录自包含：迁移到新机器时，拷贝本目录 + 重建 venv 即可，不依赖 `/etc/hermes/.env`。

## 目录

| 文件 | 说明 |
|---|---|
| `lingxing_sp_item_daily.py` | 主脚本 |
| `../../scripts/lingxing-head-freight-po-lookup.py` | 从头程合同号反查领星采购 PO 汇总 |
| `run.sh` | 独立手动运行入口（`exec` 主脚本，参数原样透传） |
| `database.env` | 数据库凭证（`DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME`） |
| `mcp.env` | 仅供独立手动运行的兼容入口；生产综合同步从 ERP 数据库读取配置 |
| `venv/` | 独立虚拟环境（pymysql + mcp + httpx2） |

两个 `.env` 权限必须是 `0600`。

## 独立手动运行的凭证加载顺序

1. `/etc/hermes/.env`（若存在，优先）
2. 本目录 `database.env`
3. 本目录 `mcp.env`

先到先得（`setdefault` 语义）。所以本机沿用 Hermes 的 managed env，迁到没有该文件的新机器时自动回落到本目录。
`database.env` 里的 `DB_*` 会自动映射成脚本用的 `LINGXING_DB_*`。

## 用法

```bash
./run.sh                      # 默认拉 T-1、T-2
./run.sh --days 5             # 最近 5 天（不含当天）
./run.sh --date 2026-10-20    # 指定某天（可重复）
./run.sh --start 2026-10-01 --end 2026-10-20
./run.sh --days 3 --purge-empty   # 入库前清掉表里的历史空行
./run.sh --keep-empty             # 保留零曝光零花费的空记录
```

**空行默认不入库**：曝光 / 点击 / 花费 / 订单 / 销售全为 0 的记录直接跳过（约占原始数据的 89%）。
“有曝光但 0 点击”的不算空，会保留用于诊断。

## 表结构

`ad_item_report`，唯一键 `(report_date, advertiser_id, ad_item_id)`，`INSERT ... ON DUPLICATE KEY UPDATE` 幂等，重复跑不产生重复行。

主要列：`report_date`、`item_id`、`ad_item_id`、`msku`、`local_name`、`campaign_id/name`、
`ad_group_id/name`、`targeting_type`(auto/manual)、`impressions`、`clicks`、`spend`、`orders`、
`units`、`sales`、`acos`、`roas`、`cvr`、`bid`、`suggested_bid`、`available_inventory`、`ingested_at`。

`msku` / `local_name` 通过 `platform_listing_walmart_list` 的 item_id 映射填充；未匹配属正常
（商品已下架或跨店 item），此时 `item_id` 与 `product_title` 仍然可用。

## 迁移步骤

```bash
# 旧机器
tar czf lingxing-etl.tar.gz -C /opt lingxing-etl

# 新机器
tar xzf lingxing-etl.tar.gz -C /opt
cd /opt/lingxing-etl
[ -d venv ] || python3 -m venv venv && ./venv/bin/pip install pymysql mcp
./run.sh --date 2026-10-20          # 冒烟测试
# 生产 ERP 不需要单独配置 cron；由综合同步计划每天北京时间 20:00 调用。
```

旧机器的 `venv/` 含绝对路径，**跨机器不要直接复用**，新机器重建（脚本本身无改动）。

## 验证口径

入库花费合计必须等于同窗口报表合计：

```sql
SELECT report_date, COUNT(*), ROUND(SUM(spend),2) FROM ad_item_report GROUP BY report_date ORDER BY report_date;
```

2026-10-01~20 基线：2,060 行，花费 $23,510.57，销售 $80,769.22。

## 日志

- `/var/log/lingxing_sp_item_daily.log` —— 脚本自身
- `/var/log/lingxing_sp_item_daily.cron.log` —— cron 侧 stdout/stderr

## 覆盖的广告账号（9 家）

| 店铺 | advertiser_id | SP 投放情况（2026-10 观察） |
|---|---|---|
| 厦门多壳沃尔玛 | 251287 | 主力，日均 ~$1,000 |
| 兴隆德沃尔玛 | 355899 | 日均 ~$160 |
| 鑫启典沃尔玛 | 423930 | 日均 ~$120 |
| 禹铮沃尔玛 | 254305 | 日均 ~$17，仅 2–3 个广告商品在跑 |
| 亿辰沃尔玛 | 357159 | 日均 ~$12，仅 1 个广告商品在跑 |
| 领锋沃尔玛 | 329627 | SP 组 56 个商品全零活动，SB 也为 0 |
| 和谱 | 354371 | SP 组 79 个商品全零活动 |
| 精析沃尔玛 | 358004 | SP 组 41 个商品全零活动 |
| 美纵沃尔玛 | 433455 | SP 组 17 个商品全零活动 |

后四家在窗口内没有任何广告活动数据（SP 有广告商品但零曝光零花费，SB 查询为 0），不是拉取失败。

**范围限制：本脚本只采 SP（sponsoredProducts-manual + auto）。SB / SV 用 `campaignType: sba` / `video` 单独采，未纳入。**

## 头程货件 SKU 采购成本反查

读取 ERP `head_freight_rows.wfs_shipment_number` 与合同编号，再调用领星只读工具 `platform_query_shipping_list`，按 Walmart 平台、货件号（`searchField=7`）及有效已发货状态（`shippingListStatus=2`）查询。发货单的 `goodExtDetails` 提供 MSKU、SKU、发货数量和 `cgPriceDisplay` 采购单价。合同号里的多个 PO 会全部保留在对应货件行中，不强行将货件成本分摊给其中某个 PO。

```bash
MYSQL_URL='mysql://user:password@host:3306/walmart_erp' \
  ./ops/lingxing-etl/venv/bin/python scripts/lingxing-head-freight-po-lookup.py \
  --tenant default --output-dir artifacts/lingxing-shipment-costs

# 只查一个 PO
MYSQL_URL='mysql://user:password@host:3306/walmart_erp' \
  ./ops/lingxing-etl/venv/bin/python scripts/lingxing-head-freight-po-lookup.py \
  --tenant default --po PO260626003 --output-dir artifacts/lingxing-shipment-costs
```

脚本只读 ERP 与领星，并生成 `shipment_sku_purchase_costs.csv`（领星已发货单的原始 SKU 成本行）与 `po_purchase_cost_summary.csv`（按合同 PO 列示、货件号、MSKU/SKU 汇总的数量、成本和加权均价）。采购成本为 `shipped_quantity × cgPriceDisplay`。同一货件行包含多个 PO 时会把 PO 全部列出；此时不伪造单 PO 成本分摊。领星工具只读查询，不修改发货单。
