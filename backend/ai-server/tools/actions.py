"""Concrete tool implementations the AI server can call.

Every handler:
    1. Validates input (returns structured `success=False` if bad).
    2. Talks to Firestore via `firebase-admin`.
    3. Returns `{ "success": True, ... }` on success, or
       raises `ToolExecutionError(error_code, message)` on failure.

The planner takes care of converting those returns into user-facing text.
"""

from __future__ import annotations

import asyncio
import logging
import os
from typing import Any

from .registry import (
    AgentToolContext,
    ToolExecutionError,
    register_tool,
    tool_names,
)

logger = logging.getLogger(__name__)


# ─── Firestore access ────────────────────────────────────────────────


def _firestore_client():
    """Return a firebase_admin firestore client, initializing the app if needed.

    Mirrors `_ensure_firebase_app` in server.py but avoids the import cycle.
    """
    import firebase_admin
    from firebase_admin import credentials, firestore

    if not firebase_admin._apps:
        cred_path = os.getenv("FIREBASE_CRED_PATH")
        if cred_path:
            firebase_admin.initialize_app(credentials.Certificate(cred_path))
        else:
            firebase_admin.initialize_app()
    return firestore.client()


def _server_timestamp():
    from firebase_admin import firestore
    return firestore.SERVER_TIMESTAMP


# ─── createDormRepairRequest ─────────────────────────────────────────


REPAIR_CATEGORIES = {
    "water",        # 水電
    "electric",
    "plumbing",
    "furniture",
    "internet",
    "air_conditioning",
    "lock",
    "door_window",
    "other",
}


def _validate_repair_input(args: dict[str, Any]) -> dict[str, Any]:
    location = str(args.get("location") or "").strip()
    category = str(args.get("category") or "").strip().lower()
    description = str(args.get("description") or "").strip()
    urgency = str(args.get("urgency") or "normal").strip().lower()

    if not location:
        raise ToolExecutionError("missing_location", "缺少報修地點 (location)。")
    if not description:
        raise ToolExecutionError("missing_description", "缺少報修描述 (description)。")
    if len(description) > 1000:
        raise ToolExecutionError("description_too_long", "報修描述超過 1000 字。")
    if category and category not in REPAIR_CATEGORIES:
        # Don't reject — store as `other` and keep the raw value.
        category_other = category
        category = "other"
    else:
        category_other = None
    if urgency not in {"low", "normal", "high"}:
        urgency = "normal"

    return {
        "location": location,
        "category": category or "other",
        "categoryRaw": category_other,
        "description": description,
        "urgency": urgency,
    }


async def _create_dorm_repair_request(
    ctx: AgentToolContext, args: dict[str, Any]
) -> dict[str, Any]:
    # Debug hook: lets us prove that "submit failed" path renders correctly.
    if str(os.getenv("DEBUG_FORCE_REPAIR_TOOL_ERROR", "")).strip() == "1":
        raise ToolExecutionError(
            "debug_forced_failure",
            "DEBUG_FORCE_REPAIR_TOOL_ERROR=1 → 故意讓報修失敗，用來驗證『失敗文案』。",
        )

    if not ctx.uid:
        raise ToolExecutionError("missing_uid", "尚未登入，無法提交報修。")
    if not ctx.school_id:
        raise ToolExecutionError("missing_school", "缺少學校資訊，無法提交報修。")

    clean = _validate_repair_input(args)

    def _write() -> str:
        db = _firestore_client()
        col = db.collection("schools").document(ctx.school_id).collection("repairRequests")
        payload = {
            "schoolId": ctx.school_id,
            "userId": ctx.uid,
            "location": clean["location"],
            "category": clean["category"],
            "categoryRaw": clean["categoryRaw"],
            "description": clean["description"],
            "urgency": clean["urgency"],
            "images": [],
            "status": "pending",
            "source": "ai_server_agent",
            "createdAt": _server_timestamp(),
        }
        _, ref = col.add(payload)
        return ref.id

    repair_id = await asyncio.to_thread(_write)

    return {
        "success": True,
        "repairId": repair_id,
        "location": clean["location"],
        "category": clean["category"],
        "urgency": clean["urgency"],
        "status": "pending",
    }


# ─── listMyDormRepairs ───────────────────────────────────────────────


