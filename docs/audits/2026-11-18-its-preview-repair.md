# ITS 预估 Work 对照修复

用户提供 Python 脚本后，对比本地 worker，并在 Doke 已有标准化货件上小样本测试，只调用只读 inbound-preview。

## 已证实原因

3935141WFB / XMDK-Leak-001 旧请求 expectedDeliveryDate=2026-11-08T08:33:47.473Z，API HTTP400，code=400.WFS.100，field=orderItems[0].expectedDeliveryDate，description=Expected Delivery Date should be of future and not the past。

同一货件按 UTC 当日+7天生成预估日期后 HTTP200，LAX2T/4093 inbound 预估 USD28（80件）。4480592WFB / XMDK-CP001 为 USD175（500件）。

对4480592WFB另外测试指定shipNode/不指定shipNode、原returnAddress/脚本shipToAddress，均HTTP200、USD175。因此没有证据将shipNode或原退货地址认定为根因，保留当前业务地址及目的仓限制。不能把脚本将目的仓地址代作returnAddress的做法盲目复制。

## 修改

- normalizePreviewCandidate：缺失、无效、当天或历史预计到货日期，预估请求替换为UTC当日+7天；有效未来日期保留。
- 预估请求数量按vendorPackQty*innerPackQty生成，与脚本一致；不修改原始/标准化货件数量。
- 修复字符串receivedAt的时间解析。
- 使用WfsShipmentRepository.list/items标准字段，不再遍历历史raw_payloads；items增加receivedAt用于正确选取最新SKU版本。
- 返回仓库名兼容shipToAddress.fcName。
- 保留仅当前目的中转仓的方案，不加总其他路线。
- inbound-preview共享凭证限速10秒；429/5xx最多3次请求，尊重通用客户端Retry-After；其他400不重试，错误保存字段及描述。
- Work超时20秒改120秒，策略hash升级，旧失败可以重试。
- 同步函数可选shipmentIds，用于小样本验证。

## 验证及部署状态

scripts/run-its-preview-sample.ts 调用真实syncWfsFeePreviewToDatabase，仅两个货件：scanned2 eligible2 previewed2 failed0。Doke wfs_fee_preview_runs/options/items查询确认均succeeded，金额28/175、SKU数量80/500。紧接重跑unchanged2、previewed0，不重复请求。

24项相关测试通过；Worker/Client/DB类型检查及diffcheck通过。

常驻worker PID29651在核对时仍有订单、报表和天气同步任务运行，未强行重启。新的单独验证进程已验证修复并保存上述两票费用；常驻worker仍需在安全重启后加载代码。未重启/批量恢复之前搁置的ITS调度计划，未批量请求804个LAX2T货件。

预估是当前重算，不是实际扣费，也不是历史报价；脚本本身的全量分页、DB店铺过滤等问题不在本次修复范围。
