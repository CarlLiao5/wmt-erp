# 商品评论运行说明

入口：商品洞察 → 商品评论。管理员输入数字 Item ID 添加目标；无需预先存在 ERP 商品。租户内重复添加保留已有评论和进度，添加本身不调用 Firecrawl。成员只读通过现有店铺/SKU可见关系授权的商品。

每个 Item 独立提供首次抓取、继续历史、立即增量、暂停抓取、四天增量计划。新增默认关闭计划；暂停保存当前已完成页面，正在处理的页面完成后停止后续翻页。历史未完成时，增量按钮禁用，已启用的自动增量也等待历史完成。

首次默认每次2页，可设置1–100页预算，到预算暂停并保留下一页。每96小时增量只抓按最新发布排序的第一页，不保证覆盖四天内超过一页的新评论。页面读取、搜索和翻页仅查询Doke，不消耗Firecrawl额度。

Firecrawl key经服务端AES-GCM加密保存于product_review_configs；界面只展示已配置状态。不要修改现有CREDENTIAL_ENCRYPTION_KEY。不同租户共享的服务端抓取使用Doke advisory lock全局串行，batch内maxConcurrency=1。HTTP429尊重Retry-After，最多重试5次；明确拒绝或失败批次可以重新启动，提交结果未知则保留submitting并暂停，避免自动重复收费。

断点表product_review_pages保存Firecrawl batch ID。读取超时/重启后重新检查同一个batch，不重新提交。若显示“提交结果未知”，先在Firecrawl后台确认是否接受任务；由运维核实后修复该页batch_id/status，不能盲目清除记录重抓。

数据库表：product_review_targets（逐Item计划/状态）、product_reviews（租户+Item+review ID唯一）、product_review_runs（运行记录）、product_review_pages（页面与批次检查点）、product_review_configs（加密配置）。迁移0046已应用到Doke.synology.me/walmart；未使用Docker数据库。

真实验证（2026-11-16）：Item 1201369196，sort=submission-desc，抓取两页，每页10条，跨页1条重复，去重保存19条；服务端计费共2页。历史停在第3页，未启用自动计划。页面原始JSON包含topPositiveReview/topNegativeReview，解析仅取customerReviews，避免推荐评论混入。fixture为脱敏后的实际评论字段。

验证命令：

```sh
./node_modules/.bin/vitest run packages/db/src/product-reviews.test.ts apps/worker/src/reviews apps/worker/src/jobs/syncProductReviews.test.ts apps/worker/src/sync/product-reviews-scheduler.test.ts apps/api/src/routes/product-reviews.test.ts apps/web/src/pages/ProductReviewsPage.test.ts apps/worker/src/queue.test.ts
./node_modules/.bin/tsc --noEmit -p apps/api/tsconfig.json
./node_modules/.bin/tsc --noEmit -p apps/worker/tsconfig.json
./node_modules/.bin/tsc --noEmit -p apps/web/tsconfig.json
./node_modules/.bin/tsc --noEmit -p packages/db/tsconfig.json
```

全仓测试另有5项非本功能失败，分别位于weatherClient.test.ts（3项）、syncHeadFreight.test.ts（1项）、windowRunner.test.ts（1项）。不要将本功能定向测试通过等同全仓测试通过。
