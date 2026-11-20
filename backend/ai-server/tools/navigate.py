"""navigateToScreen tool — 讓 AI 可以指示前端跳轉到任意畫面。"""

from __future__ import annotations

from typing import Any

from .registry import AgentToolContext

# 所有合法的畫面路由（對應 React Navigation route name）
VALID_SCREENS = {
    "CafeteriaScreen",
    "LibraryScreen",
    "DormitoryScreen",
    "Grades",
    "CoursesHomeScreen",
    "CourseSchedule",
    "UnifiedCalendarScreen",
    "AnnouncementsScreen",
    "AttendanceScreen",
    "MapScreen",
    "ARNavigationScreen",
    "BusScheduleScreen",
    "LostFoundScreen",
    "EventsScreen",
    "HealthScreen",
    "AssignmentDetailScreen",
    "AICourseAdvisorScreen",
    "AcademicOverview",
    "AcademicInsights",
    "LearningAnalytics",
    "CreditAuditScreen",
    "MeScreen",
    "SettingsScreen",
    "GlobalSearchScreen",
    "AdminDashboardScreen",
}

NAVIGATE_TOOL_SPEC = {
    "type": "function",
    "function": {
        "name": "navigateToScreen",
        "description": (
            "當使用者想去某個 APP 功能頁面時（如餐廳、圖書館、成績、課表、地圖等），"
            "呼叫此工具告知前端要導航到哪個畫面。"
            "如果使用者說「帶我去」「我要看」「打開」等意圖，優先呼叫這個工具。"
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "screen": {
                    "type": "string",
                    "description": "目標畫面的 route name，必須是合法值之一",
                    "enum": sorted(VALID_SCREENS),
                },
                "params": {
                    "type": "object",
                    "description": "可選的導航參數，例如 {courseId: 'xxx'}",
                    "additionalProperties": True,
                },
                "reason": {
                    "type": "string",
                    "description": "簡短說明為何要去這個畫面（用於 debug）",
                },
            },
            "required": ["screen"],
        },
    },
}


async def navigate_to_screen(ctx: AgentToolContext, args: dict[str, Any]) -> dict[str, Any]:
    """此工具不執行任何後端操作，只回傳導航指令讓前端執行。"""
    screen = str(args.get("screen") or "").strip()
    if screen not in VALID_SCREENS:
        return {
            "success": False,
            "errorCode": "invalid_screen",
            "errorMessage": f"畫面 '{screen}' 不存在或尚未支援",
        }
    return {
        "success": True,
        "action": "navigate",
        "screen": screen,
        "params": args.get("params") or {},
        "reason": args.get("reason") or "",
    }

