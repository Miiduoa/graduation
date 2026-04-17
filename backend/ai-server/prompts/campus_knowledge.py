"""Static campus knowledge extracted from APP source code.

This module provides structured descriptions of every screen, navigation path,
data model, and real campus data so the LLM understands the APP deeply.
"""

# ─── Screen Knowledge ────────────────────────────────────────────────

SCREEN_KNOWLEDGE: dict[str, dict] = {
    "HomeScreen": {
        "path": "Today > 首頁",
        "description": "今日儀表板，顯示待辦事項、近期公告、下一堂課、快速入口",
        "actions": ["查看公告", "查看活動", "開啟 AI 助理"],
        "guide": "打開 APP 就是這個畫面，上方有今日課程時間軸",
    },
    "AIChatScreen": {
        "path": "Today > AI 助理",
        "description": "與校園智慧助理對話，支援查詢公告/課程/餐廳、學業分析、選課建議",
        "actions": ["文字對話", "快捷指令", "清除對話記錄"],
        "guide": "首頁右下角的 AI 助理按鈕，或首頁快速入口",
    },
    "CourseScheduleScreen": {
        "path": "課程 > 課表",
        "description": "顯示本學期課表，依日期/週檢視，可點擊課程查看詳情",
        "actions": ["檢視課表", "切換週次", "點擊查看課程詳情"],
        "guide": "底部選單「課程」→ 上方「課表」分頁",
    },
    "CoursesHomeScreen": {
        "path": "課程 > 課程首頁",
        "description": "課程管理首頁，列出所有修課，支援搜尋和篩選",
        "actions": ["搜尋課程", "篩選", "查看課程詳情"],
        "guide": "底部選單「課程」→ 預設就是此畫面",
    },
    "CourseHubScreen": {
        "path": "課程 > 課程中樞",
        "description": "單一課程的完整資訊中樞，含教材、作業、測驗、成績、出席",
        "actions": ["查看教材", "繳交作業", "參加測驗", "查看成績"],
        "guide": "課程首頁或課表中，點擊任何一門課就會進入",
    },
    "GradesScreen": {
        "path": "課程 > 成績",
        "description": "檢視各科成績與 GPA 計算，支援學期篩選",
        "actions": ["查看各科成績", "查看 GPA", "切換學期"],
        "guide": "底部選單「課程」→ 上方「成績」分頁",
    },
    "CreditAuditScreen": {
        "path": "課程 > 學分試算",
        "description": "畢業學分試算工具，分析已修/未修學分，提供選課建議",
        "actions": ["查看學分進度", "分析畢業需求", "獲取選課建議"],
        "guide": "底部選單「課程」→ 右上角「學分試算」按鈕",
    },
    "AddCourseScreen": {
        "path": "課程 > 加選課程",
        "description": "搜尋並加選課程，可查看課程大綱和評價",
        "actions": ["搜尋課程", "查看大綱", "加選"],
        "guide": "課程首頁右上角的「+」按鈕",
    },
    "CafeteriaScreen": {
        "path": "校園 > 餐廳",
        "description": "列出校園所有餐廳與菜單，含營業時間、篩選搜尋",
        "actions": ["查看餐廳列表", "搜尋餐點", "依餐廳篩選", "查看菜單"],
        "guide": "底部選單「校園」→「餐廳」，或首頁快速入口的餐廳圖示",
    },
    "MenuDetailScreen": {
        "path": "校園 > 菜單詳情",
        "description": "餐廳菜單詳細資訊，含價格、圖片、營養資訊、評價",
        "actions": ["查看餐點", "加入訂單", "查看評價"],
        "guide": "餐廳頁面中，點擊任何一個餐點即可進入",
    },
    "MapScreen": {
        "path": "校園 > 地圖",
        "description": "校園互動式地圖，顯示建築物、設施、即時人潮",
        "actions": ["搜尋地點", "查看路線", "檢視人潮"],
        "guide": "底部選單「校園」→「地圖」",
    },
    "LibraryScreen": {
        "path": "校園 > 圖書館",
        "description": "圖書館服務：查書、借閱紀錄、座位預約",
        "actions": ["搜尋書籍", "預約座位", "查看借閱記錄"],
        "guide": "底部選單「校園」→「圖書館」，或首頁快速入口",
    },
    "BusScheduleScreen": {
        "path": "校園 > 公車",
        "description": "校園公車時刻表與即時到站資訊",
        "actions": ["查看時刻表", "查看即時到站", "設定到站提醒"],
        "guide": "底部選單「校園」→「公車」，或首頁快速入口",
    },
    "AnnouncementsScreen": {
        "path": "Today > 公告",
        "description": "學校公告列表，支援分類篩選和搜尋，含 AI 摘要",
        "actions": ["瀏覽公告", "篩選分類", "AI 摘要"],
        "guide": "首頁的「公告」區塊，點「查看更多」進入完整列表",
    },
    "EventsScreen": {
        "path": "Today > 活動",
        "description": "校園活動列表，含報名功能和行事曆整合",
        "actions": ["瀏覽活動", "報名", "加入行事曆"],
        "guide": "首頁的「活動」區塊，點「查看更多」進入完整列表",
    },
    "GroupsScreen": {
        "path": "訊息 > 群組",
        "description": "課程群組和興趣群組列表",
        "actions": ["加入群組", "建立群組", "查看群組動態"],
        "guide": "底部選單「訊息」→ 預設是群組列表",
    },
    "ChatScreen": {
        "path": "訊息 > 對話",
        "description": "一對一或群組對話視窗",
        "actions": ["發送訊息", "傳送檔案", "查看成員"],
        "guide": "訊息列表中，點擊任何對話就會進入",
    },
    "ProfileScreen": {
        "path": "我的 > 個人資料",
        "description": "個人資料檢視與編輯",
        "actions": ["編輯資料", "更換頭像", "查看成就"],
        "guide": "底部選單「我的」→ 最上方個人資料卡",
    },
    "SettingsScreen": {
        "path": "我的 > 設定",
        "description": "APP 設定：通知、語言、主題、無障礙",
        "actions": ["通知設定", "語言切換", "主題切換", "無障礙設定"],
        "guide": "底部選單「我的」→「設定」",
    },
    "HealthScreen": {
        "path": "校園 > 健康中心",
        "description": "健康中心預約掛號和健康紀錄",
        "actions": ["預約掛號", "查看紀錄", "查看可用時段"],
        "guide": "底部選單「校園」→「健康中心」",
    },
    "DormitoryScreen": {
        "path": "校園 > 宿舍",
        "description": "宿舍服務：報修、包裹領取、洗衣機狀態",
        "actions": ["申請報修", "查看包裹", "查看洗衣機"],
        "guide": "底部選單「校園」→「宿舍」",
    },
    "LostFoundScreen": {
        "path": "校園 > 失物招領",
        "description": "失物招領公告板，可張貼或搜尋遺失物品",
        "actions": ["張貼失物", "搜尋物品", "聯繫失主"],
        "guide": "底部選單「校園」→「失物招領」",
    },
    "AchievementsScreen": {
        "path": "我的 > 成就",
        "description": "校園成就徽章系統，鼓勵參與校園活動",
        "actions": ["查看已解鎖成就", "查看成就進度"],
        "guide": "底部選單「我的」→「成就」",
    },
    "AICourseAdvisorScreen": {
        "path": "課程 > AI 選課助理",
        "description": "AI 驅動的選課建議，根據學分需求和興趣推薦課程",
        "actions": ["獲取選課建議", "分析學分需求", "比較課程"],
        "guide": "課程首頁中的「AI 選課助理」入口",
    },
}