async def _list_my_dorm_repairs(
    ctx: AgentToolContext, args: dict[str, Any]
) -> dict[str, Any]:
    if not ctx.uid:
        raise ToolExecutionError("missing_uid", "尚未登入，無法查詢報修。")
    if not ctx.school_id:
        raise ToolExecutionError("missing_school", "缺少學校資訊，無法查詢報修。")

    raw_limit = args.get("limit", 10)
    try:
        limit = max(1, min(int(raw_limit), 50))
    except (TypeError, ValueError):
        limit = 10

    def _read() -> list[dict[str, Any]]:
        from firebase_admin import firestore as fb_firestore  # noqa: F401  # for type imports
        db = _firestore_client()
        query = (
            db.collection("schools")
            .document(ctx.school_id)
            .collection("repairRequests")
            .where("userId", "==", ctx.uid)
            .limit(limit)
        )
        items: list[dict[str, Any]] = []
        for snap in query.stream():
            data = snap.to_dict() or {}
            created = data.get("createdAt")
            try:
                created_iso = created.isoformat() if created is not None else None
            except Exception:
                created_iso = None
            items.append(
                {
                    "repairId": snap.id,
                    "location": data.get("location"),
                    "category": data.get("category"),
                    "status": data.get("status", "pending"),
                    "urgency": data.get("urgency"),
                    "createdAt": created_iso,
                }
            )
        items.sort(key=lambda it: it.get("createdAt") or "", reverse=True)
        return items

    items = await asyncio.to_thread(_read)
    return {"success": True, "count": len(items), "items": items}


# ─── createFoodOrder ─────────────────────────────────────────────────


async def _create_food_order(
    ctx: AgentToolContext, args: dict[str, Any]
) -> dict[str, Any]:
    if str(os.getenv("DEBUG_FORCE_ORDER_TOOL_ERROR", "")).strip() == "1":
        raise ToolExecutionError(
            "debug_forced_failure",
            "DEBUG_FORCE_ORDER_TOOL_ERROR=1 → 故意讓訂餐失敗。",
        )

    if not ctx.uid:
        raise ToolExecutionError("missing_uid", "尚未登入，無法下訂單。")
    if not ctx.school_id:
        raise ToolExecutionError("missing_school", "缺少學校資訊，無法下訂單。")

    restaurant_id = str(args.get("restaurantId") or args.get("cafeteriaId") or "").strip()
    item_id = str(args.get("itemId") or args.get("menuItemId") or "").strip()
    note = str(args.get("note") or "").strip() or None

    try:
        quantity = int(args.get("quantity") or 1)
    except (TypeError, ValueError):
        quantity = 1

    if not restaurant_id:
        raise ToolExecutionError("missing_restaurant", "缺少 restaurantId / cafeteriaId。")
    if not item_id:
        raise ToolExecutionError("missing_item", "缺少 itemId / menuItemId。")
    if quantity < 1 or quantity > 20:
        raise ToolExecutionError(
            "invalid_quantity", "數量必須介於 1 到 20 之間。"
        )

    fallback_name = args.get("itemName")
    fallback_price = args.get("unitPrice")

    def _write() -> dict[str, Any]:
        db = _firestore_client()
        caf_ref = (
            db.collection("schools").document(ctx.school_id)
            .collection("cafeterias").document(restaurant_id)
        )
        caf_snap = caf_ref.get()
        if not caf_snap.exists:
            raise ToolExecutionError(
                "cafeteria_not_found",
                f"找不到此餐廳：{restaurant_id}。",
            )
        caf_data = caf_snap.to_dict() or {}
        if caf_data.get("orderingEnabled") is False:
            raise ToolExecutionError(
                "cafeteria_disabled", "此餐廳目前暫停接單。"
            )

        item_name: str | None = None
        unit_price: float | None = None
        item_ref = (
            db.collection("schools").document(ctx.school_id)
            .collection("menuItems").document(item_id)
        )
        item_snap = item_ref.get()
        if item_snap.exists:
            item_data = item_snap.to_dict() or {}
            item_name = item_data.get("name")
            price = item_data.get("price")
            if isinstance(price, (int, float)):
                unit_price = float(price)
        if item_name is None and fallback_name:
            item_name = str(fallback_name)
        if unit_price is None and isinstance(fallback_price, (int, float)):
            unit_price = float(fallback_price)
        if not item_name or unit_price is None:
            raise ToolExecutionError(
                "item_not_found",
                f"找不到品項 {item_id} 的價格或名稱，請改從餐廳頁挑選。",
            )

        subtotal = round(unit_price * quantity, 2)
        tax = round(subtotal * 0.05, 2)
        total = round(subtotal + tax, 2)

        order_doc = (
            db.collection("schools").document(ctx.school_id).collection("orders").document()
        )
        user_order_doc = (
            db.collection("users").document(ctx.uid)
            .collection("schools").document(ctx.school_id)
            .collection("orders").document(order_doc.id)
        )

        payload = {
            "userId": ctx.uid,
            "schoolId": ctx.school_id,
            "source": "ai_server_agent",
            "cafeteriaId": restaurant_id,
            "merchantId": caf_data.get("merchantId") or restaurant_id,
            "cafeteria": caf_data.get("name") or restaurant_id,
            "items": [
                {
                    "menuItemId": item_id,
                    "name": item_name,
                    "price": unit_price,
                    "quantity": quantity,
                    "note": note,
                }
            ],
            "subtotal": subtotal,
            "tax": tax,
            "total": total,
            "totalAmount": total,
            "note": note,
            "paymentMethod": "campus_card",
            "status": "pending",
            "paymentStatus": "pending",
            "createdAt": _server_timestamp(),
        }

        batch = db.batch()
        batch.set(order_doc, payload)
        batch.set(user_order_doc, payload)
        batch.commit()

        return {
            "orderId": order_doc.id,
            "cafeteria": payload["cafeteria"],
            "itemName": item_name,
            "quantity": quantity,
            "unitPrice": unit_price,
            "total": total,
        }

    try:
        result = await asyncio.to_thread(_write)
    except ToolExecutionError:
        raise
    except Exception as exc:
        logger.exception("createFoodOrder write failed")
        raise ToolExecutionError("firestore_write_failed", str(exc)) from exc

    return {"success": True, **result}


