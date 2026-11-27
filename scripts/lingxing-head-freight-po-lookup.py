#!/usr/bin/env python3
"""Read Lingxing shipped freight details and SKU purchase cost for head freight rows."""

import argparse
import asyncio
import base64
import csv
import hashlib
from datetime import datetime, timezone
import json
import os
import re
import sys
from pathlib import Path
from urllib.parse import unquote, urlparse

import httpx2
import pymysql
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "ops" / "lingxing-etl"))
from lingxing_mcp import LingxingRateLimit, call_action

MCP_URL = "https://openmcp.lingxing.com/mcp-servers/lingxing-mcp"
FREIGHT_TOOL = "platform_query_shipping_list"
WALMART_PLATFORM_CODE = "10008"


def load_runtime_env() -> None:
    env_file = Path(__file__).resolve().parents[1] / ".env.runtime"
    if not env_file.exists():
        return
    for line in env_file.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            name, value = line.split("=", 1)
            os.environ.setdefault(name.strip(), value.strip())


def encryption_key() -> bytes:
    value = os.environ.get("CREDENTIAL_ENCRYPTION_KEY", "")
    key = bytes.fromhex(value) if re.fullmatch(r"[a-fA-F0-9]{64}", value) else value.encode()
    if len(key) != 32:
        raise RuntimeError("CREDENTIAL_ENCRYPTION_KEY must be 32 bytes or 64 hexadecimal characters")
    return key


def decode_part(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * ((4 - len(value) % 4) % 4))


def decrypt_credential(value: str, key: bytes) -> str:
    try:
        iv, tag, encrypted = value.split(".")
        return AESGCM(key).decrypt(decode_part(iv), decode_part(encrypted) + decode_part(tag), None).decode()
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError("Could not decrypt lingxing_configs.encrypted_mcp_key") from exc


def db_connection(mysql_url: str):
    parsed = urlparse(mysql_url)
    if parsed.scheme not in ("mysql", "mysql+pymysql") or not parsed.hostname or not parsed.path:
        raise ValueError("MYSQL_URL must be a mysql:// URL with database name")
    return pymysql.connect(
        host=parsed.hostname,
        port=parsed.port or 3306,
        user=unquote(parsed.username or ""),
        password=unquote(parsed.password or ""),
        database=unquote(parsed.path.lstrip("/")),
        charset="utf8mb4",
        cursorclass=pymysql.cursors.DictCursor,
        connect_timeout=15,
        read_timeout=60,
    )


def split_contract_numbers(value: str | None) -> list[str]:
    if not value:
        return []
    result, seen = [], set()
    for part in re.split(r"[\r\n,，;；、|/]+", value):
        po = part.strip()
        if po and po.casefold() not in seen:
            seen.add(po.casefold())
            result.append(po)
    return result


def cell_text(value) -> str:
    if value is None:
        return ""
    if isinstance(value, list):
        return "\n".join(text for part in value if (text := cell_text(part)))
    if isinstance(value, dict):
        return cell_text(value.get("text") or value.get("userName") or value.get("value"))
    return str(value).strip()


def read_source_rows(mysql_url: str, tenant_id: str) -> tuple[str, list[dict]]:
    connection = db_connection(mysql_url)
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT encrypted_mcp_key FROM lingxing_configs WHERE tenant_id=%s LIMIT 1", (tenant_id,))
            config = cursor.fetchone()
            if not config:
                raise RuntimeError(f"No Lingxing MCP configuration for tenant {tenant_id!r}")
            mcp_key = decrypt_credential(config["encrypted_mcp_key"], encryption_key())
            cursor.execute(
                "SELECT source_row_id, store_id, source_store_name, contract_number, purchase_batch_number, sku, product_name, quantity, "
                "wfs_shipment_number, payload FROM head_freight_rows WHERE tenant_id=%s AND contract_number IS NOT NULL "
                "AND TRIM(contract_number)<>'' ORDER BY contract_number, wfs_shipment_number, source_row_id",
                (tenant_id,),
            )
            rows = list(cursor.fetchall())
        return mcp_key, rows
    finally:
        connection.close()


def unpack_freight_report(response: dict) -> dict:
    payload = response.get("data") or {}
    report = payload.get("data") or {}
    if isinstance(report, dict) and "data" in report and isinstance(report["data"], dict):
        report = report["data"]
    return report if isinstance(report, dict) else {}


