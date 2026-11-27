#!/bin/bash
# 领星 SP 广告商品每日增量入库
# 由 cron 调用；凭证从 managed env (/etc/hermes/.env) 读取
# 领星 SP 广告商品每日增量入库（cron 入口）
# 凭证由 Python 脚本自己加载：/etc/hermes/.env 优先，本目录 database.env / mcp.env 兜底
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PYTHON_BIN="${LINGXING_PYTHON:-$SCRIPT_DIR/venv/bin/python}"
exec "$PYTHON_BIN" "$SCRIPT_DIR/lingxing_sp_item_daily.py" "$@"
