"""讀取 users/{uid}/settings/assistantPermissions（與 Cloud Functions 同一份）。

fail closed：讀不到／格式錯誤／未開 → 不允許寫入。
工具別名與 packages/shared 對齊（createFoodOrder→createOrder 等）。
"""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)

PERMISSION_DOC_ID = "assistantPermissions"

# 與 packages/shared/src/assistantPermissions.ts 的 key／別名對齊
WRITE_PERMISSION_KEYS = (
    "submitLeaveRequest",
    "reserveSeat",
    "borrowBook",
    "renewBook",
    "returnBook",
    "createDormRepairRequest",
    "reserveWashingMachine",
    "createOrder",
    "cancelOrder",
    "submitQuizAttempt",
    "verifyAttendanceClaim",
    "createPersonalTodoReminder",
)

TOOL_ALIASES: dict[str, str] = {
    "proposeOrder": "createOrder",
    "createFoodOrder": "createOrder",
    "createReminder": "createPersonalTodoReminder",
    "split_assignment": "createPersonalTodoReminder",
    "schedule_reminder": "createPersonalTodoReminder",
    "create_reminder_draft": "createPersonalTodoReminder",
}

# 需確認後才寫入的工具：執行前必須通過權限檢查
CONFIRMATION_WRITE_TOOLS = frozenset(
    {
        "createDormRepairRequest",
        "createFoodOrder",
        "createReminder",
    }
)

SETTINGS_HREF = "/settings?section=assistant"

LABELS: dict[str, str] = {
    "createDormRepairRequest": "送出宿舍報修",
    "createOrder": "餐廳下單",
    "createPersonalTodoReminder": "建立個人待辦與提醒",
}


def default_permissions() -> dict[str, bool]:
    return {key: False for key in WRITE_PERMISSION_KEYS}


def normalize_permissions(value: Any) -> dict[str, bool]:
    defaults = default_permissions()
    if not isinstance(value, dict):
        return defaults
    next_perms = dict(defaults)
    for key in WRITE_PERMISSION_KEYS:
        next_perms[key] = value.get(key) is True
    return next_perms


def resolve_permission_key(tool_name: str) -> str | None:
    if tool_name in WRITE_PERMISSION_KEYS:
        return tool_name
    return TOOL_ALIASES.get(tool_name)


def is_write_tool_allowed(permissions: dict[str, bool] | None, tool_name: str) -> bool:
    key = resolve_permission_key(tool_name)
    if not permissions or not key:
        return False
    return permissions.get(key) is True


def permission_denied_message(tool_name: str) -> str:
    key = resolve_permission_key(tool_name) or tool_name
    label = LABELS.get(key, key)
    return (
        f"你在設定關閉了「{label}」，可到設定頁開啟。\n"
        f"設定路徑：設定 → 助理權限（{SETTINGS_HREF}）"
    )


def load_permissions_for_uid(uid: str | None, firestore_client_factory) -> dict[str, bool] | None:
    """回傳正規化權限；無法讀取時回 None（呼叫端視為無 Firestore／fail closed 或草稿）。"""
    if not uid or not isinstance(uid, str):
        return None
    try:
        db = firestore_client_factory()
        snap = (
            db.collection("users")
            .document(uid)
            .collection("settings")
            .document(PERMISSION_DOC_ID)
            .get()
        )
        if not snap.exists:
            return default_permissions()
        return normalize_permissions(snap.to_dict())
    except Exception as exc:  # pragma: no cover - 防禦
        logger.warning("assistant permissions load failed: %s", exc)
        return None
