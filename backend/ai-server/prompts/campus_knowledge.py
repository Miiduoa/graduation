"""Static campus knowledge extracted from APP source code.

This module provides structured descriptions of every screen, navigation path,
and data model so the LLM understands the APP deeply.
"""

SCREEN_KNOWLEDGE: dict[str, dict] = {
    "HomeScreen": {
        "path": "Today > 首頁",
        "description": "今日儀表板，顯示待辦事項、近期公告、下一堂課、快速入口",
        "actions": ["查看公告", "查看活動", "開啟 AI 助理"],
    },
    "AIChatScreen": {
        "path": "Today > AI 助理",
        "description": "與校園智慧助理對話，支援查詢公告/課程/餐廳、學業分析、選課建議",
        "actions": ["文字對話", "快捷指令", "清除對話記錄"],
    },
    "CourseScheduleScreen": {
        "path": "課程 > 課表",
        "description": "顯示本學期課表，依日期/週檢視，可點擊課程查看詳情",
        "actions": ["檢視課表", "切換週次", "點擊查看課程詳情"],
    },
    "CoursesHomeScreen": {
        "path": "課程 > 課程首頁",
        "description": "課程管理首頁，列出所有修課，支援搜尋和篩選",
        "actions": ["搜尋課程", "篩選", "查看課程詳情"],
    },
    "CourseHubScreen": {
        "path": "課程 > 課程中樞",
        "description": "單一課程的完整資訊中樞，含教材、作業、測驗、成績、出席",
        "actions": ["查看教材", "繳交作業", "參加測驗", "查看成績"],
    },
    "GradesScreen": {
        "path": "課程 > 成績",
        "description": "檢視各科成績與 GPA 計算，支援學期篩選",
        "actions": ["查看各科成績", "查看 GPA", "切換學期"],
    },
    "CreditAuditScreen": {
        "path": "課程 > 學分試算",
        "description": "畢業學分試算工具，分析已修/未修學分，提供選課建議",
        "actions": ["查看學分進度", "分析畢業需求", "獲取選課建議"],
    },
    "AddCourseScreen": {
        "path": "課程 > 加選課程",
        "description": "搜尋並加選課程，可查看課程大綱和評價",
        "actions": ["搜尋課程", "查看大綱", "加選"],
    },
    "MapScreen": {
        "path": "校園 > 地圖",
        "description": "校園互動式地圖，顯示建築物、設施、即時人潮",
        "actions": ["搜尋地點", "查看路線", "檢視人潮"],
    },
    "CafeteriaScreen": {
        "path": "校園 > 餐廳",
        "description": "列出校園所有餐廳，含營業時間、等候人數、評分",
        "actions": ["查看餐廳列表", "查看菜單", "線上點餐"],
    },
    "MenuDetailScreen": {
        "path": "校園 > 菜單詳情",
        "description": "餐廳菜單詳細資訊，含價格、圖片、營養資訊、評價",
        "actions": ["查看餐點", "加入訂單", "查看評價"],
    },
    "LibraryScreen": {
        "path": "校園 > 圖書館",
        "description": "圖書館服務：查書、借閱紀錄、座位預約",
        "actions": ["搜尋書籍", "預約座位", "查看借閱記錄"],
    },
    "BusScheduleScreen": {
        "path": "校園 > 公車",
        "description": "校園公車時刻表與即時到站資訊",
        "actions": ["查看時刻表", "查看即時到站", "設定到站提醒"],
    },
    "AnnouncementsScreen": {
        "path": "Today > 公告",
        "description": "學校公告列表，支援分類篩選和搜尋，含 AI 摘要",
        "actions": ["瀏覽公告", "篩選分類", "AI 摘要"],
    },
    "EventsScreen": {
        "path": "Today > 活動",
        "description": "校園活動列表，含報名功能和行事曆整合",
        "actions": ["瀏覽活動", "報名", "加入行事曆"],
    },
    "GroupsScreen": {
        "path": "訊息 > 群組",
        "description": "課程群組和興趣群組列表",
        "actions": ["加入群組", "建立群組", "查看群組動態"],
    },
    "ChatScreen": {
        "path": "訊息 > 對話",
        "description": "一對一或群組對話視窗",
        "actions": ["發送訊息", "傳送檔案", "查看成員"],
    },
    "ProfileScreen": {
        "path": "我的 > 個人資料",
        "description": "個人資料檢視與編輯",
        "actions": ["編輯資料", "更換頭像", "查看成就"],
    },
    "SettingsScreen": {
        "path": "我的 > 設定",
        "description": "APP 設定：通知、語言、主題、無障礙",
        "actions": ["通知設定", "語言切換", "主題切換", "無障礙設定"],
    },
    "HealthScreen": {
        "path": "校園 > 健康中心",
        "description": "健康中心預約掛號和健康紀錄",
        "actions": ["預約掛號", "查看紀錄", "查看可用時段"],
    },
    "DormitoryScreen": {
        "path": "校園 > 宿舍",
        "description": "宿舍服務：報修、包裹領取、洗衣機狀態",
        "actions": ["申請報修", "查看包裹", "查看洗衣機"],
    },
    "LostFoundScreen": {
        "path": "校園 > 失物招領",
        "description": "失物招領公告板，可張貼或搜尋遺失物品",
        "actions": ["張貼失物", "搜尋物品", "聯繫失主"],
    },
    "AchievementsScreen": {
        "path": "我的 > 成就",
        "description": "校園成就徽章系統，鼓勵參與校園活動",
        "actions": ["查看已解鎖成就", "查看成就進度"],
    },
    "AICourseAdvisorScreen": {
        "path": "課程 > AI 選課助理",
        "description": "AI 驅動的選課建議，根據學分需求和興趣推薦課程",
        "actions": ["獲取選課建議", "分析學分需求", "比較課程"],
    },
}


def get_full_knowledge_text() -> str:
    """Produce a compact textual summary of all screens for system prompts."""
    lines: list[str] = []
    for name, info in SCREEN_KNOWLEDGE.items():
        actions_str = "、".join(info["actions"])
        lines.append(f"• {info['path']}（{name}）：{info['description']}。可用操作：{actions_str}")
    return "\n".join(lines)
