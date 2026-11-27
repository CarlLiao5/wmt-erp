"""Shared handling for Lingxing MCP action responses."""
import asyncio
import json
import re


class LingxingRateLimit(RuntimeError):
    pass


def _decode(result, tool_id):
    raw = "\n".join(c.text for c in result.content if getattr(c, "text", None)).strip()
    if raw.startswith("```") and "\n" in raw:
        raw = raw.split("\n", 1)[1].rsplit("```", 1)[0].strip()
    if re.match(r"call failed,\s*status:\s*429\b", raw, re.IGNORECASE):
        raise LingxingRateLimit(f"Lingxing MCP {tool_id}: HTTP 429，认证请求过于频繁")
    try:
        value = json.loads(raw)
    except json.JSONDecodeError as exc:
        status = re.match(r"call failed,\s*status:\s*(\d{3})\b", raw, re.IGNORECASE)
        reason = f"HTTP {status[1]}" if status else ("non-JSON response" if raw else "empty response")
        raise RuntimeError(f"Lingxing MCP {tool_id}: {reason}") from exc
    if not isinstance(value, dict):
        raise RuntimeError(f"Lingxing MCP {tool_id}: expected a JSON object")
    nested = value.get("data")
    for envelope in (value, nested if isinstance(nested, dict) else {}):
        if str(envelope.get("code")) == "102":
            raise RuntimeError(
                f"Lingxing MCP {tool_id}: MCP Key 无效或已失效（code=102）；"
                "请在领星 MCP 服务管理页重新生成 Key，并在 ERP 店铺管理的领星配置中更新保存"
            )
        if str(envelope.get("code")) == "429":
            raise LingxingRateLimit(f"Lingxing MCP {tool_id}: HTTP 429，认证请求过于频繁")
        if envelope.get("success") is False:
            raise RuntimeError(f"Lingxing MCP {tool_id}: request failed (code={envelope.get('code')})")
    if getattr(result, "isError", False):
        raise RuntimeError(f"Lingxing MCP {tool_id}: tool reported an error")
    return value


async def call_action(session, tool_id, params, *, sleep=asyncio.sleep):
    for delay in (0, 15, 30, 60):
        if delay:
            await sleep(delay)
        result = await session.call_tool("action", {"toolId": tool_id, "params": params})
        try:
            return _decode(result, tool_id)
        except LingxingRateLimit:
            if delay == 60:
                raise
