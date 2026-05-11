"""Agent turn orchestrator.

The flow:
    1. Build a tool-aware system prompt.
    2. Ask the LLM (via `llm_client.chat_with_tools`) whether to call a tool.
    3. If yes:  execute the tool with `tools.execute_tool` and
                BUILD THE FINAL TEXT DETERMINISTICALLY from the tool's return
                value.  We never let the LLM write "已提交" — that decision is
                owned by the server.
       If no:   pass the message through as the final reply.

The output envelope is the same shape regardless of whether a tool ran, so the
caller (server.py) can write it into Firestore (`agentRuns`) and return it to
the mobile app for rendering.
"""

from __future__ import annotations

import json
import logging
import time
import uuid
from dataclasses import asdict, dataclass, field
from typing import Any

import llm_client
from tools import (
    AgentToolContext,
    execute_tool,
    list_openai_tools,
)

logger = logging.getLogger(__name__)

# ─── Public types ───────────────────────────────────────────────────


@dataclass
class ToolCallTrace:
    """One executed tool call.  Goes into the response envelope verbatim."""

    name: str
    args: dict[str, Any]
    output: dict[str, Any]
    success: bool
    durationMs: int
    errorCode: str | None = None
    errorMessage: str | None = None
    callId: str | None = None


@dataclass
class ResponseCard:
    """A structured card the mobile app can render.

    `kind` is the only contract; payload shape is per-kind and documented
    inline in `_build_cards`.
    """

    kind: str
    payload: dict[str, Any]


@dataclass
class AgentTurn:
    runId: str
    content: str
    toolCalls: list[ToolCallTrace] = field(default_factory=list)
    cards: list[ResponseCard] = field(default_factory=list)
    plannerFinishReason: str | None = None
    provider: str = ""
    model: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "runId": self.runId,
            "content": self.content,
            "toolCalls": [asdict(tc) for tc in self.toolCalls],
            "cards": [asdict(c) for c in self.cards],
            "plannerFinishReason": self.plannerFinishReason,
            "provider": self.provider,
            "model": self.model,
        }


# ─── Prompt building ────────────────────────────────────────────────


_TOOL_SYSTEM_PROMPT = (
    "你是「校園 AI 代理」。\n"
    "你的工作流程：\n"
    "1. 仔細讀使用者最後一句話，判斷他是『閒聊／查資料』還是『叫你動手做一件事』。\n"
    "2. 如果是要動手做一件事（例如報修、訂餐、查我的報修紀錄），你**必須**呼叫對應的工具，"
    "把參數依照工具的 JSON Schema 填好。\n"
    "3. 永遠不要自己寫『已提交』、『已成功』、『申請編號是 #1234』之類的字串。"
    "成功訊息會由系統根據工具回傳值自動產生。\n"
    "4. 如果使用者沒提供必要欄位（例如報修缺地點），你**不要呼叫工具**，"
    "改用一兩句自然的中文問清楚再說。\n"
    "5. 如果只是普通對話、查 APP 功能，就不要呼叫任何工具，直接回答即可。\n"
    "6. 工具錯誤訊息（success=False / errorCode）由系統處理，你不需要解釋。\n"
)


def _build_user_context_block(user_context: dict[str, Any] | None) -> str:
    if not user_context:
        return ""
    parts: list[str] = ["\n【目前使用者背景】"]
    name = user_context.get("userName")
    if name:
        parts.append(f"- 姓名：{name}")
    sid = user_context.get("schoolId")
    if sid:
        parts.append(f"- 學校：{sid}")
    role = user_context.get("role")
    if role:
        parts.append(f"- 角色：{role}")
    return "\n".join(parts) if len(parts) > 1 else ""


def build_agent_messages(
    *,
    user_message: str,
    history: list[dict[str, str]] | None,
    user_context: dict[str, Any] | None,
) -> list[dict[str, str]]:
    system = _TOOL_SYSTEM_PROMPT + _build_user_context_block(user_context)
    messages: list[dict[str, str]] = [{"role": "system", "content": system}]
    for msg in (history or [])[-8:]:
        role = msg.get("role")
        content = msg.get("content")
        if role in {"user", "assistant"} and isinstance(content, str):
            messages.append({"role": role, "content": content})
    messages.append({"role": "user", "content": user_message})
    return messages