# ─── 靜宜大學 (Providence University) 校園資料 ─────────────────────

PU_CAMPUS_INFO = """
靜宜大學位於台中市沙鹿區，主要建築物包括：
• 蓋夏圖書館 — 學校圖書館，旁邊有 OK 便利商店
• 主顧樓 — 管理學院
• 任垣樓 — 旁邊有宜園餐廳
• 伯鐸樓 — 文學院
• 靜安樓 — 學生宿舍區
• 格倫樓 — 理學院
• 方濟樓 — 外語學院
• 思源樓 — 資訊學院
• 至善樓 — 一樓和二樓都有美食廣場
• 文興樓 — 對面是靜園餐廳
• 體育館 — 旁邊有小木屋鬆餅
• 主顧聖母堂 — 校內教堂
• 行政中心
• 第一研究大樓
"""

PU_DINING_INFO = """
靜宜大學校內共有 6 個餐飲據點（資料來源：總務處事務組 114 學年度第二學期公告）：

1. 靜園餐廳（文興樓對面）
   營業：週一至週五 06:30-19:00；週六部分營業；週日不營業
   櫃位：白鬍子飲料店（飲料/水果杯）、Morning House（吐司/蛋餅/鐵板麵）、
         狠犟炸牛排（炸牛排/雞腿排，清真友善）、川福美食（酸辣粉/螺獅粉）、
         小林自助餐（自助餐/素食自助餐）、樂亭輕食（自選餐盒，清真友善）、
         湯才滷味（各式滷味）、極壽喜燒（壽喜燒飯盒/鍋貼/蒸餃）、
         極咖哩（咖哩飯/水煮餐/麻醬麵，方便素）、左撇子（炒飯/炒泡麵/鍋燒麵）、
         酸菜魚（酸菜魚料理）、荳子車輪餅、遇見雞蛋糕

2. 宜園餐廳（任垣樓旁）
   營業：週一至週五 06:00-19:30；週日不營業
   櫃位：吉品自助餐（B1自助餐）、早安山丘（早餐）、永和豆漿（蛋餅/豆漿）、
         宜園小廚（家常餐）、四海遊龍（鍋貼）、王者香蘭花繡茶（茶飲）、
         炸雞大獅（炸雞）、咖喱大叔（咖喱飯）

3. 至善美食廣場一樓（至善樓 1 樓）
   營業：週一至週日 06:00-23:00
   櫃位：YAMI快餐（便當）、馨饌坊（簡餐）、拉亞漢堡（漢堡/早餐）、
         全家便利商店（鮮食便當）、好吃鮮果（鮮切水果）、禾豐家飯捲（飯捲）、
         驖人拉麵（拉麵）

4. 至善美食廣場二樓（至善樓 2 樓）
   營業：114 學年度第二學期起全部營業
   櫃位：路易莎咖啡（咖啡/輕食三明治）

5. 小木屋鬆餅（體育館旁）
   營業：平日 10:30-19:30；假日 11:30-17:00
   品項：招牌鬆餅、冰淇淋鬆餅

6. OK 便利商店（蓋夏圖書館旁）
   營業：週一至週五 07:00-21:00；週末不營業
   品項：便當、茶葉蛋等鮮食

素食選項：小林自助餐的素食餐檯、樂亭輕食自選餐盒、極咖哩的咖哩飯/麻醬麵（方便素）、左撇子的蛋炒飯/原味炒泡麵
清真友善：狠犟炸牛排、樂亭輕食
"""


def get_full_knowledge_text() -> str:
    """Produce a compact textual summary for system prompts."""
    lines: list[str] = ["【APP 功能與操作指南】"]
    for name, info in SCREEN_KNOWLEDGE.items():
        actions_str = "、".join(info["actions"])
        guide = info.get("guide", "")
        lines.append(
            f"• {info['path']}（{name}）：{info['description']}。"
            f"操作：{actions_str}。"
            + (f"入口：{guide}" if guide else "")
        )

    lines.append("")
    lines.append("【靜宜大學校園建築】")
    lines.append(PU_CAMPUS_INFO.strip())
    lines.append("")
    lines.append("【靜宜大學餐廳完整資訊】")
    lines.append(PU_DINING_INFO.strip())

    return "\n".join(lines)
