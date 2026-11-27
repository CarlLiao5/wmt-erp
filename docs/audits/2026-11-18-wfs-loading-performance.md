# WFS 货件加载优化

## 实测瓶颈

Doke / default 全店货件来源首轮耗时 29,104ms，其中库存日志查询 23,755ms，向 API 返回 115,423 行，再由 JS 汇总。返回货件 1,408 个，JSON 2,721,056 bytes。第二轮原实现首请求达 95,562ms，说明数据库/网络耗时存在显著波动，不能用单次测试保证 SLA。

## 修改

- 新增 shipmentReceiptTotals：数据库内先按店铺、归一化货件号、归一化 SKU 聚合 SUM(changed_units)，只统计 Received / Receiving Correction，负数修正仍参与，缺日志保持 unknown，不改成0。只返回388个汇总，减少约99.7%的日志传输行数。
- 新增覆盖索引 wfs_inventory_logs_receipt_cover_idx：tenant_id、shipment_id、store_id、sku、reason_description、changed_units。Doke 已用 ALGORITHM=INPLACE, LOCK=NONE 在线创建。
- 费用、商品和收发数据独立查询并行执行。
- 按原 tenant/store/date 范围隔离的货件缓存从5秒延长至30秒，保持同请求合并及错误后重试。页面数据可能最多延迟约30秒反映同步变化。成员过滤仍每次请求重新执行，没有缓存成员授权。
- 新部署加载查询代码前，需执行 packages/db/migrations/0056_wfs_receipt_covering_index.sql。与仓库后续独立SQL迁移一致，不自动运行其他未登记历史迁移。

## 验证

- 同一批1,408个货件：优化前后actualShippedUnits、actualReceivedUnits、fullyReceived和全部items深比较一致，差异0。
- 覆盖索引后来源首请求10,231ms；进一步并行后8,031ms（缓存命中0ms）。这是source测量，不是浏览器整页耗时。
- API重启后health 200。管理员实际HTTP首次38,043ms，重复29ms；后续冷请求12,846ms，重复31ms，均返回1,408条。保留慢首轮实测，不声称所有冷请求均8秒。仍有数据库/网络冷启动波动。
- WFS API、Web明细、标准化货件、SQL汇总及schema索引5文件32测试通过，API和DB类型检查通过，diff check通过。
- 未改货件同步和业务数据，未清理任何日志。只重启API，未重启Worker。

复查脚本：scripts/benchmark-wfs-loading.ts（可传WFS_BENCHMARK_OUTPUT保存数量和明细对照），scripts/verify-wfs-http-performance.mjs（使用本机环境登录、读取两次并退出，不输出凭据）。

## 后续：列表/详情拆分与运行进程核验

用户反馈仍慢后复查，发现原PID28870仍监听3000，先前screen重启并未替换监听进程。此前HTTP指标不能当作已运行优化版本的证据。已TERM精确旧PID并启动新API，确认PID44339监听。

新增view=summary供货件页面首次加载，只返回搜索/权限/收发数量需要的SKU字段，跳过费用、商品图片和物流轨迹；展开货件以storeId+shipmentId请求详情，保持成员过滤，详情失败可重试。默认旧接口仍保留完整数据契约，Dashboard异常查询不变。前端改相对/api URL。summary与详情缓存独立，30秒后可在120秒窗口内返回旧数据并后台刷新，超过窗口重新等待；成员权限仍逐请求执行。

实测source summary8122ms / 1153657 bytes、详情1193ms，授权SKU及数量一致。新进程实际HTTP summary5949ms、重复11ms。21相关测试、API/Web类型检查通过。冷查询仍受数据库网络波动，不保证恒定耗时。未完成浏览器端交互实测，仅源码和实际HTTP验证。