async def fetch_shipment_details(session: ClientSession, shipment_number: str) -> list[dict]:
    rows: list[dict] = []
    offset = 0
    while True:
        payload = await call_action(session, FREIGHT_TOOL, {
            "platformCodes": [WALMART_PLATFORM_CODE],
            "searchField": 7,
            "searchSingleValue": shipment_number,
            "shippingListStatus": 2,
            "isDelete": 0,
            "offset": offset,
            "length": 200,
        })
        report = unpack_freight_report(payload)
        page = report.get("list") or []
        rows.extend(row for row in page if str(row.get("shippingListStatus", "")) == "2")
        total = int(report.get("total") or 0)
        if not page or len(rows) >= total:
            break
        offset += len(page)
    return rows


def amount(value) -> float | None:
    if value in (None, "", "-"):
        return None
    try:
        numeric = re.sub(r"[^\d.\-]", "", str(value).replace(",", ""))
        return float(numeric) if numeric else None
    except (TypeError, ValueError):
        return None


def write_details_to_database(mysql_url: str, tenant_id: str, batch_id: str, details: list[dict]) -> int:
    if not batch_id:
        raise RuntimeError("--batch-id is required when --write-to-db is enabled")
    connection = db_connection(mysql_url)
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    try:
        with connection.cursor() as cursor:
            for row in details:
                idempotency_key = hashlib.sha256(
                    "|".join(str(row.get(key) or "").strip().casefold() for key in (
                        "shipment_number", "shipping_list_code", "store_name", "msku", "sku"
                    )).encode("utf-8")
                ).hexdigest()
                cursor.execute(
                    "INSERT INTO lingxing_shipment_sku_costs "
                    "(id, tenant_id, shipment_number, shipping_list_code, shipping_status, source_row_ids, "
                    "contract_numbers, po_numbers, purchase_batch_numbers, source_store_names, lingxing_store_name, "
                    "msku, sku, product_name, shipped_quantity, purchase_unit_cost, line_purchase_cost, currency, "
                    "raw_payload, batch_id, idempotency_key, first_seen_at, synced_at, created_at, updated_at) "
                    "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) "
                    "ON DUPLICATE KEY UPDATE source_row_ids=VALUES(source_row_ids), contract_numbers=VALUES(contract_numbers), "
                    "po_numbers=VALUES(po_numbers), purchase_batch_numbers=VALUES(purchase_batch_numbers), "
                    "source_store_names=VALUES(source_store_names), lingxing_store_name=VALUES(lingxing_store_name), "
                    "product_name=VALUES(product_name), shipped_quantity=VALUES(shipped_quantity), "
                    "purchase_unit_cost=VALUES(purchase_unit_cost), line_purchase_cost=VALUES(line_purchase_cost), "
                    "currency=VALUES(currency), raw_payload=VALUES(raw_payload), batch_id=VALUES(batch_id), "
                    "synced_at=VALUES(synced_at), updated_at=VALUES(updated_at)",
                    (
                        idempotency_key, tenant_id, row["shipment_number"], row["shipping_list_code"], row["shipping_status"],
                        json.dumps(row["source_row_ids"], ensure_ascii=False), json.dumps(row["_contract_numbers"], ensure_ascii=False),
                        json.dumps(row["po_numbers"], ensure_ascii=False), json.dumps(row["_purchase_batch_numbers"], ensure_ascii=False),
                        json.dumps(row["source_store_names"], ensure_ascii=False), row["store_name"] or None,
                        row["msku"] or None, row["sku"] or None, row["product_name"] or None,
                        amount(row["shipped_quantity"]), amount(row["purchase_unit_cost"]), amount(row["line_purchase_cost"]),
                        row["currency"] or None, json.dumps(row["raw_payload"], ensure_ascii=False, default=str), batch_id,
                        idempotency_key, now, now, now, now,
                    ),
                )
        connection.commit()
        return len(details)
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


