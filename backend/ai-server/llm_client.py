"""Unified LLM client – abstracts Ollama / Together.ai / Groq behind one interface.

Both Together.ai and Groq expose an OpenAI-compatible chat completions API,
so they share a single code path.  Ollama uses its own format.
"""

from __future__ import annotations

import json
import logging
import re
from typing import AsyncIterator

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
