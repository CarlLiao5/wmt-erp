# 原始响应分层归档

## 当前能力

所有资源支持按租户、店铺、资源的单批 gzip 归档，默认每批 10 条，最多 100 条；每批独立文件。普通资源至少保留 90 天；名称包含 return、recon、payment、item-report 的资源至少保留 365 天。原始数据和业务表均不在归档阶段删除。保留期是代码默认策略，尚未启用自动定时任务。

归档文件携带版本、数量及 canonical JSON 的 SHA-256，写临时文件后原子改名，读取解压校验，再逐条比较。文件权限 0600、新建目录 0700；归档含业务/客户信息，应放在具备访问控制与磁盘加密的归档位置。gzip 不是加密。生产环境应把目录映射到独立存储/NAS，或先上传至独立对象存储并确认备份；当前没有 S3 上传实现，不能把本机样本当作异地备份。

清理目前只支持 item-report：逐条锁定原始记录，确认内容未变化、年龄满足要求，核对报告行数、快照全列、所有字段值和采集时间后，事务内删除并记 audit_events。其他资源尚无完整逐字段核验器，强制仅归档。无 rows 的旧元数据报告不会删除，即使另有恢复记录。缺记录、字段不一致、校验未支持均拒绝清理。不会删除业务表或标准化历史快照。

旧 retention-cli 的 --execute 已停用，避免绕过归档直接按日期删除；旧预览仍可用。新工具没有定时调度、批量自动清理或自动恢复写回数据库，verify 为离线读取恢复校验，不是向业务库回灌。

## 使用

从仓库根目录执行，加载 .env.runtime 后再加载 .env.db-connection（Doke）。工具使用 vite-node；以下以 `$VITE_NODE` 指代项目 node_modules/.pnpm/vite-node@2.1.9_@types+node@22.13.4/node_modules/vite-node/vite-node.mjs。

```sh
node --env-file=.env.runtime --env-file=.env.db-connection "$VITE_NODE" packages/db/src/raw-archive-cli.ts --mode=preview --tenant=default --store=prod-001 --resource=orders
node --env-file=.env.runtime --env-file=.env.db-connection "$VITE_NODE" packages/db/src/raw-archive-cli.ts --mode=archive --tenant=default --store=prod-001 --resource=orders --directory=/absolute/archive/path
node "$VITE_NODE" packages/db/src/raw-archive-cli.ts --mode=verify --archive=/absolute/archive/path/batch.json.gz
```

每批输出 nextCheckpoint，下一次传 `--after-time=<afterTime> --after-id=<afterId>`。固定资源和保留期，按 received_at + id 递增，不使用 OFFSET。不传检查点会重新归档最早一批（不会去重删除）。当前每次仅执行一批，避免长事务；文件不能超过 256MiB 解压上限，超限时改小 batch-size。

正式清理必须已将归档可靠保存，并携带实际备份编号、操作人：

```sh
node --env-file=.env.runtime --env-file=.env.db-connection "$VITE_NODE" packages/db/src/raw-archive-cli.ts --mode=purge --tenant=default --store=prod-001 --resource=item-report --archive=/absolute/archive/path/batch.json.gz --operator=<name> --backup-id=<verified-backup-id>
```

backup-id 是人工提供的备份凭据，不自动验证远端存储；正式自动清理前仍需接入指定持久归档目标及备份验证。不对生产表执行 OPTIMIZE；删除数据也不保证立即归还表空间给操作系统。

## 2026-11-18 验证

- db TypeScript 检查通过；归档及保留策略 8 项测试通过。
- Doke default / prod-001 / item-report 的 1 份真实报告已做 gzip 归档、读取还原及标准化全字段匹配，删除 0 条。
- 样本在仓库 `.local/raw-archives/`，已被 .gitignore 排除；没有启动定时任务，没有执行生产清理。