# ─── Deterministic response building ─────────────────────────────────


_REPAIR_URGENCY_LABEL = {"low": "低", "normal": "普通", "high": "高"}


def _format_repair_success(output: dict[str, Any]) -> str:
    rid = output.get("repairId") or "未知"
    loc = output.get("location") or "（未填地點）"
    cat = output.get("category") or "其他"
    urg = _REPAIR_URGENCY_LABEL.get(output.get("urgency") or "normal", "普通")
    return (
        "✅ 已幫你建立宿舍報修。\n"
        f"地點：{loc}\n"
        f"類別：{cat}\n"
        f"緊急度：{urg}\n"
        f"報修編號：{rid}\n"
        "你可以到「我的 → 我的報修」追蹤後續進度。"
    )


def _format_order_success(output: dict[str, Any]) -> str:
    oid = output.get("orderId") or "未知"
    caf = output.get("cafeteria") or "餐廳"
    item = output.get("itemName") or "餐點"
    qty = output.get("quantity") or 1
    total = output.get("total")
    total_str = f"，總額 NT$ {total}" if isinstance(total, (int, float)) else ""
    return (
        f"✅ 已幫你下訂單。\n"
        f"餐廳：{caf}\n"
        f"品項：{item} × {qty}{total_str}\n"
        f"訂單編號：{oid}\n"
        "可到「校園 → 餐廳訂單」查看狀態。"
    )


def _format_reminder_success(output: dict[str, Any]) -> str:
    rid = output.get("reminderId") or "未知"
    title = output.get("title") or "提醒事項"
    at = output.get("time") or "稍後"
    return (
        "✅ 已幫你建立提醒。\n"
        f"標題：{title}\n"
        f"時間：{at}\n"
        f"提醒編號：{rid}\n"
        "你可以到行事曆頁面查看或調整。"
    )


def _format_list_repairs_success(output: dict[str, Any]) -> str:
    items = output.get("items") or []
    if not items:
        return "目前查無你的宿舍報修紀錄。"
    lines = [f"找到 {len(items)} 筆宿舍報修紀錄："]
    for it in items[:10]:
        loc = it.get("location") or "未知地點"
        status = it.get("status") or "pending"
        rid = it.get("repairId") or "?"
        lines.append(f"• {loc}（狀態：{status}，#{rid}）")
    return "\n".join(lines)


def _format_generic_failure(
    tool_name: str, error_code: str | None, error_message: str | None
) -> str:
    pretty = {
        "createDormRepairRequest": "宿舍報修",
        "createFoodOrder": "餐廳訂單",
        "listMyDormRepairs": "查詢宿舍報修",
    }.get(tool_name, tool_name)
    hint = ""
    if tool_name == "createDormRepairRequest":
        hint = "\n建議你直接到「校園 → 宿舍 → 我要報修」手動填寫。"
    elif tool_name == "createFoodOrder":
        hint = "\n建議你到「校園 → 餐廳」頁面挑選餐點後直接送出。"
    code = error_code or "unknown_error"
    msg = error_message or "（未提供錯誤訊息）"
    return (
        f"⚠️ 抱歉，{pretty}這次沒成功。\n"
        f"原因：{msg}（{code}）"
        f"{hint}"
    )


