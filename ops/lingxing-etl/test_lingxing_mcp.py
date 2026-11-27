import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock

from lingxing_mcp import LingxingRateLimit, call_action


def response(text, error=False):
    return SimpleNamespace(content=[SimpleNamespace(text=text)], isError=error)


THROTTLED = response(
    'call failed, status: 429, response: {"code":429,"msg":"认证请求过于频繁，请稍后重试"}', True
)


class LingxingMcpTests(unittest.IsolatedAsyncioTestCase):
    async def test_expired_key_reports_actionable_error_without_retry_or_secrets(self):
        for payload in (
            '{"code":102,"success":false,"msg":"secret-key"}',
            '{"data":{"code":"102","success":false,"msg":"secret-key"}}',
        ):
            session = SimpleNamespace(call_tool=AsyncMock(return_value=response(payload)))
            with self.assertRaisesRegex(RuntimeError, "MCP Key 无效或已失效.*店铺管理") as error:
                await call_action(session, "report", {}, sleep=AsyncMock())
            self.assertNotIn("secret-key", str(error.exception))
            session.call_tool.assert_awaited_once()

    async def test_retries_the_same_request_then_returns_data(self):
        session = SimpleNamespace(call_tool=AsyncMock(side_effect=[
            THROTTLED, response('```json\n{"data":{"list":[1]}}\n```'),
        ]))
        pause = AsyncMock()
        self.assertEqual(await call_action(session, "report", {"page": 2}, sleep=pause), {"data": {"list": [1]}})
        self.assertEqual(session.call_tool.await_count, 2)
        self.assertEqual(*session.call_tool.await_args_list)
        pause.assert_awaited_once()

    async def test_persistent_throttling_stops_after_bounded_retries(self):
        session = SimpleNamespace(call_tool=AsyncMock(return_value=THROTTLED))
        with self.assertRaisesRegex(LingxingRateLimit, "429"):
            await call_action(session, "report", {}, sleep=AsyncMock())
        self.assertEqual(session.call_tool.await_count, 4)

    async def test_other_errors_do_not_return_empty_data_or_retry(self):
        for result in (response("invalid gateway", True), response('{"data":{"success":false}}')):
            session = SimpleNamespace(call_tool=AsyncMock(return_value=result))
            with self.assertRaises(RuntimeError):
                await call_action(session, "report", {}, sleep=AsyncMock())
            session.call_tool.assert_awaited_once()
