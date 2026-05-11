"""Tool registry and OpenAI-compatible function-calling schemas.

A tool is just::

    register_tool(
        name="createDormRepairRequest",
        description="...",
        parameters={...JSON schema...},
        handler=create_dorm_repair_request,
    )

`list_openai_tools()` produces the array you pass to the `tools` param of an
OpenAI / Groq / Together chat completion request.
"""

from __future__ import annotations

import asyncio
import inspect
import logging
from dataclasses import dataclass
from typing import Any, Awaitable, Callable

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class AgentToolContext:
    """Per-request context passed to every tool handler."""

    uid: str
    school_id: str
    user_name: str | None = None
    role: str | None = None


ToolHandler = Callable[[AgentToolContext, dict[str, Any]], Awaitable[dict[str, Any]] | dict[str, Any]]


@dataclass(frozen=True)
class ToolDefinition:
    name: str
    description: str
    parameters: dict[str, Any]
    handler: ToolHandler
    requires_confirmation: bool = False


class ToolExecutionError(Exception):
    """Raised by tool handlers to signal a structured failure.

    Carries an `error_code` so the planner can branch on it without parsing
    free-form messages.
    """

    def __init__(self, error_code: str, message: str) -> None:
        super().__init__(message)
        self.error_code = error_code
        self.message = message


_REGISTRY: dict[str, ToolDefinition] = {}


def register_tool(
    *,
    name: str,
    description: str,
    parameters: dict[str, Any],
    handler: ToolHandler,
    requires_confirmation: bool = False,
) -> None:
    if name in _REGISTRY:
        raise ValueError(f"Tool already registered: {name}")
    _REGISTRY[name] = ToolDefinition(
        name=name,
        description=description,
        parameters=parameters,
        handler=handler,
        requires_confirmation=requires_confirmation,
    )


def get_tool(name: str) -> ToolDefinition | None:
    return _REGISTRY.get(name)


def tool_names() -> list[str]:
    return list(_REGISTRY.keys())


def list_openai_tools() -> list[dict[str, Any]]:
    """Build the `tools` array for OpenAI-compatible chat completions."""
    return [
        {
            "type": "function",
            "function": {
                "name": tool.name,
                "description": tool.description,
                "parameters": tool.parameters,
            },
        }
        for tool in _REGISTRY.values()
    ]


async def execute_tool(
    name: str,
    args: dict[str, Any] | None,
    ctx: AgentToolContext,
) -> dict[str, Any]:
    """Run a tool handler. Always returns a `{success, ...}` dict.

    The planner relies on this contract: if `success` is False, the user-facing
    text must come from a server-controlled template, never from the LLM.
    """
    tool = get_tool(name)
    if tool is None:
        return {
            "success": False,
            "errorCode": "unknown_tool",
            "errorMessage": f"Unknown tool: {name}",
        }

    safe_args = args if isinstance(args, dict) else {}
    try:
        result = tool.handler(ctx, safe_args)
        if inspect.isawaitable(result):
            result = await result
        if not isinstance(result, dict):
            return {
                "success": False,
                "errorCode": "tool_returned_non_dict",
                "errorMessage": f"Tool {name} returned {type(result).__name__}",
            }
        if "success" not in result:
            # Be strict: every tool MUST declare success/failure explicitly.
            return {
                "success": False,
                "errorCode": "tool_missing_success_flag",
                "errorMessage": f"Tool {name} did not return a `success` boolean.",
                "rawOutput": result,
            }
        return result
    except ToolExecutionError as exc:
        logger.warning("Tool %s structured failure: %s", name, exc.message)
        return {
            "success": False,
            "errorCode": exc.error_code,
            "errorMessage": exc.message,
        }
    except asyncio.CancelledError:
        raise
    except Exception as exc:  # pragma: no cover - defensive
        logger.exception("Tool %s crashed", name)
        return {
            "success": False,
            "errorCode": "tool_crashed",
            "errorMessage": str(exc),
        }
