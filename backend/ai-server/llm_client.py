"""Unified LLM client – abstracts Ollama / Together.ai / Groq behind one interface.

Both Together.ai and Groq expose an OpenAI-compatible chat completions API,
so they share a single code path.  Ollama uses its own format.

This module also exposes `chat_with_tools(messages, tools)` so that the agent
runtime can ask the LLM to emit structured tool calls (OpenAI function-calling
format).  For providers that don't support native tool calls we fall back to a
JSON-mode prompt and parse the response.
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field
from typing import Any, AsyncIterator

import asyncio as _asyncio
import time as _time

import httpx

from config import (
    LLM_PROVIDER,
    OLLAMA_BASE_URL,
    MODEL_NAME,
    OPENAI_COMPAT_BASE_URL,
    OPENAI_COMPAT_API_KEY,
    OPENAI_COMPAT_MODEL,
)

logger = logging.getLogger(__name__)

_async_client: httpx.AsyncClient | None = None
_sync_client: httpx.Client | None = None

LLM_DEFAULTS = {"max_tokens": 1024, "temperature": 0.7}

_THINK_RE = re.compile(r"<think>[\s\S]*?</think>\s*", re.DOTALL)


def _strip_think(text: str) -> str:
    """Remove Qwen3 <think>...</think> reasoning blocks from output."""
    cleaned = _THINK_RE.sub("", text).strip()
    if cleaned:
        return cleaned
    # If the model ONLY produced thinking (no actual answer), return the
    # thinking content itself as a fallback so we never return empty.
    inner = re.search(r"<think>([\s\S]*?)</think>", text, re.DOTALL)
    return inner.group(1).strip() if inner else text.strip()


def _get_sync_client() -> httpx.Client:
    global _sync_client
    if _sync_client is None or _sync_client.is_closed:
        _sync_client = httpx.Client(timeout=httpx.Timeout(300, connect=30))
    return _sync_client


async def _get_async_client() -> httpx.AsyncClient:
    global _async_client
    if _async_client is None or _async_client.is_closed:
        _async_client = httpx.AsyncClient(timeout=httpx.Timeout(300, connect=30))
    return _async_client


async def close():
    """Shutdown persistent HTTP clients."""
    global _async_client, _sync_client
    if _async_client and not _async_client.is_closed:
        await _async_client.aclose()
        _async_client = None
    if _sync_client and not _sync_client.is_closed:
        _sync_client.close()
        _sync_client = None


# ─── Ollama helpers ──────────────────────────────────────────────────

async def _ollama_chat(messages: list[dict], **kwargs) -> str:
    client = await _get_async_client()
    resp = await client.post(
        f"{OLLAMA_BASE_URL}/api/chat",
        json={
            "model": MODEL_NAME,
            "messages": messages,
            "stream": False,
            "options": {
                "num_predict": kwargs.get("max_tokens", LLM_DEFAULTS["max_tokens"]),
                "temperature": kwargs.get("temperature", LLM_DEFAULTS["temperature"]),
            },
        },
    )
    resp.raise_for_status()
    return resp.json().get("message", {}).get("content", "")


async def _ollama_stream(messages: list[dict], **kwargs) -> AsyncIterator[str]:
    client = await _get_async_client()
    async with client.stream(
        "POST",
        f"{OLLAMA_BASE_URL}/api/chat",
        json={
            "model": MODEL_NAME,
            "messages": messages,
            "stream": True,
            "options": {
                "num_predict": kwargs.get("max_tokens", LLM_DEFAULTS["max_tokens"]),
                "temperature": kwargs.get("temperature", LLM_DEFAULTS["temperature"]),
            },
        },
    ) as resp:
        async for line in resp.aiter_lines():
            if not line:
                continue
            try:
                data = json.loads(line)
                token = data.get("message", {}).get("content", "")
                if token:
                    yield token
                if data.get("done"):
                    return
            except json.JSONDecodeError:
                continue


def _ollama_chat_sync(messages: list[dict], **kwargs) -> str:
    """Blocking variant used by self-training scripts."""
    client = _get_sync_client()
    resp = client.post(
        f"{OLLAMA_BASE_URL}/api/chat",
        json={
            "model": MODEL_NAME,
            "messages": messages,
            "stream": False,
            "options": {
                "num_predict": kwargs.get("max_tokens", LLM_DEFAULTS["max_tokens"]),
                "temperature": kwargs.get("temperature", LLM_DEFAULTS["temperature"]),
            },
        },
    )
    resp.raise_for_status()
    return resp.json().get("message", {}).get("content", "")


# ─── OpenAI-compatible helpers (Together / Groq / etc.) ──────────────

def _oai_headers() -> dict[str, str]:
    return {
        "Authorization": f"Bearer {OPENAI_COMPAT_API_KEY}",
        "Content-Type": "application/json",
    }


def _oai_body(messages: list[dict], stream: bool, **kwargs) -> dict:
    return {
        "model": OPENAI_COMPAT_MODEL,
        "messages": messages,
        "max_tokens": kwargs.get("max_tokens", LLM_DEFAULTS["max_tokens"]),
        "temperature": kwargs.get("temperature", LLM_DEFAULTS["temperature"]),
        "stream": stream,
    }


async def _oai_chat(messages: list[dict], **kwargs) -> str:
    client = await _get_async_client()
    for attempt in range(4):
        resp = await client.post(
            f"{OPENAI_COMPAT_BASE_URL}/chat/completions",
            headers=_oai_headers(),
            json=_oai_body(messages, stream=False, **kwargs),
        )
        if resp.status_code == 429:
            wait = float(resp.headers.get("retry-after", 2 ** attempt))
            logger.warning("Rate limited (429), retrying in %.1fs (attempt %d)", wait, attempt + 1)
            await _asyncio.sleep(wait)
            continue
        resp.raise_for_status()
        data = resp.json()
        return data["choices"][0]["message"]["content"]
    resp.raise_for_status()
    return ""


async def _oai_stream(messages: list[dict], **kwargs) -> AsyncIterator[str]:
    client = await _get_async_client()
    async with client.stream(
        "POST",
        f"{OPENAI_COMPAT_BASE_URL}/chat/completions",
        headers=_oai_headers(),
        json=_oai_body(messages, stream=True, **kwargs),
    ) as resp:
        async for line in resp.aiter_lines():
            if not line.startswith("data: "):
                continue
            payload = line[6:]
            if payload.strip() == "[DONE]":
                return
            try:
                data = json.loads(payload)
                delta = data["choices"][0].get("delta", {})
                token = delta.get("content", "")
                if token:
                    yield token
            except (json.JSONDecodeError, KeyError, IndexError):
                continue


def _oai_chat_sync(messages: list[dict], **kwargs) -> str:
    """Blocking variant used by self-training scripts."""
    client = _get_sync_client()
    for attempt in range(4):
        resp = client.post(
            f"{OPENAI_COMPAT_BASE_URL}/chat/completions",
            headers=_oai_headers(),
            json=_oai_body(messages, stream=False, **kwargs),
        )
        if resp.status_code == 429:
            wait = float(resp.headers.get("retry-after", 2 ** attempt))
            logger.warning("Rate limited (429), retrying in %.1fs (attempt %d)", wait, attempt + 1)
            _time.sleep(wait)
            continue
        resp.raise_for_status()
        data = resp.json()
        return data["choices"][0]["message"]["content"]
    resp.raise_for_status()
    return ""


# ─── Public API ──────────────────────────────────────────────────────

async def chat(messages: list[dict], **kwargs) -> str:
    """Non-streaming chat completion. Returns the full response text."""
    if LLM_PROVIDER == "ollama":
        raw = await _ollama_chat(messages, **kwargs)
    else:
        raw = await _oai_chat(messages, **kwargs)
    return _strip_think(raw)


async def stream(messages: list[dict], **kwargs) -> AsyncIterator[str]:
    """Streaming chat completion. Yields content tokens, stripping <think> blocks."""
    if LLM_PROVIDER == "ollama":
        raw_iter = _ollama_stream(messages, **kwargs)
    else:
        raw_iter = _oai_stream(messages, **kwargs)

    in_think = False
    async for token in raw_iter:
        if "<think>" in token:
            in_think = True
            before = token.split("<think>")[0]
            if before:
                yield before
            continue
        if in_think:
            if "</think>" in token:
                in_think = False
                after = token.split("</think>", 1)[-1]
                if after:
                    yield after
            continue
        yield token


def chat_sync(messages: list[dict], **kwargs) -> str:
    """Blocking chat completion for use in self-training scripts."""
    if LLM_PROVIDER == "ollama":
        raw = _ollama_chat_sync(messages, **kwargs)
    else:
        raw = _oai_chat_sync(messages, **kwargs)
    return _strip_think(raw)


@dataclass
class ToolCall:
    """A single function call requested by the LLM."""
    id: str
    name: str
    arguments: dict[str, Any]


@dataclass
class ChatPlan:
    """Result of `chat_with_tools`.

    Either:
      * `tool_calls` is non-empty (LLM wants to invoke tools), or
      * `content` is the assistant's final reply.
    """
    content: str = ""
    tool_calls: list[ToolCall] = field(default_factory=list)
    raw_finish_reason: str | None = None
    provider: str = ""
    model: str = ""


def _safe_parse_arguments(raw: Any) -> dict[str, Any]:
    if isinstance(raw, dict):
        return raw
    if not isinstance(raw, str) or not raw.strip():
        return {}
    try:
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, dict) else {}
    except json.JSONDecodeError:
        return {}


def _parse_oai_tool_calls(message: dict[str, Any]) -> list[ToolCall]:
    raw_calls = message.get("tool_calls") or []
    out: list[ToolCall] = []
    for idx, call in enumerate(raw_calls):
        if not isinstance(call, dict):
            continue
        fn = call.get("function") or {}
        name = str(fn.get("name") or "").strip()
        if not name:
            continue
        out.append(
            ToolCall(
                id=str(call.get("id") or f"call_{idx}"),
                name=name,
                arguments=_safe_parse_arguments(fn.get("arguments")),
            )
        )
    return out


async def _oai_chat_with_tools(
    messages: list[dict],
    tools: list[dict],
    *,
    tool_choice: str = "auto",
    **kwargs,
) -> ChatPlan:
    client = await _get_async_client()
    body = _oai_body(messages, stream=False, **kwargs)
    body["tools"] = tools
    body["tool_choice"] = tool_choice
    for attempt in range(4):
        resp = await client.post(
            f"{OPENAI_COMPAT_BASE_URL}/chat/completions",
            headers=_oai_headers(),
            json=body,
        )
        if resp.status_code == 429:
            wait = float(resp.headers.get("retry-after", 2 ** attempt))
            logger.warning(
                "Rate limited (429) on tool call, retrying in %.1fs (attempt %d)",
                wait,
                attempt + 1,
            )
            await _asyncio.sleep(wait)
            continue
        resp.raise_for_status()
        data = resp.json()
        choice = data["choices"][0]
        message = choice.get("message", {}) or {}
        return ChatPlan(
            content=_strip_think(str(message.get("content") or "")),
            tool_calls=_parse_oai_tool_calls(message),
            raw_finish_reason=choice.get("finish_reason"),
            provider=LLM_PROVIDER,
            model=OPENAI_COMPAT_MODEL,
        )
    resp.raise_for_status()
    return ChatPlan(provider=LLM_PROVIDER, model=OPENAI_COMPAT_MODEL)


_JSON_OBJECT_RE = re.compile(r"\{[\s\S]*\}")


def _fallback_tool_prompt(tools: list[dict]) -> str:
    tool_block = json.dumps(
        [t.get("function", t) for t in tools], ensure_ascii=False, indent=2
    )
    return (
        "你必須以「單一 JSON 物件」回答，不要加任何說明文字、不要包 code fence。"
        "格式必須是下面兩種其中之一：\n"
        '  1) {"tool": "<tool name>", "arguments": { ... }}  ← 想呼叫工具時\n'
        '  2) {"tool": null, "reply": "..."}                 ← 直接回答時\n\n'
        "可用工具如下（必須使用一模一樣的名稱與 JSON Schema）：\n"
        f"{tool_block}\n"
    )


async def _fallback_chat_with_tools(
    messages: list[dict],
    tools: list[dict],
    **kwargs,
) -> ChatPlan:
    """For providers without native function calling: ask the model for JSON."""
    instruction = _fallback_tool_prompt(tools)
    augmented = list(messages)
    augmented.insert(0, {"role": "system", "content": instruction})
    raw = await chat(augmented, **kwargs)

    match = _JSON_OBJECT_RE.search(raw or "")
    if not match:
        return ChatPlan(
            content=raw,
            tool_calls=[],
            raw_finish_reason="fallback_no_json",
            provider=LLM_PROVIDER,
            model=MODEL_NAME if LLM_PROVIDER == "ollama" else OPENAI_COMPAT_MODEL,
        )
    try:
        parsed = json.loads(match.group(0))
    except json.JSONDecodeError:
        return ChatPlan(
            content=raw,
            tool_calls=[],
            raw_finish_reason="fallback_bad_json",
            provider=LLM_PROVIDER,
            model=MODEL_NAME if LLM_PROVIDER == "ollama" else OPENAI_COMPAT_MODEL,
        )
    if isinstance(parsed, dict) and parsed.get("tool"):
        name = str(parsed["tool"]).strip()
        args = parsed.get("arguments") if isinstance(parsed.get("arguments"), dict) else {}
        return ChatPlan(
            content="",
            tool_calls=[ToolCall(id="fallback_0", name=name, arguments=args)],
            raw_finish_reason="fallback_tool_call",
            provider=LLM_PROVIDER,
            model=MODEL_NAME if LLM_PROVIDER == "ollama" else OPENAI_COMPAT_MODEL,
        )
    reply = ""
    if isinstance(parsed, dict):
        reply = str(parsed.get("reply") or "")
    return ChatPlan(
        content=reply or raw,
        tool_calls=[],
        raw_finish_reason="fallback_plain_reply",
        provider=LLM_PROVIDER,
        model=MODEL_NAME if LLM_PROVIDER == "ollama" else OPENAI_COMPAT_MODEL,
    )


async def chat_with_tools(
    messages: list[dict],
    tools: list[dict],
    *,
    tool_choice: str = "auto",
    **kwargs,
) -> ChatPlan:
    """Ask the LLM either to call a tool or produce a final answer.

    Uses native OpenAI function-calling for Groq / Together (`tool_calls`
    in the response). Falls back to a JSON-only prompt for Ollama or any
    provider that returns a 400 because tools aren't supported.
    """
    if LLM_PROVIDER in {"together", "groq"} and tools:
        try:
            return await _oai_chat_with_tools(
                messages, tools, tool_choice=tool_choice, **kwargs
            )
        except httpx.HTTPStatusError as exc:
            if exc.response is not None and exc.response.status_code == 400:
                logger.warning(
                    "Provider %s rejected tool spec (400); falling back to JSON mode: %s",
                    LLM_PROVIDER,
                    exc.response.text[:300],
                )
            else:
                raise
    return await _fallback_chat_with_tools(messages, tools, **kwargs)


async def health_check() -> dict:
    """Return provider-specific health info."""
    info: dict = {"provider": LLM_PROVIDER}
    try:
        if LLM_PROVIDER == "ollama":
            client = await _get_async_client()
            resp = await client.get(f"{OLLAMA_BASE_URL}/api/tags", timeout=5)
            models = resp.json().get("models", [])
            info["models"] = [m["name"] for m in models]
            info["model_loaded"] = any(MODEL_NAME.split(":")[0] in m["name"] for m in models)
        else:
            info["base_url"] = OPENAI_COMPAT_BASE_URL
            info["model"] = OPENAI_COMPAT_MODEL
            info["model_loaded"] = True
    except Exception as e:
        info["error"] = str(e)
        info["model_loaded"] = False
    return info
