"""查詢類工具：查作業、查課表、查成績、查公告。"""

from __future__ import annotations

import asyncio
import datetime
import logging
import os
from typing import Any

from .registry import AgentToolContext

logger = logging.getLogger(__name__)

# ─── Tool Specs（保留給前端/文件對照）───────────────────────────────────

GET_PENDING_ASSIGNMENTS_SPEC = {
    "type": "function",
    "function": {
        "name": "getPendingAssignments",
        "description": "查詢使用者目前尚未繳交的作業和即將到期的考試。使用者問『我有什麼作業』『作業截止時間』時呼叫。",
        "parameters": {
            "type": "object",
            "properties": {
                "limit": {
                    "type": "integer",
                    "description": "最多回傳幾筆，預設 5",
                    "default": 5,
                }
            },
            "required": [],
        },
    },
}

GET_TODAY_SCHEDULE_SPEC = {
    "type": "function",
    "function": {
        "name": "getTodaySchedule",
        "description": "查詢使用者今天的課表。使用者問『今天有什麼課』『幾點上課』時呼叫。",
        "parameters": {"type": "object", "properties": {}, "required": []},
    },
}

GET_GRADES_SPEC = {
    "type": "function",
    "function": {
        "name": "getMyGrades",
        "description": "查詢使用者最新的成績。使用者問『我的成績』『這學期考幾分』時呼叫。",
        "parameters": {
            "type": "object",
            "properties": {
                "semester": {
                    "type": "string",
                    "description": "學期代碼，如 '2025S2'，不填則查最新學期",
                }
            },
            "required": [],
        },
    },
}

GET_ANNOUNCEMENTS_SPEC = {
    "type": "function",
    "function": {
        "name": "getLatestAnnouncements",
        "description": "查詢校園最新公告。使用者問『有什麼公告』『最新消息』時呼叫。",
        "parameters": {
            "type": "object",
            "properties": {
                "limit": {"type": "integer", "description": "最多幾筆，預設 5", "default": 5}
            },
            "required": [],
        },
    },
}


# ─── Firestore access（避免 import tools.actions 造成循環）───────────────


def _firestore_client():
    import firebase_admin
    from firebase_admin import credentials, firestore

    if not firebase_admin._apps:
        cred_path = os.getenv("FIREBASE_CRED_PATH")
        if cred_path:
            firebase_admin.initialize_app(credentials.Certificate(cred_path))
        else:
            firebase_admin.initialize_app()
    return firestore.client()


# ─── Implementations ──────────────────────────────────────────────────


async def get_pending_assignments(ctx: AgentToolContext, args: dict[str, Any]) -> dict[str, Any]:
    limit = int(args.get("limit") or 5)
    limit = max(1, min(limit, 20))
    try:
        def _query():
            db = _firestore_client()
            docs = (
                db.collection("users")
                .doc(ctx.uid)
                .collection("assignments")
                .where("status", "in", ["pending", "overdue"])
                .order_by("dueAt")
                .limit(limit)
                .stream()
            )
            return [d.to_dict() for d in docs]

        items = await asyncio.to_thread(_query)
        return {"success": True, "count": len(items), "items": items}
    except Exception as e:
        logger.warning("getPendingAssignments failed: %s", e)
        return {"success": False, "errorCode": "firestore_error", "errorMessage": str(e)}


async def get_today_schedule(ctx: AgentToolContext, args: dict[str, Any]) -> dict[str, Any]:
    """查今日課表，從 Firestore schools/{school}/courses 讀取。"""
    today_weekday = datetime.datetime.now().weekday()  # 0=Monday
    try:
        def _to_int(value: Any) -> int | None:
            if value is None:
                return None
            try:
                return int(value)
            except (TypeError, ValueError):
                return None

        def _normalize_slot(slot: dict[str, Any]) -> dict[str, Any]:
            # 優先對齊 PostLoginContext.asStudent.courses.schedule 結構
            # 但同時容忍舊資料欄位，避免 schedule card 因 schema 演進而為空。
            weekday = _to_int(slot.get("weekday"))
            if weekday is None:
                weekday = _to_int(slot.get("dayOfWeek"))

            period_start = _to_int(slot.get("periodStart"))
            if period_start is None:
                period_start = _to_int(slot.get("startTime"))

            period_end = _to_int(slot.get("periodEnd"))
            if period_end is None:
                period_end = _to_int(slot.get("endTime"))

            room = slot.get("room")
            if room is None:
                room = slot.get("location")

            return {
                "weekday": weekday,
                "periodStart": period_start,
                "periodEnd": period_end,
                "room": room,
            }

        def _query():
            db = _firestore_client()
            docs = (
                db.collection("schools")
                .doc(ctx.school_id)
                .collection("courses")
                .where("studentUids", "array_contains", ctx.uid)
                .stream()
            )
            result = []
            for d in docs:
                data = d.to_dict() or {}
                for slot in data.get("schedule", []) or []:
                    if not isinstance(slot, dict):
                        continue
                    normalized_slot = _normalize_slot(slot)
                    if normalized_slot.get("weekday") == today_weekday:
                        result.append(
                            {
                                "courseName": data.get("name") or data.get("courseName") or data.get("code"),
                                "room": normalized_slot.get("room"),
                                "periodStart": normalized_slot.get("periodStart"),
                                "periodEnd": normalized_slot.get("periodEnd"),
                            }
                        )
            return sorted(result, key=lambda x: x.get("periodStart") or 0)

        items = await asyncio.to_thread(_query)
        return {"success": True, "weekday": today_weekday, "courses": items}
    except Exception as e:
        logger.warning("getTodaySchedule failed: %s", e)
        return {"success": False, "errorCode": "firestore_error", "errorMessage": str(e)}


async def get_my_grades(ctx: AgentToolContext, args: dict[str, Any]) -> dict[str, Any]:
    semester = args.get("semester")
    try:
        def _query():
            db = _firestore_client()
            ref = db.collection("users").doc(ctx.uid).collection("grades")
            if semester:
                ref = ref.where("semesterId", "==", semester)
            docs = ref.order_by("updatedAt", direction="DESCENDING").limit(20).stream()
            return [d.to_dict() for d in docs]

        items = await asyncio.to_thread(_query)
        return {"success": True, "count": len(items), "items": items}
    except Exception as e:
        logger.warning("getMyGrades failed: %s", e)
        return {"success": False, "errorCode": "firestore_error", "errorMessage": str(e)}


async def get_latest_announcements(ctx: AgentToolContext, args: dict[str, Any]) -> dict[str, Any]:
    limit = int(args.get("limit") or 5)
    limit = max(1, min(limit, 20))
    try:
        def _query():
            db = _firestore_client()
            docs = (
                db.collection("schools")
                .doc(ctx.school_id)
                .collection("announcements")
                .order_by("publishedAt", direction="DESCENDING")
                .limit(limit)
                .stream()
            )
            return [d.to_dict() for d in docs]

        items = await asyncio.to_thread(_query)
        return {"success": True, "count": len(items), "items": items}
    except Exception as e:
        logger.warning("getLatestAnnouncements failed: %s", e)
        return {"success": False, "errorCode": "firestore_error", "errorMessage": str(e)}

