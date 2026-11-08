"""助理寫入權限：Python 路徑 fail closed／草稿模式。"""

from __future__ import annotations

import asyncio
import unittest
from typing import Any
from unittest.mock import MagicMock, patch

from tools.assistant_permissions import (
    default_permissions,
    is_write_tool_allowed,
    load_permissions_for_uid,
    normalize_permissions,
    permission_denied_message,
    resolve_permission_key,
)
from tools.registry import (
    AgentToolContext,
    _REGISTRY,
    execute_tool,
    register_tool,
)


class NormalizeTests(unittest.TestCase):
    def test_defaults_closed(self) -> None:
        perms = default_permissions()
        self.assertFalse(perms["createOrder"])
        self.assertFalse(perms["createPersonalTodoReminder"])
        self.assertFalse(perms["createDormRepairRequest"])

    def test_normalize_requires_strict_true(self) -> None:
        perms = normalize_permissions({"createOrder": True, "createDormRepairRequest": "yes"})
        self.assertTrue(perms["createOrder"])
        self.assertFalse(perms["createDormRepairRequest"])

    def test_aliases(self) -> None:
        self.assertEqual(resolve_permission_key("createFoodOrder"), "createOrder")
        self.assertEqual(resolve_permission_key("createReminder"), "createPersonalTodoReminder")
        open_order = normalize_permissions({"createOrder": True})
        self.assertTrue(is_write_tool_allowed(open_order, "createFoodOrder"))
        self.assertFalse(is_write_tool_allowed(default_permissions(), "createFoodOrder"))

    def test_denied_message(self) -> None:
        msg = permission_denied_message("createFoodOrder")
        self.assertIn("餐廳下單", msg)
        self.assertIn("settings?section=assistant", msg)

    def test_repair_denied_message_is_memo_not_ticket(self) -> None:
        msg = permission_denied_message("createDormRepairRequest")
        self.assertIn("存成宿舍報修備忘", msg)
        self.assertNotIn("送出宿舍報修", msg)


class LoadPermissionsTests(unittest.TestCase):
    def test_missing_uid_returns_none(self) -> None:
        self.assertIsNone(load_permissions_for_uid(None, lambda: None))
        self.assertIsNone(load_permissions_for_uid("", lambda: None))

    def test_missing_doc_returns_defaults(self) -> None:
        snap = MagicMock()
        snap.exists = False
        doc = MagicMock()
        doc.get.return_value = snap
        settings = MagicMock()
        settings.document.return_value = doc
        user = MagicMock()
        user.collection.return_value = settings
        users = MagicMock()
        users.document.return_value = user
        db = MagicMock()
        db.collection.return_value = users
        perms = load_permissions_for_uid("alice", lambda: db)
        assert perms is not None
        self.assertFalse(perms["createOrder"])

    def test_firestore_error_returns_none(self) -> None:
        def boom() -> Any:
            raise RuntimeError("no firestore")

        self.assertIsNone(load_permissions_for_uid("alice", boom))


class ExecuteToolGateTests(unittest.TestCase):
    def setUp(self) -> None:
        self._saved = dict(_REGISTRY)
        _REGISTRY.clear()
        self.calls: list[tuple[str, dict[str, Any]]] = []

        async def handler(ctx: AgentToolContext, args: dict[str, Any]) -> dict[str, Any]:
            self.calls.append((ctx.uid, args))
            return {"success": True, "repairId": "r1"}

        register_tool(
            name="createDormRepairRequest",
            description="test",
            parameters={"type": "object", "properties": {}},
            handler=handler,
            requires_confirmation=True,
        )

    def tearDown(self) -> None:
        _REGISTRY.clear()
        _REGISTRY.update(self._saved)

    def test_missing_uid_returns_draft_only(self) -> None:
        ctx = AgentToolContext(uid="", school_id="pu")
        out = asyncio.run(execute_tool("createDormRepairRequest", {"location": "A"}, ctx))
        self.assertTrue(out.get("draftOnly"))
        self.assertTrue(out.get("success"))
        self.assertEqual(self.calls, [])

    def test_permission_closed_blocks_handler(self) -> None:
        ctx = AgentToolContext(uid="alice", school_id="pu")
        with patch(
            "tools.assistant_permissions.load_permissions_for_uid",
            return_value=default_permissions(),
        ), patch("tools.actions._firestore_client", return_value=MagicMock()):
            out = asyncio.run(execute_tool("createDormRepairRequest", {"location": "A"}, ctx))
        self.assertFalse(out.get("success"))
        self.assertEqual(out.get("errorCode"), "assistant_write_permission_denied")
        self.assertIn("宿舍報修", out.get("errorMessage") or "")
        self.assertEqual(self.calls, [])

    def test_permission_open_runs_handler(self) -> None:
        ctx = AgentToolContext(uid="alice", school_id="pu")
        open_perms = default_permissions()
        open_perms["createDormRepairRequest"] = True
        with patch(
            "tools.assistant_permissions.load_permissions_for_uid",
            return_value=open_perms,
        ), patch("tools.actions._firestore_client", return_value=MagicMock()):
            out = asyncio.run(execute_tool("createDormRepairRequest", {"location": "A"}, ctx))
        self.assertTrue(out.get("success"))
        self.assertEqual(out.get("repairId"), "r1")
        self.assertEqual(len(self.calls), 1)

    def test_firestore_unavailable_returns_draft_only(self) -> None:
        ctx = AgentToolContext(uid="alice", school_id="pu")
        with patch(
            "tools.assistant_permissions.load_permissions_for_uid",
            return_value=None,
        ), patch("tools.actions._firestore_client", return_value=MagicMock()):
            out = asyncio.run(execute_tool("createDormRepairRequest", {"location": "A"}, ctx))
        self.assertTrue(out.get("draftOnly"))
        self.assertEqual(self.calls, [])


if __name__ == "__main__":
    unittest.main()
