# 企微智能文档头程综合同步验收

## 当前实现

- 同步资源：`head-freight`
- 入口：Sync Status 的单个“同步头程在途”按钮
- 数据路径：API → BullMQ/Redis → Worker → `raw_payloads` + `head_freight_rows`
- 店铺匹配：按租户内名称尝试匹配；失败时保留 `source_store_name`，`store_id` 为空，记录仍写入
- 任务结果：`sync_jobs.result_payload` 保存 `written`、`skipped`、`unmatchedStoreNames`
- Bot 配置：`wecom_bot_configs`，Bot Key 只保存加密值

## 本地验证

- `@walmart-erp/db`：6 tests passed
- `@walmart-erp/api`：54 tests passed
- `@walmart-erp/worker`：37 tests passed
- DB/API/Worker/Web TypeScript typecheck passed
- `git diff --check` passed
- MySQL 迁移 `0019_wecom_head_freight.sql` 已应用到本地 `walmart_erp`
- API `http://127.0.0.1:3000/api/health` 返回 `status: ok`
- Web `http://127.0.0.1:5173/` 返回 HTTP 200
- API、Worker、Web 已重启

## 生产接入前

需要通过 `PUT /api/wecom/head-freight/config` 写入新的 Bot Key、智能文档 URL 和子表 ID。旧脚本中的 Bot Key 不复用；未配置时同步任务会明确失败，不会写入敏感值到日志。
