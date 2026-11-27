# ERP 服务器部署

2026-11-21 部署至用户提供的服务器。ERP 独立于 WBKC，不安装 MySQL、Redis，沿用远端 Doke MySQL 和原 Redis；保留原有 CREDENTIAL_ENCRYPTION_KEY。

- 公网入口：`http://47.99.138.107/ERP/`
- 原 WBKC：`http://47.99.138.107/WBKC/`
- ERP API：仅本机 `127.0.0.1:3100`。公网部署在 `/ERP/` 子路径时，Nginx 必须同时把 `/ERP/api/` 代理到 `http://127.0.0.1:3100/api/`；前端从 `import.meta.env.BASE_URL` 解析 API 子路径。本机/Vite 根路径开发仍使用 `/api/`。
- 发布目录：`/opt/wmterp/releases/20261121`；`/opt/wmterp/current` 为当前发布软链。
- 原始源码备份：发布目录的 `source.tar.gz`。运行版本为本地构建的 API/Worker bundle 和前端静态文件。
- 独立 Node 22：`/opt/wmterp/runtime/node-v22.15.0-linux-x64`。
- 独立 Python 3.11：`/opt/wmterp/python311`，供领星脚本调用；不改变系统 Python。
- 秘密配置：`/etc/wmterp/runtime.env`，root/wmterp 组可读，禁止提交版本库或输出到日志。
- 服务：`wmterp-api.service`、`wmterp-worker.service`，独立非登录用户 `wmterp`。
- Nginx：新增 `/etc/nginx/snippets/wmterp.conf`，原 wbkc 站点仅追加 include，原文件备份 `/opt/wmterp/nginx-wbkc.before-erp.conf`。
- 低内存配置：`MALLOC_ARENA_MAX=2`；普通同步并发 2、每个报告队列并发 1；API 和 Worker 分别设置独立内存硬上限，无内存软限制，避免密码哈希校验期间反复内存回收。

## 运维命令

```sh
systemctl status wmterp-api wmterp-worker
journalctl -u wmterp-api -n 100 --no-pager
journalctl -u wmterp-worker -n 100 --no-pager
systemctl restart wmterp-api
systemctl restart wmterp-worker
curl -f http://127.0.0.1:3100/api/health
```

不要使用全局进程终止命令、停止 nginx 或重启 WBKC。修改 Nginx 后先 `nginx -t`，再 `systemctl reload nginx`。停止服务器 Worker 后才可恢复本地 Worker，避免重复调度。

## 构建与回滚

`ops/deploy/build-runtime.cjs` 本地构建 API 和 Worker；前端使用 Vite build。服务器运行时依赖独立安装，不复用 macOS 的 node_modules 或 Python venv。

应用回滚时先停 ERP Worker，恢复上一版本 current 软链，然后重启 ERP 两个服务。撤销网页入口时仅移除新增的 include 并检查/重载 Nginx，不能覆盖部署后其他服务新加的配置。无需变更远端数据库。

## 本次验证

已通过公网用户名/邮箱登录、成员新增/修改/重复校验/租户隔离；服务器成员、店铺、同步状态、评论目标接口均返回 200；2026-09 库存对账 Excel 导出返回 200、178093 字节。原 WBKC 三个服务 PID 与部署前一致，/WBKC/ 返回 200。远端 MySQL/Redis 连通且原凭证解密通过。本地 Worker 已停止，服务器 Worker 已接管并写入心跳；服务器 API/Worker 均已开机自启。

当前入口使用 HTTP；如需 HTTPS，应配置域名和证书。

2026-11-27 修复子路径 API 路由：前端按 Vite `BASE_URL` 将 `/api/*` 请求转换到 `/ERP/api/*`；Nginx ERP 专属 snippet 增加 `/ERP/api/` 到本机 API 的代理。不要改根路径 `/api/` 代理，以免影响同机其他服务。

2026-11-21 晚间因库存占用普通队列导致订单等待，将 SYNC_WORKER_CONCURRENCY 从 1 调至 2，在线调整现有 Worker，无进程重启。已核验厦门多壳 20:30 订单批次转为 active；报告/领星/评论并发不变。

2026-11-21 因库存任务阻塞订单队列，将服务器 SYNC_WORKER_CONCURRENCY 调为 2。为不打断正在运行订单，当前进程通过一个额外普通队列消费者实现总并发 2（原消费者 1 + 新消费者 1），无额外调度器；下次服务重启自动回到单消费者并发 2。

## 2026-11-28 发版记录：分支 `feat/ui-module-refresh`

发布目录 `/opt/wmterp/releases/20261128`。包含价格促销服务端取最新与分页筛选、库存库龄双卡片、货件汇总卡与轨迹修复、广告 KPI 条、绩效达标判定等前端改动，以及 `/api/pricing` 的 SQL 改动。

### 本地构建

```sh
node ops/deploy/build-runtime.cjs
```

```sh
cd apps/web && npx vite build --base=/ERP/
```

`build-runtime.cjs` 产出 `api.mjs`、`worker.mjs`、`server.mjs`、`package.json`。前端必须带 `--base=/ERP/`，否则资源路径会指向根目录。

### 服务器发版

```sh
NEW=/opt/wmterp/releases/$(date +%Y%m%d)
cp -a /opt/wmterp/current/. $NEW/ && rm -rf $NEW/web
tar xzf /tmp/wmterp-release.tar.gz -C $NEW
cd $NEW && /opt/wmterp/runtime/node-v22.15.0-linux-x64/bin/npm install --omit=dev
chown -R wmterp:wmterp $NEW
ln -sfn $NEW /opt/wmterp/current
systemctl restart wmterp-api wmterp-worker
```

先复制旧版本再覆盖，是为了保留 `ops/`、`scripts/`、`lingxing-*.py` 等辅助文件；`rm -rf $NEW/web` 清掉旧哈希资源再解包。切换前可先 `node --check` 两个 bundle，并确认 `node_modules` 里关键依赖存在。

### Worker 停机慢

`wmterp-worker` 收到 SIGTERM 后不会主动退出，每次都等满 `TimeoutStopUSec=5min` 才被 systemd 强杀。部署时表现为 `systemctl restart` 长时间不返回、`is-active` 显示 `deactivating`。这是老进程行为，不代表新版本有问题——新 Worker 确实会在超时后正常启动。

需要立即完成发版时：

```sh
systemctl kill -s SIGKILL wmterp-worker; systemctl stop wmterp-worker
```

代价是中断正在执行的队列任务。根治办法是把 `wmterp-worker.service` 的 `TimeoutStopSec` 调小到 30 秒。

### 回滚

```sh
systemctl stop wmterp-worker
ln -sfn /opt/wmterp/releases/<上一版> /opt/wmterp/current
systemctl restart wmterp-api wmterp-worker
```

### 验证

```sh
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3100/api/health
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1/ERP/
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1/ERP/api/health
```

三项都应返回 200。重启后 API 需要几秒才就绪，过早请求会得到 `000`。

### 注意

- 本次发布的分支 `feat/ui-module-refresh` 当时尚未合并（PR #1），生产运行的是未合并代码
- 服务器凭据放在本机 `/Users/carl/Documents/wmterp/SSH.ENV`，不入库