def _build_cards(traces: list[ToolCallTrace]) -> list[ResponseCard]:
    cards: list[ResponseCard] = []
    for trace in traces:
        if not trace.success:
            cards.append(
                ResponseCard(
                    kind="tool_failed",
                    payload={
                        "tool": trace.name,
                        "errorCode": trace.errorCode,
                        "errorMessage": trace.errorMessage,
                    },
                )
            )
            continue
        if trace.name == "createDormRepairRequest":
            cards.append(
                ResponseCard(
                    kind="repair_submitted",
                    payload={
                        "repairId": trace.output.get("repairId"),
                        "location": trace.output.get("location"),
                        "category": trace.output.get("category"),
                        "urgency": trace.output.get("urgency"),
                        "status": trace.output.get("status", "pending"),
                    },
                )
            )
        elif trace.name == "navigateToScreen":
            cards.append(
                ResponseCard(
                    kind="navigate",
                    payload={
                        "screen": trace.output.get("screen"),
                        "params": trace.output.get("params") or {},
                    },
                )
            )
        elif trace.name == "createFoodOrder":
            cards.append(
                ResponseCard(
                    kind="order_submitted",
                    payload={
                        "orderId": trace.output.get("orderId"),
                        "cafeteria": trace.output.get("cafeteria"),
                        "itemName": trace.output.get("itemName"),
                        "quantity": trace.output.get("quantity"),
                        "total": trace.output.get("total"),
                    },
                )
            )
        elif trace.name == "listMyDormRepairs":
            cards.append(
                ResponseCard(
                    kind="repair_list",
                    payload={
                        "count": trace.output.get("count", 0),
                        "items": trace.output.get("items") or [],
                    },
                )
            )
        elif trace.name == "getPendingAssignments":
            cards.append(
                ResponseCard(
                    kind="assignment_list",
                    payload={
                        "count": trace.output.get("count", 0),
                        "items": trace.output.get("items") or [],
                    },
                )
            )
        elif trace.name == "getTodaySchedule":
            cards.append(
                ResponseCard(
                    kind="schedule_today",
                    payload={
                        "weekday": trace.output.get("weekday"),
                        "courses": trace.output.get("courses") or [],
                    },
                )
            )
        elif trace.name == "getMyGrades":
            cards.append(
                ResponseCard(
                    kind="grades_list",
                    payload={
                        "count": trace.output.get("count", 0),
                        "items": trace.output.get("items") or [],
                    },
                )
            )
        elif trace.name == "getLatestAnnouncements":
            cards.append(
                ResponseCard(
                    kind="announcements_list",
                    payload={
                        "count": trace.output.get("count", 0),
                        "items": trace.output.get("items") or [],
                    },
                )
            )
        elif trace.name == "createReminder":
            cards.append(
                ResponseCard(
                    kind="reminder_created",
                    payload={
                        "reminderId": trace.output.get("reminderId"),
                        "title": trace.output.get("title"),
                        "time": trace.output.get("time"),
                        "source": trace.output.get("source"),
                    },
                )
            )
        else:  # pragma: no cover — defensive
            cards.append(ResponseCard(kind="tool_succeeded", payload={
                "tool": trace.name,
                "output": trace.output,
            }))
    return cards


def _build_final_text(traces: list[ToolCallTrace], llm_content: str) -> str:
    if not traces:
        return llm_content.strip() or "我幫不上忙時通常會建議去 APP 對應的頁面手動處理。"
    pieces: list[str] = []
    for trace in traces:
        if not trace.success:
            pieces.append(
                _format_generic_failure(trace.name, trace.errorCode, trace.errorMessage)
            )
            continue
        if trace.name == "createDormRepairRequest":
            pieces.append(_format_repair_success(trace.output))
        elif trace.name == "navigateToScreen":
            screen = trace.output.get("screen", "")
            pieces.append(f"好的，正在帶你前往{screen}頁面。")
        elif trace.name == "createFoodOrder":
            pieces.append(_format_order_success(trace.output))
        elif trace.name == "listMyDormRepairs":
            pieces.append(_format_list_repairs_success(trace.output))
        elif trace.name == "getPendingAssignments":
            items = trace.output.get("items") or []
            if not items:
                pieces.append("目前查無待繳作業，繼續加油！")
            else:
                lines = [f"你有 {len(items)} 筆待繳作業："]
                for it in items[:5]:
                    title = it.get("title") or "未知作業"
                    due = it.get("dueAt") or "無截止時間"
                    lines.append(f"• {title}（截止：{due}）")
                pieces.append("\n".join(lines))
        elif trace.name == "getTodaySchedule":
            courses = trace.output.get("courses") or []
            if not courses:
                pieces.append("今天沒有排課，可以好好休息！")
            else:
                weekday_zh = ["週一", "週二", "週三", "週四", "週五", "週六", "週日"]
                wd = trace.output.get("weekday", 0)
                lines = [f"{weekday_zh[wd]}課表（共 {len(courses)} 堂）："]
                for c in courses:
                    name = c.get("courseName") or "課程"
                    room = c.get("room") or "未知教室"
                    lines.append(f"• {name} ｜ {room}")
                pieces.append("\n".join(lines))
        elif trace.name == "getMyGrades":
            items = trace.output.get("items") or []
            if not items:
                pieces.append("目前查無成績資料。")
            else:
                lines = [f"找到 {len(items)} 筆成績："]
                for it in items[:8]:
                    name = it.get("courseName") or it.get("name") or "課程"
                    score = it.get("score") or it.get("grade") or "未登錄"
                    lines.append(f"• {name}：{score}")
                pieces.append("\n".join(lines))
        elif trace.name == "getLatestAnnouncements":
            items = trace.output.get("items") or []
            if not items:
                pieces.append("目前沒有最新公告。")
            else:
                lines = [f"最新 {len(items)} 則公告："]
                for it in items[:5]:
                    title = it.get("title") or "公告"
                    lines.append(f"• {title}")
                pieces.append("\n".join(lines))
        elif trace.name == "createReminder":
            pieces.append(_format_reminder_success(trace.output))
        else:
            pieces.append(
                f"✅ 已執行 {trace.name}：{json.dumps(trace.output, ensure_ascii=False)}"
            )
    return "\n\n".join(pieces)


