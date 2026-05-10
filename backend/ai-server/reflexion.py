"""Optional Reflexion pass for sync chat: retry once when the first reply looks low-quality."""

from __future__ import annotations

import logging
from typing import Any, Awaitable, Callable

logger = logging.getLogger("campus-ai.reflexion")

ChatFn = Callable[[list[dict[str, Any]]], Awaitable[str]]


REFLECTOR_SYSTEM = """你是反思模組。只能根據使用者問題與助理上一輪回答，指出不足與改進方向。
輸出 2～4 句繁體中文，總長不超過 480 字。不得發明未出現的事實。"""


def needs_quality_reflexion(content: str) -> bool:
    """規則型 Evaluator：過短或典型道歉／忙碌话术視為需反思重試。"""
    t = (content or "").strip()
    if len(t) < 18:
        return True
    bad_markers = ("暫時忙碌", "請稍後再試", "無法回答", "抱歉，AI")
    return any(m in t for m in bad_markers)


async def generate_reflection(llm_chat: ChatFn, user_message: str, assistant_reply: str) -> str:
    messages = [
        {"role": "system", "content": REFLECTOR_SYSTEM},
        {
            "role": "user",
            "content": (
                f"使用者問題：\n{user_message[:1200]}\n\n"
                f"助理上一輪回答：\n{assistant_reply[:2000]}\n\n請輸出反思。"
            ),
        },
    ]
    raw = await llm_chat(messages)
    text = (raw or "").strip()
    if len(text) > 480:
        text = text[:480] + "…"
    return text


async def maybe_retry_with_reflexion(
    llm_chat: ChatFn,
    messages: list[dict[str, Any]],
    user_message: str,
    first_content: str,
) -> str:
    """Reflector + 第二次 Actor：將反思附加為 user，再問一次 LLM。"""
    reflection = await generate_reflection(llm_chat, user_message, first_content)
    if not reflection:
        return first_content
    logger.info(
        "Reflexion quality retry (sync): reflection_len=%d user_preview=%s",
        len(reflection),
        user_message[:80].replace("\n", " "),
    )
    augmented = [
        *messages,
        {"role": "assistant", "content": first_content},
        {
            "role": "user",
            "content": (
                "【回答品質反思】\n"
                f"{reflection}\n"
                "請根據反思重新完整回答使用者上一則問題（繁體中文）。"
            ),
        },
    ]
    second = await llm_chat(augmented)
    out = (second or "").strip()
    return out if out else first_content
