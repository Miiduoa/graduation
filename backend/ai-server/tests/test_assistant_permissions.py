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


WRITE_TOOL_CASES = (
    ("createDormRepairRequest", "createDormRepairRequest"),
    ("createFoodOrder", "createOrder"),
    ("createReminder", "createPersonalTodoReminder"),
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

    def test_malformed_settings_and_truthy_values_stay_closed(self) -> None:
        for value in [None, [], "enabled", 1]:
            with self.subTest(value=value):
                self.assertEqual(normalize_permissions(value), default_permissions())
        for value in [1, "true", [], {}, None]:
            with self.subTest(value=value):
                self.assertFalse(normalize_permissions({"createOrder": value})["createOrder"])


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

    def test_invalid_identity_never_opens_firestore(self) -> None:
        factory = MagicMock()
        for uid in [None, "", 123, []]:
            with self.subTest(uid=uid):
                self.assertIsNone(load_permissions_for_uid(uid, factory))
        factory.assert_not_called()

    def test_reads_current_user_settings_each_time(self) -> None:
        db = MagicMock()
        user = db.collection.return_value.document.return_value
        settings = user.collection.return_value.document.return_value
        snapshot = settings.get.return_value
        snapshot.exists = True
        snapshot.to_dict.side_effect = [{"createOrder": True}, {"createOrder": False}]

        first = load_permissions_for_uid("alice", lambda: db)
        second = load_permissions_for_uid("alice", lambda: db)

        self.assertTrue(first["createOrder"])
        self.assertFalse(second["createOrder"])
        self.assertEqual(settings.get.call_count, 2)
        db.collection.assert_called_with("users")
        db.collection.return_value.document.assert_called_with("alice")
        user.collection.assert_called_with("settings")
        user.collection.return_value.document.assert_called_with("assistantPermissions")


class ExecuteToolGateTests(unittest.TestCase):
    def setUp(self) -> None:
        self._saved = dict(_REGISTRY)
        _REGISTRY.clear()
        self.calls: list[tuple[str, dict[str, Any]]] = []

        async def handler(ctx: AgentToolContext, args: dict[str, Any]) -> dict[str, Any]:
            self.calls.append((ctx.uid, args))
            return {"success": True, "repairId": "r1"}

        for name, _ in WRITE_TOOL_CASES:
            register_tool(
                name=name,
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

    def test_every_write_tool_requires_identity(self) -> None:
        with patch("tools.assistant_permissions.load_permissions_for_uid") as load:
            for name, _ in WRITE_TOOL_CASES:
                with self.subTest(tool=name):
                    output = asyncio.run(execute_tool(name, {}, AgentToolContext(uid="", school_id="pu")))
                    self.assertTrue(output.get("draftOnly"))
                    self.assertTrue(output.get("requiresUserConfirmation"))
        load.assert_not_called()
        self.assertEqual(self.calls, [])

    def test_other_tool_permissions_do_not_authorize_writes(self) -> None:
        for name, key in WRITE_TOOL_CASES:
            with self.subTest(tool=name):
                permissions = {key: True for key in default_permissions()}
                permissions[key] = False
                with patch("tools.assistant_permissions.load_permissions_for_uid", return_value=permissions):
                    output = asyncio.run(execute_tool(name, {}, AgentToolContext(uid="alice", school_id="pu")))
                self.assertEqual(output.get("errorCode"), "assistant_write_permission_denied")
        self.assertEqual(self.calls, [])

    def test_revocation_is_checked_before_each_tool_invocation(self) -> None:
        for name, key in WRITE_TOOL_CASES:
            with self.subTest(tool=name):
                self.calls.clear()
                permissions = {**default_permissions(), key: True}
                with patch(
                    "tools.assistant_permissions.load_permissions_for_uid",
                    side_effect=[permissions, default_permissions()],
                ) as load:
                    ctx = AgentToolContext(uid="alice", school_id="pu")
                    first = asyncio.run(execute_tool(name, {}, ctx))
                    second = asyncio.run(execute_tool(name, {}, ctx))
                self.assertTrue(first.get("success"))
                self.assertEqual(second.get("errorCode"), "assistant_write_permission_denied")
                self.assertEqual(self.calls, [("alice", {})])
                self.assertEqual(load.call_count, 2)
                self.assertTrue(all(call.args[0] == "alice" for call in load.call_args_list))

    def test_failed_permission_refresh_never_reuses_an_earlier_grant(self) -> None:
        for name, key in WRITE_TOOL_CASES:
            with self.subTest(tool=name):
                self.calls.clear()
                with patch(
                    "tools.assistant_permissions.load_permissions_for_uid",
                    side_effect=[{**default_permissions(), key: True}, None],
                ):
                    ctx = AgentToolContext(uid="alice", school_id="pu")
                    first = asyncio.run(execute_tool(name, {}, ctx))
                    second = asyncio.run(execute_tool(name, {}, ctx))
                self.assertTrue(first.get("success"))
                self.assertTrue(second.get("draftOnly"))
                self.assertEqual(self.calls, [("alice", {})])


class RegisteredWriteToolTests(unittest.TestCase):
    def test_default_write_tools_keep_their_permission_gate(self) -> None:
        from tools.actions import register_default_tools

        saved = dict(_REGISTRY)
        _REGISTRY.clear()
        try:
            register_default_tools()
            confirmation_tools = {
                name for name, tool in _REGISTRY.items() if tool.requires_confirmation
            }
            self.assertEqual(confirmation_tools, {name for name, _ in WRITE_TOOL_CASES})
            for name in confirmation_tools:
                self.assertIsNotNone(resolve_permission_key(name))
        finally:
            _REGISTRY.clear()
            _REGISTRY.update(saved)


if __name__ == "__main__":
    unittest.main()