# ─── Registration ────────────────────────────────────────────────────


def register_default_tools() -> None:
    """Idempotent. Called once at server startup."""
    if "createDormRepairRequest" in tool_names():
        return

    register_tool(
        name="createDormRepairRequest",
        description=(
            "幫使用者提交宿舍報修。需要 location（宿舍棟+房號的整段描述，例如「靜園 311B」）、"
            "category（water/electric/plumbing/furniture/internet/air_conditioning/lock/"
            "door_window/other）、description（壞掉的狀況）。urgency 可選 low/normal/high。"
            "成功時回 success=True 與 repairId；任何輸入錯誤或寫入失敗都會 success=False。"
        ),
        parameters={
            "type": "object",
            "properties": {
                "location": {
                    "type": "string",
                    "description": "宿舍位置，例如「靜園 311B」、「伯鐸樓 504」。",
                },
                "category": {
                    "type": "string",
                    "enum": sorted(REPAIR_CATEGORIES),
                    "description": "故障類別。",
                },
                "description": {
                    "type": "string",
                    "description": "故障狀況描述（最多 1000 字）。",
                },
                "urgency": {
                    "type": "string",
                    "enum": ["low", "normal", "high"],
                    "description": "緊急程度，預設 normal。",
                },
            },
            "required": ["location", "category", "description"],
            "additionalProperties": False,
        },
        handler=_create_dorm_repair_request,
        requires_confirmation=True,
    )

    register_tool(
        name="listMyDormRepairs",
        description=(
            "列出目前使用者最近的宿舍報修紀錄（含 repairId、location、status、createdAt）。"
            "可指定 limit（預設 10，最多 50）。永遠 success=True，items 可能為空陣列。"
        ),
        parameters={
            "type": "object",
            "properties": {
                "limit": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 50,
                    "description": "回傳幾筆，預設 10。",
                },
            },
            "additionalProperties": False,
        },
        handler=_list_my_dorm_repairs,
    )

    register_tool(
        name="createFoodOrder",
        description=(
            "幫使用者下校園餐廳訂單。需要 restaurantId（cafeteriaId）、itemId（menuItemId）、"
            "quantity。可選 note。系統會去 Firestore 取目前的菜單價格與餐廳資訊，找不到就 success=False。"
        ),
        parameters={
            "type": "object",
            "properties": {
                "restaurantId": {
                    "type": "string",
                    "description": "餐廳/餐廳 ID（cafeteriaId）。",
                },
                "itemId": {
                    "type": "string",
                    "description": "品項 ID（menuItemId）。",
                },
                "quantity": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 20,
                },
                "note": {
                    "type": "string",
                    "description": "備註，例如「少冰」。",
                },
                "itemName": {
                    "type": "string",
                    "description": "fallback 品名（當 Firestore menuItems 沒對應紀錄時使用）。",
                },
                "unitPrice": {
                    "type": "number",
                    "description": "fallback 單價（當 Firestore menuItems 沒對應紀錄時使用）。",
                },
            },
            "required": ["restaurantId", "itemId", "quantity"],
            "additionalProperties": False,
        },
        handler=_create_food_order,
        requires_confirmation=True,
    )
