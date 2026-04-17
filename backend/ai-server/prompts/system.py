"""System prompt templates for the Campus AI assistant."""

from __future__ import annotations
from datetime import datetime

DAY_NAMES = ["週一", "週二", "週三", "週四", "週五", "週六", "週日"]


def build_system_prompt(
    *,
    campus_knowledge: str = "",
    rag_context: str = "",
    user_context: dict | None = None,
    school_id: str = "unknown",
) -> str:
    now = datetime.now()
    day_name = DAY_NAMES[now.weekday()]
    date_str = now.strftime("%Y/%m/%d %H:%M")

    parts: list[str] = [
        "你是「校園智慧助理」，一個深度了解校園 APP 每個功能的 AI。",
        "你的回答必須具體、可操作、基於真實數據。不要編造不存在的資訊。",
        "",
        "【你的身份】",
        "- 你就是這個 APP 內建的 AI 助理，使用者正在 APP 裡跟你對話",
        "- 你可以引導使用者去 APP 的任何畫面完成操作",
        "- 你熟悉這個 APP 的每個按鈕、每個畫面、每個功能",
        "",
        "【回答規則 — 嚴格遵守】",
        "1. 使用繁體中文，語氣友善簡潔",
        "2. 回答必須基於下方提供的【即時資料】和【校園知識庫】",
        "3. 如果資料中沒有相關資訊，明確說「目前 APP 中沒有這筆資料」",
        "4. 當使用者問到某個功能時，告訴他具體的操作路徑（例如：「你可以到底部選單的『校園』→『餐廳』查看」）",
        "5. 列舉時用條列式，資訊要具體（餐廳名稱、位置、營業時間、櫃位名）",
        "6. 不要說「根據我的資料」之類的話，直接回答就好",
        "7. 回答結尾加「建議選項：」列出 1-3 個 2-6 字的後續選項",
        "",
        "【APP 底部選單結構】",
        "五個分頁：Today（首頁）→ 課程 → 校園 → 訊息 → 我的",
        "",
        f"【現在時間】{day_name} {date_str}",
        f"【學校】{school_id}",
    ]

    # ─── Real-time user data from APP ─────────────────────────────

    if user_context:
        if user_context.get("userName"):
            parts.append(f"\n【使用者】{user_context['userName']}")

        announcements = user_context.get("announcements", [])
        if announcements:
            parts.append("\n【最新公告（APP 即時資料）】")
            for a in announcements[:5]:
                src = f"（{a['source']}）" if a.get("source") else ""
                parts.append(f"• {a.get('title', '未知')}{src}")

        events = user_context.get("events", [])
        if events:
            parts.append("\n【近期活動（APP 即時資料）】")
            for e in events[:5]:
                loc = f"，地點：{e['location']}" if e.get("location") else ""
                time = f"，時間：{e['startsAt']}" if e.get("startsAt") else ""
                parts.append(f"• {e.get('title', '未知')}{loc}{time}")

        menus = user_context.get("menus", [])
        if menus:
            parts.append("\n【今日餐點（APP 即時資料）】")
            for m in menus[:10]:
                price = f" ${m['price']}" if m.get("price") else ""
                caf = f"（{m['cafeteria']}）" if m.get("cafeteria") else ""
                parts.append(f"• {m.get('name', '未知')}{caf}{price}")

        pois = user_context.get("pois", [])
        if pois:
            parts.append("\n【校園地點（APP 即時資料）】")
            for p in pois[:10]:
                cat = f"[{p['category']}]" if p.get("category") else ""
                parts.append(f"• {p.get('name', '未知')} {cat}")

        courses = user_context.get("courses", [])
        if courses:
            parts.append("\n【你的課程】")
            for i, c in enumerate(courses[:15], 1):
                dow = DAY_NAMES[c["dayOfWeek"] - 1] if c.get("dayOfWeek") else "未知"
                line = f"{i}. {c.get('name', '未知')}（{dow} 第{c.get('startPeriod', '?')}節"
                if c.get("teacher"):
                    line += f"，{c['teacher']}"
                if c.get("credits"):
                    line += f"，{c['credits']}學分"
                line += "）"
                parts.append(line)

        assignments = user_context.get("pendingAssignments", [])
        if assignments:
            parts.append("\n【待繳作業】")
            for i, a in enumerate(assignments[:8], 1):
                due = a.get("dueAt", "無截止日")
                late = " ⚠️已逾期" if a.get("isLate") else ""
                parts.append(f"{i}. {a.get('title', '?')}（{a.get('groupName', '')}，截止：{due}{late}）")

        grades = user_context.get("gradesSummary")
        if grades:
            parts.append("\n【成績概況】")
            if grades.get("gpa"):
                parts.append(f"GPA：{grades['gpa']:.2f}")

        weekly = user_context.get("weeklyReport")
        if weekly and weekly.get("summary"):
            parts.append(f"\n【本週摘要】{weekly['summary']}")
            stats = weekly.get("stats", {})
            if stats:
                parts.append(f"準時率：{stats.get('onTimeRate', 100)}%，繳交數：{stats.get('totalSubmissions', 0)}")

    # ─── Static knowledge ────────────────────────────────────────

    if campus_knowledge:
        parts.append(f"\n{campus_knowledge}")

    if rag_context:
        parts.append("\n【相關參考資料（即時檢索）】")
        parts.append(rag_context)

    return "\n".join(parts)
