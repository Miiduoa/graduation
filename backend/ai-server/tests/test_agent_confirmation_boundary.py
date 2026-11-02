"""Agent dispatch boundaries with synthetic plans and handlers only."""

from __future__ import annotations

import asyncio
import dataclasses
import importlib
import os
import sys
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

_CLOUD_ENV = {
    "ENABLE_RAG": "false",
    "ENABLE_WEB_SEARCH": "false",
    "ENABLE_SELF_TRAIN_LOOP": "false",
    "ENABLE_REFLEXION": "false",
    "LLM_PROVIDER": "groq",
    "OPENAI_COMPAT_API_KEY": "",
    "GROQ_API_KEY": "",
    "TOGETHER_API_KEY": "",
    "FIREBASE_CRED_PATH": "",
}


class AgentConfirmationBoundaryTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self.enterContext(mock.patch.dict(os.environ, _CLOUD_ENV))
        self.enterContext(mock.patch("dotenv.load_dotenv", return_value=False))
        # Other cloud-boundary suites reload application modules; resolve the
        # current modules per test instead of retaining stale registry objects.
        self.registry = importlib.import_module("tools.registry")
        self.planner = importlib.import_module("tool_planner")
        self.llm = importlib.import_module("llm_client")
        self.actions = importlib.import_module("tools.actions")
        self.queries = importlib.import_module("tools.queries")
        self.enterContext(mock.patch.dict(self.registry._REGISTRY, {}, clear=True))
        self.enterContext(mock.patch("httpx.AsyncClient.request", side_effect=AssertionError("Unexpected provider request")))
        self.enterContext(mock.patch("httpx.Client.request", side_effect=AssertionError("Unexpected provider request")))
        self.firestore = self.enterContext(mock.patch.object(self.actions, "_firestore_client", side_effect=AssertionError("Unexpected Firestore request")))
        self.query_firestore = self.enterContext(mock.patch.object(self.queries, "_firestore_client", side_effect=AssertionError("Unexpected Firestore request")))
        self.ctx = self.registry.AgentToolContext(uid="fixture-alice", school_id="fixture-campus")

    def register(self, name="readFixture", *, requires_confirmation=False, handler=None):
        handler = handler if handler is not None else mock.Mock(return_value={"success": True, "value": "fixture"})
        self.registry.register_tool(
            name=name,
            description="Synthetic test tool",
            parameters={"type": "object", "properties": {}},
            handler=handler,
            requires_confirmation=requires_confirmation,
        )
        return handler

    def call(self, name, arguments=None, call_id="fixture-call"):
        return self.llm.ToolCall(id=call_id, name=name, arguments=arguments or {})

    def plan(self, *calls, content="UNTRUSTED 已提交，編號 FICTION-123"):
        return self.llm.ChatPlan(
            content=content,
            tool_calls=list(calls),
            raw_finish_reason="tool_calls" if calls else "stop",
            provider="fixture-provider",
            model="fixture-model",
        )

    async def turn(self, plan, *, ctx=None, user_message="fixture request"):
        with mock.patch.object(self.llm, "chat_with_tools", new=mock.AsyncMock(return_value=plan)):
            return await self.planner.run_agent_turn(
                user_message=user_message,
                history=[],
                user_context=None,
                ctx=ctx or self.ctx,
            )

    def assert_rejected_turn(self, turn, code="tool_not_allowed"):
        self.assertEqual(len(turn.toolCalls), 1)
        trace = turn.toolCalls[0]
        self.assertIs(trace.success, False)
        self.assertEqual(trace.errorCode, code)
        self.assertEqual(trace.args, {})
        self.assertEqual([card.kind for card in turn.cards], ["tool_failed"])
        self.assertNotIn("UNTRUSTED", turn.content)
        self.assertNotIn("FICTION-123", turn.content)
        self.assertNotIn("已提交", turn.content)
        self.assertNotIn("未接受的敏感草稿", str(turn.to_dict()))

    def test_schema_only_exposes_explicitly_unconfirmed_tools(self):
        self.register("readFixture")
        for name, flag in [("writeFixture", True), ("noneFlag", None), ("zeroFlag", 0), ("emptyFlag", "")]:
            self.register(name, requires_confirmation=flag)
        names = [row["function"]["name"] for row in self.registry.list_openai_tools()]
        self.assertEqual(names, ["readFixture"])

    async def test_omitted_confirmation_flag_fails_closed(self):
        handler = mock.Mock(return_value={"success": True})
        self.registry.register_tool(name="futureTool", description="fixture", parameters={}, handler=handler)
        self.assertIs(self.registry.get_tool("futureTool").requires_confirmation, True)
        self.assertEqual(self.registry.list_openai_tools(), [])
        output = await self.registry.execute_tool("futureTool", {}, self.ctx)
        self.assertEqual(output.get("errorCode"), "confirmation_required")
        handler.assert_not_called()

    def test_tool_definition_defaults_to_confirmation(self):
        definition = self.registry.ToolDefinition(name="futureTool", description="fixture", parameters={}, handler=mock.Mock())
        self.assertIs(definition.requires_confirmation, True)

    async def test_marked_write_is_rejected_before_handler(self):
        handler = self.register("writeFixture", requires_confirmation=True)
        output = await self.registry.execute_tool("writeFixture", {"value": "fixture"}, self.ctx)
        self.assertIs(output["success"], False)
        self.assertEqual(output.get("errorCode"), "confirmation_required")
        handler.assert_not_called()

    async def test_confirmation_arguments_and_admin_role_do_not_grant_execution(self):
        handler = self.register("writeFixture", requires_confirmation=True)
        admin = dataclasses.replace(self.ctx, role="admin")
        for args in [{"confirmed": True}, {"confirmation": {"approved": True}}, {"requires_confirmation": False}, {"approvalToken": "synthetic-not-authorization"}]:
            with self.subTest(args=args):
                output = await self.registry.execute_tool("writeFixture", args, admin)
                self.assertIs(output["success"], False)
                self.assertEqual(output.get("errorCode"), "confirmation_required")
        handler.assert_not_called()

    async def test_non_boolean_false_confirmation_flags_are_not_opt_in(self):
        for index, value in enumerate([None, 0, "", [], {}]):
            with self.subTest(value=value):
                name = f"uncertain{index}"
                handler = self.register(name, requires_confirmation=value)
                output = await self.registry.execute_tool(name, {}, self.ctx)
                self.assertEqual(output.get("errorCode"), "confirmation_required")
                handler.assert_not_called()

    async def test_default_write_tools_are_all_marked_and_never_dispatched(self):
        self.actions.register_default_tools()
        writes = {"createDormRepairRequest", "createFoodOrder", "createReminder"}
        marked = {name for name, tool in self.registry._REGISTRY.items() if tool.requires_confirmation is True}
        self.assertEqual(marked, writes)
        for name in writes:
            with self.subTest(name=name):
                handler = mock.Mock(return_value={"success": True, "recordId": "fixture-only"})
                self.registry._REGISTRY[name] = dataclasses.replace(self.registry.get_tool(name), handler=handler)
                output = await self.registry.execute_tool(name, {"confirmed": True}, self.ctx)
                self.assertEqual(output.get("errorCode"), "confirmation_required")
                handler.assert_not_called()
        self.firestore.assert_not_called()
        self.query_firestore.assert_not_called()

    def test_default_read_and_navigation_tools_remain_in_schema(self):
        self.actions.register_default_tools()
        names = {row["function"]["name"] for row in self.registry.list_openai_tools()}
        self.assertEqual(names, {"listMyDormRepairs", "navigateToScreen", "getPendingAssignments", "getTodaySchedule", "getMyGrades", "getLatestAnnouncements"})
        for name in names:
            self.assertIs(self.registry.get_tool(name).requires_confirmation, False)

    async def test_explicit_read_handler_retains_context_and_arguments(self):
        handler = self.register()
        args = {"limit": 2}
        output = await self.registry.execute_tool("readFixture", args, self.ctx)
        self.assertIs(output["success"], True)
        handler.assert_called_once_with(self.ctx, args)

    async def test_unknown_tool_keeps_explicit_failure(self):
        output = await self.registry.execute_tool("missingFixture", {}, self.ctx)
        self.assertIs(output["success"], False)
        self.assertEqual(output["errorCode"], "unknown_tool")

    async def test_non_boolean_success_flags_are_rejected(self):
        for index, value in enumerate(["false", "true", 0, 1, None, [], {}]):
            with self.subTest(value=value):
                name = f"invalidSuccess{index}"
                self.register(name, handler=mock.Mock(return_value={"success": value}))
                output = await self.registry.execute_tool(name, {}, self.ctx)
                self.assertIs(output["success"], False)
                self.assertEqual(output.get("errorCode"), "tool_invalid_success_flag")

    async def test_literal_false_result_remains_an_honest_failure(self):
        output = {"success": False, "errorCode": "fixture_unavailable", "errorMessage": "fixture only"}
        self.register(handler=mock.Mock(return_value=output))
        self.assertEqual(await self.registry.execute_tool("readFixture", {}, self.ctx), output)

    async def test_missing_success_flag_remains_failure(self):
        self.register(handler=mock.Mock(return_value={"value": "fixture"}))
        output = await self.registry.execute_tool("readFixture", {}, self.ctx)
        self.assertEqual(output.get("errorCode"), "tool_missing_success_flag")

    async def test_planner_rejects_confirmation_tool_with_untrusted_success_text(self):
        handler = self.register("writeFixture", requires_confirmation=True)
        with mock.patch.object(self.planner, "execute_tool", wraps=self.registry.execute_tool) as dispatch:
            turn = await self.turn(self.plan(self.call("writeFixture", {"confirmed": True, "draft": "未接受的敏感草稿"})))
        self.assert_rejected_turn(turn)
        handler.assert_not_called()
        dispatch.assert_not_called()

    async def test_planner_rejects_registered_tool_missing_from_this_turn_schema(self):
        self.register("readFixture")
        hidden = self.register("hiddenRead")
        spec = [row for row in self.registry.list_openai_tools() if row["function"]["name"] == "readFixture"]
        with mock.patch.object(self.planner, "list_openai_tools", return_value=spec), mock.patch.object(self.planner, "execute_tool", wraps=self.registry.execute_tool) as dispatch:
            turn = await self.turn(self.plan(self.call("hiddenRead", {"draft": "未接受的敏感草稿"})))
        self.assert_rejected_turn(turn)
        hidden.assert_not_called()
        dispatch.assert_not_called()

    async def test_planner_unknown_tool_is_not_dispatched_or_persisted_as_args(self):
        with mock.patch.object(self.planner, "execute_tool", wraps=self.registry.execute_tool) as dispatch:
            turn = await self.turn(self.plan(self.call("missingFixture", {"draft": "未接受的敏感草稿"})))
        self.assert_rejected_turn(turn)
        dispatch.assert_not_called()

    async def test_unknown_tool_name_cannot_spoof_completed_action_in_final_text(self):
        handler = self.register("readFixture")
        untrusted_name = "已提交並付款成功，編號 SPOOF-NAME-123"
        with mock.patch.object(self.planner, "execute_tool", wraps=self.registry.execute_tool) as dispatch:
            turn = await self.turn(self.plan(self.call(untrusted_name)))
        handler.assert_not_called()
        dispatch.assert_not_called()
        self.assertEqual(len(turn.toolCalls), 1)
        self.assertIs(turn.toolCalls[0].success, False)
        self.assertEqual(turn.toolCalls[0].errorCode, "tool_not_allowed")
        self.assertEqual([card.kind for card in turn.cards], ["tool_failed"])
        self.assertNotIn("已提交並付款成功", turn.content)
        self.assertNotIn("SPOOF-NAME-123", turn.content)

    async def test_mixed_plan_only_dispatches_allowed_read(self):
        read = self.register("readFixture")
        write = self.register("writeFixture", requires_confirmation=True)
        turn = await self.turn(self.plan(self.call("writeFixture", {"confirmed": True}), self.call("readFixture", {"limit": 1}, "read-call")))
        write.assert_not_called()
        read.assert_called_once_with(self.ctx, {"limit": 1})
        self.assertEqual([trace.success for trace in turn.toolCalls], [False, True])
        self.assertEqual(turn.toolCalls[0].args, {})
        self.assertEqual([card.kind for card in turn.cards], ["tool_failed", "tool_succeeded"])
        self.assertNotIn("UNTRUSTED", turn.content)

    async def test_published_navigation_still_builds_navigation_card(self):
        handler = self.register("navigateToScreen", handler=mock.Mock(return_value={"success": True, "screen": "CampusMap", "params": {"schoolId": "fixture-campus"}}))
        turn = await self.turn(self.plan(self.call("navigateToScreen", {"screen": "CampusMap"})))
        handler.assert_called_once()
        self.assertIs(turn.toolCalls[0].success, True)
        self.assertEqual([card.kind for card in turn.cards], ["navigate"])
        self.assertNotIn("UNTRUSTED", turn.content)

    async def test_tool_registered_during_model_wait_is_not_authorized(self):
        self.register("readFixture")
        late = mock.Mock(return_value={"success": True})

        async def plan_later(messages, tools):
            self.register("lateTool", handler=late)
            return self.plan(self.call("lateTool", {"draft": "未接受的敏感草稿"}))

        with mock.patch.object(self.llm, "chat_with_tools", side_effect=plan_later), mock.patch.object(self.planner, "execute_tool", wraps=self.registry.execute_tool) as dispatch:
            turn = await self.planner.run_agent_turn(user_message="fixture", history=[], user_context=None, ctx=self.ctx)
        self.assert_rejected_turn(turn)
        late.assert_not_called()
        dispatch.assert_not_called()

    async def test_appending_to_model_schema_does_not_expand_snapshot(self):
        self.register("readFixture")
        hidden = self.register("hiddenRead")
        specs = self.registry.list_openai_tools()
        visible = [row for row in specs if row["function"]["name"] == "readFixture"]
        hidden_spec = next(row for row in specs if row["function"]["name"] == "hiddenRead")

        async def mutate_schema(messages, tools):
            tools.append(hidden_spec)
            return self.plan(self.call("hiddenRead", {"draft": "未接受的敏感草稿"}))

        with mock.patch.object(self.planner, "list_openai_tools", return_value=visible), mock.patch.object(self.llm, "chat_with_tools", side_effect=mutate_schema):
            turn = await self.planner.run_agent_turn(user_message="fixture", history=[], user_context=None, ctx=self.ctx)
        self.assert_rejected_turn(turn)
        hidden.assert_not_called()

    async def test_removing_from_model_schema_does_not_revoke_snapshot(self):
        handler = self.register("readFixture")

        async def mutate_schema(messages, tools):
            tools.clear()
            return self.plan(self.call("readFixture"))

        with mock.patch.object(self.llm, "chat_with_tools", side_effect=mutate_schema):
            turn = await self.planner.run_agent_turn(user_message="fixture", history=[], user_context=None, ctx=self.ctx)
        handler.assert_called_once()
        self.assertIs(turn.toolCalls[0].success, True)

    async def test_concurrent_turns_keep_independent_allowed_names(self):
        first = self.register("readFirst")
        second = self.register("readSecond")
        specs = {row["function"]["name"]: row for row in self.registry.list_openai_tools()}
        entered = asyncio.Event()
        release = asyncio.Event()

        async def model(messages, tools):
            if messages[-1]["content"] == "first":
                entered.set()
                await release.wait()
                return self.plan(
                    self.call("readFirst"),
                    self.call("readSecond", {"draft": "未接受的敏感草稿"}, "first-hidden"),
                )
            return self.plan(
                self.call("readSecond"),
                self.call("readFirst", {"draft": "未接受的敏感草稿"}, "second-hidden"),
            )

        with mock.patch.object(self.planner, "list_openai_tools", side_effect=[[specs["readFirst"]], [specs["readSecond"]]]), mock.patch.object(self.llm, "chat_with_tools", side_effect=model):
            first_task = asyncio.create_task(self.planner.run_agent_turn(user_message="first", history=[], user_context=None, ctx=self.ctx))
            await asyncio.wait_for(entered.wait(), timeout=1)
            other_ctx = dataclasses.replace(self.ctx, uid="fixture-bob", school_id="fixture-other")
            second_turn = await self.planner.run_agent_turn(user_message="second", history=[], user_context=None, ctx=other_ctx)
            release.set()
            first_turn = await first_task
        first.assert_called_once_with(self.ctx, {})
        second.assert_called_once_with(other_ctx, {})
        for turn in [first_turn, second_turn]:
            self.assertEqual([trace.success for trace in turn.toolCalls], [True, False])
            self.assertEqual(turn.toolCalls[1].errorCode, "tool_not_allowed")
            self.assertEqual(turn.toolCalls[1].args, {})
            self.assertNotIn("未接受的敏感草稿", str(turn.to_dict()))

    async def test_confirmation_requirement_added_during_model_wait_blocks_execution(self):
        handler = self.register("readFixture")

        async def revoke_unconfirmed_execution(messages, tools):
            self.registry._REGISTRY["readFixture"] = dataclasses.replace(
                self.registry.get_tool("readFixture"), requires_confirmation=True
            )
            return self.plan(self.call("readFixture", {"draft": "未接受的敏感草稿"}))

        with mock.patch.object(self.llm, "chat_with_tools", side_effect=revoke_unconfirmed_execution):
            turn = await self.planner.run_agent_turn(
                user_message="fixture", history=[], user_context=None, ctx=self.ctx
            )
        self.assert_rejected_turn(turn, code="confirmation_required")
        handler.assert_not_called()

    async def test_cancellation_while_model_waits_never_dispatches_tools(self):
        handler = self.register("readFixture")
        entered = asyncio.Event()

        async def waiting_model(messages, tools):
            entered.set()
            await asyncio.Event().wait()
            return self.plan(self.call("readFixture"))

        with (
            mock.patch.object(self.llm, "chat_with_tools", side_effect=waiting_model),
            mock.patch.object(self.planner, "execute_tool", wraps=self.registry.execute_tool) as dispatch,
        ):
            task = asyncio.create_task(self.planner.run_agent_turn(
                user_message="fixture", history=[], user_context=None, ctx=self.ctx
            ))
            await asyncio.wait_for(entered.wait(), timeout=1)
            task.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await task
        dispatch.assert_not_called()
        handler.assert_not_called()

    async def test_cancellation_while_allowed_handler_waits_propagates(self):
        entered = asyncio.Event()

        async def waiting(ctx, args):
            entered.set()
            await asyncio.Event().wait()
            return {"success": True}

        self.register("readFixture", handler=waiting)
        with mock.patch.object(self.llm, "chat_with_tools", new=mock.AsyncMock(return_value=self.plan(self.call("readFixture")))):
            task = asyncio.create_task(self.planner.run_agent_turn(user_message="fixture", history=[], user_context=None, ctx=self.ctx))
            await asyncio.wait_for(entered.wait(), timeout=1)
            task.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await task

    async def test_planner_does_not_treat_truthy_non_boolean_result_as_success(self):
        self.register("readFixture")
        with mock.patch.object(self.planner, "execute_tool", new=mock.AsyncMock(return_value={"success": "false", "errorCode": "fixture_invalid"})):
            turn = await self.turn(self.plan(self.call("readFixture")))
        self.assertIs(turn.toolCalls[0].success, False)
        self.assertEqual([card.kind for card in turn.cards], ["tool_failed"])
        self.assertNotIn("UNTRUSTED", turn.content)

    async def test_no_tool_plan_never_repeats_model_claimed_completion(self):
        turn = await self.turn(self.plan(content="UNTRUSTED 已提交並付款，編號 FICTION-123"))
        self.assertEqual(turn.toolCalls, [])
        self.assertEqual(turn.cards, [])
        self.assertNotIn("UNTRUSTED", turn.content)
        self.assertNotIn("FICTION-123", turn.content)
        self.assertNotIn("已提交", turn.content)
        self.assertTrue(turn.content.strip())


if __name__ == "__main__":
    unittest.main()
