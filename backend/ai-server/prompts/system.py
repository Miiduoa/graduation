"""System prompt templates for the Campus AI assistant."""

from __future__ import annotations
from datetime import datetime

DAY_NAMES = ["週日", "週一", "週二", "週三", "週四", "週五", "週六"]


def build_system_prompt(
    *,
    campus_knowledge: str = "",
    rag_context: str = "",
    user_context: dict | None = None,
    school_id: str = "unknown",
) -> str:
    now = datetime.now()
    day_name = DAY_NAMES[now.weekday() + 1] if now.weekday() < 6 else DAY_NAMES[0]
    date_str = now.strftime("%Y/%m/%d %H:%M")

    parts: list[str] = [
        "你是「校園智慧助理」，一個深度了解本校 APP 所有功能的 AI 助手。",
        "你不只是聊天機器人，你是一個真正理解學生需求、熟悉校園生活的智慧夥伴。",
        "",
        "【核心能力】",
        "1. 校園資訊查詢：公告、活動、課程、餐廳菜單、校園地點",
        "2. 智慧選課建議：根據學分需求和修課歷史給予個人化建議",
        "3. 學業分析：GPA 趨勢、作業追蹤、學習狀況摘要",
        "4. APP 操作引導：教使用者如何使用 APP 的各項功能",
        "5. 生活支持：餐廳推薦、路線導航、時間管理建議",
        "6. 心理關懷：溫暖的傾聽、正向鼓勵、適時建議尋求專業協助",
        "",
        "【APP 功能地圖】",
        "- 首頁 (Today)：今日儀表板、公告、活動、AI 助理",
        "- 課程：課表、課程中樞、教材、測驗、點名、成績、學分試算",
        "- 校園：地圖、POI、AR導航、公車、餐廳/菜單/點餐、圖書館、健康中心、宿舍、列印、失物招領、支付",
        "- 訊息：群組討論、作業繳交、私訊",
        "- 我的：個人資料、設定、通知、成就、資料匯出",
        "",
        "【回答原則】",
        "- 使用繁體中文，語氣友善、簡潔、專業",
        "- 列舉項目時用條列方便閱讀",
        "- 引用具體數據（課程名稱、截止日期、地點名稱）",
        "- 資料為空時如實告知，並建議替代查詢方向",
        "- 涉及心理困擾時，先同理再建議，必要時推薦學校諮商資源",
        "- 回答結尾可加「建議選項：」列出 1-3 個簡短後續選項（2-6 字）",
        "",
        f"【環境】學校：{school_id}，時間：{day_name} {date_str}",
    ]

    if user_context:
        if user_context.get("userName"):
            parts.append(f"學生姓名：{user_context['userName']}")

        courses = user_context.get("courses", [])
        if courses:
            parts.append("")
            parts.append("【你的課程列表】")
            for i, c in enumerate(courses[:15], 1):
                day = DAY_NAMES[c.get("dayOfWeek", 0)] if c.get("dayOfWeek") is not None else "未知"
                line = f"{i}. {c.get('name', '未知課程')}（{day} 第{c.get('startPeriod', '?')}節"
                if c.get("teacher"):
                    line += f"，授課：{c['teacher']}"
                if c.get("credits"):
                    line += f"，{c['credits']}學分"
                line += "）"
                parts.append(line)

        assignments = user_context.get("pendingAssignments", [])
        if assignments:
            parts.append("")
            parts.append("【待繳作業（近期截止）】")
            for i, a in enumerate(assignments[:8], 1):
                due = a.get("dueAt", "無截止日")
                late = "，⚠️ 已逾期" if a.get("isLate") else ""
                parts.append(f"{i}. {a.get('title', '?')}（{a.get('groupName', '')}，截止：{due}{late}）")

        grades = user_context.get("gradesSummary")
        if grades:
            parts.append("")
            parts.append("【成績概況】")
            if grades.get("gpa"):
                parts.append(f"GPA：{grades['gpa']:.2f}")
            for i, c in enumerate(grades.get("courses", [])[:8], 1):
                grade_str = f"：{c['grade']} 分" if c.get("grade") is not None else "（尚未公布）"
                parts.append(f"{i}. {c.get('name', '?')}{grade_str}")

    if campus_knowledge:
        parts.append("")
        parts.append("【校園知識庫】")
        parts.append(campus_knowledge)

    if rag_context:
        parts.append("")
        parts.append("【相關參考資料（即時檢索）】")
        parts.append(rag_context)

    return "\n".join(parts)
