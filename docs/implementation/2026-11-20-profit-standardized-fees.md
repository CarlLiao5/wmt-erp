# 利润标准化费用与广告缺失核对

利润与成本表的尾程、佣金均改读 recon_transactions，不再在请求时解析 payment_reports.payload。账单原始内容继续保留用于追溯及字段回填。

迁移0067增加 purchase_order_line、ship_qty、bill_transaction_key 和 tenant/SKU 查询索引。同步 normalizeReconTransactions 与 syncStorageFees 同时持久化这些字段，首次和持续同步共用此路径。历史字段可运行 scripts/backfill-recon-profit-fields.ts --apply 从已归档报告回填，脚本强制 Doke，同时补齐历史SKU、订单关联及金额类型，保留账单金额和交易主键；先暂存全部字段，再按主键一次更新。

费用优先级不变：订单行实际账单、手填、全部历史 SKU 加权均值。标准化查询保留账单交易标识用于重叠报表去重。

广告按店铺/SKU匹配，失败时尝试唯一Item ID；SKU和Item ID关联冲突、Item ID多义、无销量或无法匹配的非零花费进入广告缺失清单。广告原始花费=已分摊+未分摊，SEM另列折后差额。没有广告记录本身不推定缺失。未分摊广告不强行扣给其他产品，明确显示尚未扣入毛利。

页面新增广告分摊核对及差额SKU列表。完整利润Excel新增广告分摊核对sheet，两个缺失导出均包含广告来源、原始差额、折后差额。无销售月份仍保留广告差额。

利润快照版本 normalized-payment-ad-reconciliation-v3，旧版本不再提供导出，安排重算。更新运行服务后刷新已有月份。

验证：标准化适配器、历史费用优先级、广告匹配/冲突/无销量、两种Excel缺失导出、Worker账单同步及回填回归测试；API、Worker、Web类型检查。

## 无销量广告直接扣减（用户修订）

匹配产品使用租户标准化skus目录和订单产品关联。匹配成功但无当月销量的站内广告/SEM直接计入该产品及月度费用，SEM使用保存减免比例；不生成虚构订单。广告报告按日保留花费，直接扣减同时进入每日产品利润。汇总新增directAdvertisingDeduction用于核对月度毛利与订单合计差异；产品利润和Excel包含零销量负利润产品。已计入广告金额包括销量分摊与直接扣减，缺失仅保留无法匹配及关联冲突。快照版本升级normalized-payment-direct-zero-sales-v4。
