#!/usr/bin/env python3
"""领星 MCP -> MySQL：SP 广告商品（ad item）每日数据入库。

用法:
    lingxing_sp_item_daily.py                 # 默认拉 T-1、T-2 两天
    lingxing_sp_item_daily.py --days 5        # 拉最近 5 天（不含当天）
    lingxing_sp_item_daily.py --date 2026-10-20
    lingxing_sp_item_daily.py --from 2026-10-01 --to 2026-10-20

幂等：唯一键 (report_date, ad_item_id)，重复运行只更新不新增。
凭证：MCP Key 和广告账户由 ERP Worker 通过命令行传入；数据库连接仍使用 ERP 运行时数据库配置。
"""

import argparse
import asyncio
import datetime as dt
import json
import os
import sys
import traceback
from urllib.parse import unquote, urlparse

import httpx2
import pymysql
from lingxing_mcp import call_action as mcp_call
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client


def _load_env() -> None:
    """读取凭证：/etc/hermes/.env 优先，其次本目录的 database.env / mcp.env。

    用 setdefault 语义（先到先得），所以迁移到新机器、没有 /etc/hermes/.env 时，
    只靠本目录两个 env 文件即可独立运行。
    """
    here = os.path.dirname(os.path.abspath(__file__))
    paths = [os.path.join(here, "database.env"), os.path.join(here, "mcp.env")]
    if os.environ.get("ETL_ENV_ONLY") != "1":  # 迁移自测用：跳过全局 env
        paths.insert(0, "/etc/hermes/.env")
    for path in paths:
        if not os.path.exists(path):
            continue
        with open(path, encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, val = line.partition("=")
                os.environ.setdefault(key.strip(), val.strip())
    # database.env 用的是 DB_* 简写，脚本内部用 LINGXING_DB_*
    for short, full in (
        ("DB_HOST", "LINGXING_DB_HOST"), ("DB_PORT", "LINGXING_DB_PORT"),
        ("DB_USER", "LINGXING_DB_USER"), ("DB_PASSWORD", "LINGXING_DB_PASSWORD"),
        ("DB_NAME", "LINGXING_DB_NAME"),
    ):
        if not os.environ.get(full) and os.environ.get(short):
            os.environ[full] = os.environ[short]
    if not os.environ.get("LINGXING_DB_HOST") and os.environ.get("MYSQL_URL"):
        parsed = urlparse(os.environ["MYSQL_URL"])
        os.environ.setdefault("LINGXING_DB_HOST", parsed.hostname or "127.0.0.1")
        os.environ.setdefault("LINGXING_DB_PORT", str(parsed.port or 3306))
        os.environ.setdefault("LINGXING_DB_USER", unquote(parsed.username or ""))
        os.environ.setdefault("LINGXING_DB_PASSWORD", unquote(parsed.password or ""))
        os.environ.setdefault("LINGXING_DB_NAME", (parsed.path or "").lstrip("/"))


_load_env()

parser = argparse.ArgumentParser()
parser.add_argument("--days", type=int, default=2)
parser.add_argument("--date")
parser.add_argument("--from", dest="date_from")
parser.add_argument("--to", dest="date_to")
parser.add_argument("--purge-empty", action="store_true")
parser.add_argument("--keep-empty", action="store_true")
parser.add_argument("--mcp-key")
parser.add_argument("--advertiser-ids")
args, _unknown = parser.parse_known_args()

MCP_URL = "https://openmcp.lingxing.com/mcp-servers/lingxing-mcp"
MCP_KEY = args.mcp_key or os.environ.get("LINGXING_MCP_KEY", "")
if not MCP_KEY:
    raise SystemExit("MCP key is required")
ADVERTISER_IDS = [int(x) for x in (args.advertiser_ids or os.environ.get(
    "LINGXING_ADVERTISER_IDS", os.environ.get("LINGXING_ADVERTISER_ID", "251287")
)).replace(" ", "").split(",") if x]
LOG_PATH = os.environ.get("LINGXING_LOG_PATH", "/var/log/lingxing_sp_item_daily.log")
TABLE = "ad_item_report"

DDL = f"""
CREATE TABLE IF NOT EXISTS `{TABLE}` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `report_date` DATE NOT NULL,
  `store_name` VARCHAR(100) DEFAULT NULL,
  `advertiser_id` VARCHAR(32) DEFAULT NULL,
  `item_id` VARCHAR(64) NOT NULL,
  `ad_item_id` VARCHAR(64) NOT NULL,
  `msku` VARCHAR(120) DEFAULT NULL,
  `local_name` VARCHAR(255) DEFAULT NULL,
  `campaign_id` VARCHAR(64) DEFAULT NULL,
  `campaign_name` VARCHAR(255) DEFAULT NULL,
  `ad_group_id` VARCHAR(64) DEFAULT NULL,
  `ad_group_name` VARCHAR(255) DEFAULT NULL,
  `targeting_type` VARCHAR(16) DEFAULT NULL COMMENT 'auto/manual',
  `campaign_targeting` VARCHAR(64) DEFAULT NULL,
  `ad_status` VARCHAR(32) DEFAULT NULL,
  `review_status` VARCHAR(32) DEFAULT NULL,
  `impressions` INT DEFAULT NULL,
  `clicks` INT DEFAULT NULL,
  `ctr` DECIMAL(12,4) DEFAULT NULL,
  `cpc` DECIMAL(12,4) DEFAULT NULL,
  `spend` DECIMAL(14,2) DEFAULT NULL,
  `orders` INT DEFAULT NULL,
  `units` INT DEFAULT NULL,
  `sales` DECIMAL(14,2) DEFAULT NULL,
  `ad_sku_sales` DECIMAL(14,2) DEFAULT NULL,
  `other_sku_sales` DECIMAL(14,2) DEFAULT NULL,
  `acos` DECIMAL(12,4) DEFAULT NULL,
  `roas` DECIMAL(12,4) DEFAULT NULL,
  `cvr` DECIMAL(12,4) DEFAULT NULL,
  `bid` DECIMAL(12,4) DEFAULT NULL,
  `suggested_bid` DECIMAL(12,4) DEFAULT NULL,
  `available_inventory` INT DEFAULT NULL,
  `ntb_orders` INT DEFAULT NULL,
  `ntb_sales` DECIMAL(14,2) DEFAULT NULL,
  `product_title` VARCHAR(500) DEFAULT NULL,
  `ingested_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_date_adv_aditem` (`report_date`, `advertiser_id`, `ad_item_id`),
  KEY `idx_date_item` (`report_date`, `item_id`),
  KEY `idx_msku_date` (`msku`, `report_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='SP 广告商品每日数据（领星 MCP -> MySQL）'
"""

COLS = [
    "report_date", "store_name", "advertiser_id", "item_id", "ad_item_id", "msku",
    "local_name", "campaign_id", "campaign_name", "ad_group_id", "ad_group_name",
    "targeting_type", "campaign_targeting", "ad_status", "review_status",
    "impressions", "clicks", "ctr", "cpc", "spend", "orders", "units", "sales",
    "ad_sku_sales", "other_sku_sales", "acos", "roas", "cvr", "bid", "suggested_bid",
    "available_inventory", "ntb_orders", "ntb_sales", "product_title",
]

SQL = (
    f"INSERT INTO `{TABLE}` ({', '.join('`%s`' % c for c in COLS)}) "
    f"VALUES ({', '.join(['%s'] * len(COLS))}) "
    "ON DUPLICATE KEY UPDATE "
    + ", ".join("`%s`=VALUES(`%s`)" % (c, c) for c in COLS if c not in ("report_date", "ad_item_id"))
)


def log(msg: str) -> None:
    line = f"{dt.datetime.now():%Y-%m-%d %H:%M:%S} {msg}"
    print(line, flush=True)
    try:
        with open(LOG_PATH, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except OSError:
        pass


def log_exception(exc: BaseException) -> None:
    """Keep ExceptionGroup children in the worker-visible ETL output."""
    rendered = ''.join(traceback.format_exception(exc)).strip()
    log(f"FAILED: {rendered}")


def num(v, cast=float):
    if v in (None, "", "-"):
        return None
    try:
        return cast(float(v))
    except (TypeError, ValueError):
        return None


def txt(v, limit=None):
    if v is None:
        return None
    s = str(v)
    return s[:limit] if limit else s


def db_connect():
    return pymysql.connect(
        host=os.environ["LINGXING_DB_HOST"],
        port=int(os.environ["LINGXING_DB_PORT"]),
        user=os.environ["LINGXING_DB_USER"],
        password=os.environ["LINGXING_DB_PASSWORD"],
        database=os.environ["LINGXING_DB_NAME"],
        charset="utf8mb4",
        autocommit=False,
        connect_timeout=15,
    )


async def fetch_report(session, day: str, advertiser_id: int) -> list[dict]:
    out, page = [], 1
    while True:
        payload = await mcp_call(session, "get_walmart_sp_ad_item_report", {
            "advertiserIds": [advertiser_id],
            "campaignType": ["sponsoredProducts-manual", "sponsoredProducts-auto"],
            "day": 14,
            "startDate": day,
            "endDate": day,
            "pageNum": page,
            "pageSize": 200,
            "paging": True,
        })
        data = (payload.get("data") or {})
        data = data.get("data") or data
        rows = data.get("list") or []
        if not rows:
            break
        out.extend(rows)
        if len(rows) < 200:
            break
        page += 1
    return [r for r in out if r.get("adItemId")]


async def fetch_sku_map(session) -> dict:
    mapping, offset = {}, 0
    while True:
        payload = await mcp_call(session, "platform_listing_walmart_list",
                                 {"offset": offset, "length": 200})
        data = (payload.get("data") or {})
        data = data.get("data") or data
        rows = data.get("list") or []
        for r in rows:
            mapping[str(r.get("item_id"))] = (r.get("msku"), r.get("local_name"), r.get("store_name"))
        total = data.get("count") or 0
        if not rows or offset + len(rows) >= total:
            break
        offset += len(rows)
    return mapping


def is_empty(r: dict) -> bool:
    """无曝光、无点击、无花费、无订单、无销售 —— 视为空记录，默认不入库。"""
    return (
        not num(r.get("numAdsShown"), int)
        and not num(r.get("numAdsClicks"), int)
        and not num(r.get("adSpend"), float)
        and not num(r.get("attributedOrders"), int)
        and not num(r.get("attributedSales"), float)
    )


def to_row(day: str, r: dict, sku_map: dict, advertiser_id: int) -> tuple:
    item_id = str(r.get("itemId") or "")
    msku, local_name, store = sku_map.get(item_id, (None, None, None))
    ct = r.get("campaignAndTargetingType") or ""
    return (
        day,
        txt(r.get("mpSellerName"), 100) or txt(store, 100),
        str(advertiser_id),
        item_id,
        str(r.get("adItemId")),
        txt(msku, 120),
        txt(local_name, 255),
        txt(r.get("campaignId"), 64),
        txt(r.get("campaignName"), 255),
        txt(r.get("adGroupId"), 64),
        txt(r.get("adGroupName"), 255),
        "auto" if "auto" in ct else "manual",
        txt(ct, 64),
        txt(r.get("adStatus"), 32),
        txt(r.get("reviewStatus"), 32),
        num(r.get("numAdsShown"), int),
        num(r.get("numAdsClicks"), int),
        num(r.get("ctr")),
        num(r.get("cpc")),
        num(r.get("adSpend")),
        num(r.get("attributedOrders"), int),
        num(r.get("attributedUnits"), int),
        num(r.get("attributedSales")),
        num(r.get("advertisedSkuSales")),
        num(r.get("otherSkuSales")),
        num(r.get("acos")),
        num(r.get("roas")),
        num(r.get("cvr")),
        num(r.get("bid")),
        num(r.get("suggestedBid")),
        num(r.get("availableInventory"), int),
        num(r.get("ntbOrders"), int),
        num(r.get("ntbRevenue")),
        txt(r.get("adName"), 500),
    )


async def run(days: list[str], keep_empty: bool = False, purge_empty: bool = False) -> int:
    conn = db_connect()
    try:
        with conn.cursor() as cur:
            cur.execute(DDL)
        conn.commit()
        log(f"table `{TABLE}` ready")

        if purge_empty:
            with conn.cursor() as cur:
                cur.execute(
                    f"DELETE FROM `{TABLE}` WHERE IFNULL(impressions,0)=0 AND IFNULL(clicks,0)=0 "
                    f"AND IFNULL(spend,0)=0 AND IFNULL(orders,0)=0 AND IFNULL(sales,0)=0"
                )
                deleted = cur.rowcount
            conn.commit()
            log(f"purge: deleted {deleted} empty rows")

        async with httpx2.AsyncClient(headers={"X-Mcp-Key": MCP_KEY}, timeout=240) as client:
            async with streamable_http_client(MCP_URL, http_client=client) as streams:
                async with ClientSession(streams[0], streams[1]) as session:
                    await session.initialize()
                    # Lingxing may revise action parameter schemas without
                    # changing the endpoint. Refresh the advertised tools so
                    # the server accepts the next action call.
                    await session.list_tools()
                    await session.call_tool("help", {"query": "get_walmart_sp_ad_item_report", "limit": 50, "offset": 0})
                    await session.call_tool("search", {"toolId": "get_walmart_sp_ad_item_report"})
                    sku_map = await fetch_sku_map(session)
                    log(f"sku map: {len(sku_map)} listings")

                    total = 0
                    for day in days:
                        for adv in ADVERTISER_IDS:
                            rows = await fetch_report(session, day, adv)
                            if not rows:
                                log(f"{day} adv={adv}: 0 rows (数据可能未同步)")
                                continue
                            if not keep_empty:
                                before = len(rows)
                                rows = [r for r in rows if not is_empty(r)]
                                skipped = before - len(rows)
                            else:
                                skipped = 0
                            if not rows:
                                log(f"{day} adv={adv}: 全部为空（{skipped} 条跳过），不入库")
                                continue
                            payload = [to_row(day, r, sku_map, adv) for r in rows]
                            with conn.cursor() as cur:
                                cur.executemany(SQL, payload)
                            conn.commit()
                            spend = sum(float(r.get("adSpend") or 0) for r in rows)
                            seller = next((r.get("mpSellerName") for r in rows if r.get("mpSellerName")), str(adv))
                            log(f"{day} adv={adv} {seller}: {len(payload)} rows "
                                f"(skip {skipped} empty), spend={spend:.2f}")
                            total += len(payload)
                    log(f"DONE total={total} advertisers={len(ADVERTISER_IDS)}")
                    return 0
    finally:
        conn.close()


def resolve_days(args) -> list[str]:
    if args.date:
        return [dt.date.fromisoformat(d).isoformat() for d in args.date]
    if args.start and args.end:
        d0, d1 = dt.date.fromisoformat(args.start), dt.date.fromisoformat(args.end)
        out, d = [], d0
        while d <= d1:
            out.append(d.isoformat())
            d += dt.timedelta(days=1)
        return out
    base = dt.date.fromisoformat(args.base) if args.base else dt.date.today()
    return [(base - dt.timedelta(days=i)).isoformat() for i in range(1, args.days + 1)]


def main() -> int:
    global MCP_KEY, ADVERTISER_IDS
    p = argparse.ArgumentParser(description="领星 SP 广告商品每日数据入库")
    p.add_argument("--date", action="append", help="指定日期，可重复，格式 YYYY-MM-DD")
    p.add_argument("--start", help="起始日期（配合 --end）")
    p.add_argument("--end", help="结束日期（配合 --start）")
    p.add_argument("--days", type=int, default=2, help="拉最近 N 天，不含当天，默认 2")
    p.add_argument("--base", help="以该日期为基准往前推，默认今天")
    p.add_argument("--keep-empty", action="store_true", help="保留零曝光零花费的空记录（默认不入库）")
    p.add_argument("--purge-empty", action="store_true", help="入库前先删除表里已有的空记录")
    p.add_argument("--mcp-key", help="由 ERP Worker 传入的 MCP Key")
    p.add_argument("--advertiser-ids", help="由 ERP Worker 传入的广告账户 ID，逗号分隔")
    args = p.parse_args()

    if args.mcp_key:
        MCP_KEY = args.mcp_key
    if args.advertiser_ids:
        ADVERTISER_IDS = [int(x) for x in args.advertiser_ids.replace(" ", "").split(",") if x]

    days = sorted(resolve_days(args))
    log(f"run start: days={days} keep_empty={args.keep_empty} purge_empty={args.purge_empty}")
    try:
        return asyncio.run(run(days, keep_empty=args.keep_empty, purge_empty=args.purge_empty))
    except BaseException as exc:  # noqa: BLE001
        log_exception(exc)
        return 1


if __name__ == "__main__":
    sys.exit(main())
