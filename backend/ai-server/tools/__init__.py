"""LLM-callable campus tools.

This package owns:
    registry.py – tool catalog + JSON schemas for OpenAI function calling
    actions.py  – concrete handlers (Firestore writes / reads)

The pattern:
    Every handler returns a dict shaped like
        { "success": True,  ...payload }
        { "success": False, "errorCode": "...", "errorMessage": "..." }
    The AI server uses this return value (NOT the LLM's free text) to
    decide whether the user sees a "✅ done" card or a "❌ failed" message.
"""

from .registry import (
    AgentToolContext,
    ToolDefinition,
    ToolExecutionError,
    execute_tool,
    get_tool,
    list_openai_tools,
    register_tool,
    tool_names,
)

__all__ = [
    "AgentToolContext",
    "ToolDefinition",
    "ToolExecutionError",
    "execute_tool",
    "get_tool",
    "list_openai_tools",
    "register_tool",
    "tool_names",
]