async def run(args) -> int:
    mysql_url = args.mysql_url or os.environ.get("MYSQL_URL")
    if not mysql_url:
        raise RuntimeError("Set MYSQL_URL before running this script")
    mcp_key, freight_rows = read_source_rows(mysql_url, args.tenant)
    for row in freight_rows:
        # Recover contracts from raw rows written before normalized multi-PO preservation.
        payload = row.get("payload")
        values = payload.get("values") if isinstance(payload, dict) else None
        if isinstance(values, dict):
            raw_contract = cell_text(values.get("合同编号"))
            if raw_contract:
                row["contract_number"] = raw_contract
    shipment_sources: dict[str, list[dict]] = {}
    for row in freight_rows:
        shipment_number = str(row.get("wfs_shipment_number") or "").strip()
        if shipment_number:
            shipment_sources.setdefault(shipment_number, []).append(row)
    if args.po:
        selected = {po.casefold() for po in args.po}
        shipment_sources = {
            shipment: rows for shipment, rows in shipment_sources.items()
            if any(po.casefold() in selected for row in rows for po in split_contract_numbers(row.get("contract_number")))
        }
    if not shipment_sources:
        print("No WFS shipment numbers found for the selected tenant/filter.")
        return 0

    output_dir = Path(args.output_dir)
    details_path = output_dir / "shipment_sku_purchase_costs.csv"
    summary_path = output_dir / "po_purchase_cost_summary.csv"
    detail_columns = [
        "shipment_number", "shipping_list_code", "shipping_status", "po_numbers_from_contract",
        "contract_numbers", "purchase_batch_numbers", "store_name", "msku", "sku", "product_name",
        "shipped_quantity", "purchase_unit_cost", "line_purchase_cost", "currency",
    ]
    summary_columns = [
        "po_number", "shipment_number", "msku", "sku", "product_name", "shipped_quantity",
        "purchase_cost", "weighted_average_unit_cost", "shipping_list_codes", "note",
    ]
    details = []
    errors = 0
    attempted = 0
    blocked = None

    async with httpx2.AsyncClient(headers={"X-Mcp-Key": mcp_key}, timeout=240) as client:
        async with streamable_http_client(MCP_URL, http_client=client) as streams:
            async with ClientSession(streams[0], streams[1]) as session:
                await session.initialize()
                for index, (shipment, source_rows) in enumerate(shipment_sources.items(), start=1):
                    if index > 1:
                        await asyncio.sleep(1)
                    attempted = index
                    try:
                        freight_orders = await fetch_shipment_details(session, shipment)
                        matched_orders = [order for order in freight_orders if str(order.get("shippingListStatus")) == "2"]
                        for order in matched_orders:
                            contracts_in_order = sorted({
                                po for row in source_rows for po in split_contract_numbers(row.get("contract_number"))
                            })
                            contract_values = sorted({str(row.get("contract_number") or "").strip() for row in source_rows if row.get("contract_number")})
                            batch_numbers = sorted({str(row.get("purchase_batch_number") or "").strip() for row in source_rows if row.get("purchase_batch_number")})
                            source_store_names = sorted({str(row.get("source_store_name") or "").strip() for row in source_rows if row.get("source_store_name")})
                            source_row_ids = sorted({str(row.get("source_row_id") or "").strip() for row in source_rows if row.get("source_row_id")})
                            good_details = [
                                item for item in (order.get("goodExtDetails") or [])
                                if str(item.get("cargoCode") or "").strip().casefold() == shipment.casefold()
                            ]
                            for item in good_details:
                                qty = amount(item.get("shipmentsNum"))
                                cost = amount(item.get("cgPriceDisplay"))
                                details.append({
                                    "shipment_number": shipment,
                                    "shipping_list_code": order.get("shippingListCode", ""),
                                    "shipping_status": "2",
                                    "po_numbers_from_contract": ", ".join(contracts_in_order),
                                    "contract_numbers": " | ".join(contract_values),
                                    "purchase_batch_numbers": ", ".join(batch_numbers),
                                    "store_name": item.get("storeName", ""),
                                    "msku": item.get("msku", ""),
                                    "sku": item.get("sku", ""),
                                    "product_name": item.get("productName", ""),
                                    "shipped_quantity": qty if qty is not None else item.get("shipmentsNum", ""),
                                    "purchase_unit_cost": cost if cost is not None else item.get("cgPriceDisplay", ""),
                                    "line_purchase_cost": round(qty * cost, 4) if qty is not None and cost is not None else "",
                                    "currency": item.get("cgPriceCurrency", "CNY"),
                                    "source_row_ids": source_row_ids,
                                    "_contract_numbers": contract_values,
                                    "po_numbers": contracts_in_order,
                                    "_purchase_batch_numbers": batch_numbers,
                                    "source_store_names": source_store_names,
                                    "raw_payload": {"shippingList": order, "skuDetail": item},
                                })
                        print(f"[{index}/{len(shipment_sources)}] {shipment}: {len(matched_orders)} shipped orders", flush=True)
                    except LingxingRateLimit as exc:
                        errors += 1
                        blocked = str(exc)
                        break
                    except Exception as exc:  # noqa: BLE001
                        errors += 1
                        print(f"[{index}/{len(shipment_sources)}] {shipment}: ERROR {str(exc)[:300]}", flush=True)

    # A cargo may be attached to multiple freight rows/contract PO numbers. Its
    # cost is therefore summarized under the cargo number and PO mapping is
    # retained as a list; no cost is arbitrarily allocated across those POs.
    grouped: dict[tuple[str, str, str, str, str], dict] = {}
    for row in details:
        key = (row["po_numbers_from_contract"], row["shipment_number"], row["msku"], row["sku"], row["product_name"])
        group = grouped.setdefault(key, {**row, "shipped_quantity": 0.0, "purchase_cost": 0.0, "unit_cost_weight": 0.0, "shipping_list_codes": set()})
        qty, unit_cost = amount(row["shipped_quantity"]), amount(row["purchase_unit_cost"])
        if qty is not None: group["shipped_quantity"] += qty
        if qty is not None and unit_cost is not None:
            group["purchase_cost"] += qty * unit_cost
            group["unit_cost_weight"] += qty
        if row["shipping_list_code"]: group["shipping_list_codes"].add(str(row["shipping_list_code"]))
    if blocked:
        print(f"ERROR {blocked}；已停止扫描，剩余 {len(shipment_sources) - attempted} 个货件未查询", flush=True)
    if args.write_to_db:
        written = write_details_to_database(mysql_url, args.tenant, args.batch_id, details)
        print(f"DONE shipments={attempted} shipped_sku_rows={written} errors={errors}")
        return 0 if errors == 0 else 1

    output_dir.mkdir(parents=True, exist_ok=True)
    with details_path.open("w", newline="", encoding="utf-8-sig") as file:
        writer = csv.DictWriter(file, fieldnames=detail_columns, extrasaction="ignore")
        writer.writeheader(); writer.writerows(details)
    summaries = []
    for group in grouped.values():
        qty = group["shipped_quantity"]
        summaries.append({
            "po_number": group["po_numbers_from_contract"],
            "shipment_number": group["shipment_number"], "msku": group["msku"], "sku": group["sku"],
            "product_name": group["product_name"], "shipped_quantity": round(qty, 4),
            "purchase_cost": round(group["purchase_cost"], 4),
            "weighted_average_unit_cost": round(group["purchase_cost"] / group["unit_cost_weight"], 6) if group["unit_cost_weight"] else "",
            "shipping_list_codes": ", ".join(sorted(group["shipping_list_codes"])),
            "note": "采购价来自该货件号下 shippingListStatus=2 的已发货单；货件对应多个 PO 时按逗号列示，未强行分摊到单一 PO。",
        })
    with summary_path.open("w", newline="", encoding="utf-8-sig") as file:
        writer = csv.DictWriter(file, fieldnames=summary_columns)
        writer.writeheader(); writer.writerows(summaries)
    print(f"DONE shipments={attempted} shipped_sku_rows={len(details)} errors={errors}")
    print(f"Shipment SKU costs: {details_path}")
    print(f"PO/cargo SKU cost summary: {summary_path}")
    return 0 if errors == 0 else 1


def main() -> int:
    load_runtime_env()
    parser = argparse.ArgumentParser(description="Lookup Lingxing shipped SKU purchase costs by head-freight shipment number")
    parser.add_argument("--tenant", default="default", help="ERP tenant ID")
    parser.add_argument("--mysql-url", help="MySQL connection URL (defaults to MYSQL_URL)")
    parser.add_argument("--po", action="append", help="Only query this PO; may be repeated")
    parser.add_argument("--output-dir", default="artifacts/lingxing-shipment-costs")
    parser.add_argument("--batch-id", help="ERP sync batch ID used for database idempotency/auditing")
    parser.add_argument("--write-to-db", action="store_true", help="Upsert normalized shipment SKU costs into ERP")
    args = parser.parse_args()
    try:
        return asyncio.run(run(args))
    except Exception as exc:  # noqa: BLE001
        print(f"FAILED: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