# ─── Public entry point ─────────────────────────────────────────────


async def run_agent_turn(
    *,
    user_message: str,
    history: list[dict[str, str]] | None,
    user_context: dict[str, Any] | None,
    ctx: AgentToolContext,
    max_tool_calls: int = 3,
) -> AgentTurn:
    """Run one agent turn.

    `max_tool_calls` caps how many tools we let the model invoke per request,
    to avoid runaway loops.  The current implementation only does a single
    planner round-trip — we execute the tools the model asked for, then build
    the final text deterministically without a second LLM call.  This is the
    "禁止瞎掰成功" guardrail in code form.
    """
    run_id = f"py_agent_{int(time.time() * 1000)}_{uuid.uuid4().hex[:6]}"
    tools_spec = list_openai_tools()
    logger.info(
        "run_agent_turn start | uid=%s | msg=%r | tools=%s",
        ctx.uid,
        user_message[:60],
        [t["function"]["name"] for t in tools_spec],
    )

    messages = build_agent_messages(
        user_message=user_message,
        history=history,
        user_context=user_context,
    )

    plan: llm_client.ChatPlan
    try:
        plan = await llm_client.chat_with_tools(messages, tools_spec)
        logger.info(
            "LLM plan | tool_calls=%s | content_len=%d",
            [c.name for c in plan.tool_calls],
            len(plan.content or ""),
        )
    except Exception as exc:
        logger.exception("LLM planner failed")
        return AgentTurn(
            runId=run_id,
            content=(
                "⚠️ AI 規劃階段出錯，這次沒辦法幫你動手做。"
                "建議直接到 APP 對應的頁面手動處理。\n"
                f"（除錯：{exc}）"
            ),
            plannerFinishReason="planner_exception",
        )

    traces: list[ToolCallTrace] = []
    calls_to_run = plan.tool_calls[:max_tool_calls]
    for call in calls_to_run:
        started = time.monotonic()
        output = await execute_tool(call.name, call.arguments, ctx)
        duration_ms = int((time.monotonic() - started) * 1000)
        success = bool(output.get("success", False))
        traces.append(
            ToolCallTrace(
                name=call.name,
                args=call.arguments,
                output=output,
                success=success,
                durationMs=duration_ms,
                errorCode=None if success else str(output.get("errorCode") or ""),
                errorMessage=None if success else str(output.get("errorMessage") or ""),
                callId=call.id,
            )
        )

    final_text = _build_final_text(traces, plan.content)
    cards = _build_cards(traces)

    return AgentTurn(
        runId=run_id,
        content=final_text,
        toolCalls=traces,
        cards=cards,
        plannerFinishReason=plan.raw_finish_reason,
        provider=plan.provider,
        model=plan.model,
    )
