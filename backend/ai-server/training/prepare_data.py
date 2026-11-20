"""Generate instruction-following training data from APP source code and demo data.

Produces JSONL in either:

- Alpaca: ``{instruction, input?, output}``（單輪問答）
- 代理軌跡: ``{messages:[{role,content},...]}``（多輪；含 ``[EXECUTE:tool:{args}]`` 與 ``[TOOL_RESULT]``）

訓練目標讓模型學會：**何時查資料、如何選工具、如何依工具結果用繁中總結**，並與 App 端 ``parseExecuteCommands`` 格式對齊。
"""

from __future__ import annotations

import json
import logging
import random
import re
from pathlib import Path

from config import TRAINING_DIR, APP_SRC_ROOT
from prompts.campus_knowledge import SCREEN_KNOWLEDGE

logger = logging.getLogger(__name__)

OUTPUT_PATH = TRAINING_DIR / "campus_instruct.jsonl"


def _fingerprint_training_record(record: dict) -> str:
    """完全相同內容的樣本視為重複（Alpaca 與 messages 分開規範化）。"""
    raw_msgs = record.get("messages")
    if isinstance(raw_msgs, list):
        normalized = [
            {"role": str(m.get("role", "")), "content": str(m.get("content", ""))}
            for m in raw_msgs
            if isinstance(m, dict)
        ]
        return json.dumps({"messages": normalized}, ensure_ascii=False)

    return json.dumps(
        {
            "instruction": str(record.get("instruction", "")).strip(),
            "input": str(record.get("input", "") or "").strip(),
            "output": str(record.get("output", "")).strip(),
        },
        ensure_ascii=False,
        sort_keys=True,
    )


def dedupe_training_records(records: list[dict]) -> list[dict]:
    """保留首次出現順序，移除指紋相同的列。"""
    seen: set[str] = set()
    unique: list[dict] = []
    for row in records:
        fp = _fingerprint_training_record(row)
        if fp in seen:
            continue
        seen.add(fp)
        unique.append(row)
    return unique


def _instruction_bucket_key(text: str, prefix_chars: int = 14) -> str:
    """移除標點與空白後取字首，用於稀疏化「開頭很像」的問句。"""
    collapsed = re.sub(
        r'[\s？?！!,，.。、；;：“”「」『』（）()\[\]<>《》]',
        "",
        text.casefold(),
    )
    if not collapsed:
        return text[:prefix_chars]
    return collapsed[:prefix_chars] if len(collapsed) >= prefix_chars else collapsed


def thin_similar_alpaca_instructions(
    records: list[dict],
    *,
    max_per_bucket: int = 5,
    bucket_chars: int = 14,
) -> list[dict]:
    """Alpaca 列：同一『句首桶』最多保留 max_per_bucket 條，避免語料過度集中於相似問法。"""
    agent_rows = [r for r in records if isinstance(r.get("messages"), list)]
    alpaca_rows = [r for r in records if not isinstance(r.get("messages"), list)]
    random.shuffle(alpaca_rows)
    counts: dict[str, int] = {}
    kept_alpaca: list[dict] = []
    for r in alpaca_rows:
        ins = str(r.get("instruction", "")).strip()
        bk = _instruction_bucket_key(ins, bucket_chars)
        if counts.get(bk, 0) >= max_per_bucket:
            continue
        counts[bk] = counts.get(bk, 0) + 1
        kept_alpaca.append(r)
    dropped = len(alpaca_rows) - len(kept_alpaca)
    if dropped:
        logger.info(
            "Thinned %d Alpaca rows in similar instruction buckets (kept %d)",
            dropped,
            len(kept_alpaca),
        )
    return agent_rows + kept_alpaca


# 每個畫面最多收錄幾條（避免同一類 navigation QA 塞滿資料集）
SCREEN_QA_MAX_PAIRS_PER_SCREEN = 12
# 同一個 action 最多抽幾種問法模板（其餘模板不放進該 action）
SCREEN_QA_TEMPLATE_SAMPLES_PER_ACTION = 2


def _screen_qa_pairs() -> list[dict]:
    """從 SCREEN_KNOWLEDGE 採樣：句型多元、每畫面有上限，降低『相似問句』比重。"""
    pairs: list[dict] = []

    question_templates = [
        ("我要怎麼{action}？", "你可以前往「{path}」（{name}）進行{action}。\n\n{desc}\n\n可用操作：{all_actions}"),
        ("{name_zh}在哪裡？", "「{name_zh}」位於「{path}」。\n\n{desc}\n\n建議選項：{suggest}"),
        ("APP 有什麼功能可以{action}？", "你可以使用「{path}」的功能。\n\n{desc}\n\n除了{action}之外，還可以：{other_actions}"),
        ("教我怎麼使用{name_zh}", "好的！{name_zh}的使用方式如下：\n\n📍 位置：{path}\n📝 功能：{desc}\n\n你可以進行以下操作：\n{numbered_actions}\n\n建議選項：試試看、更多功能"),
        ("「{action}」要去哪個頁面？", "可以到「{path}」（{name}）。\n\n{desc}\n\n這裡預設能做的操作：{all_actions}"),
        ("找不到{name_zh}，入口在哪？", "你可以從「{path}」進入「{name_zh}」。\n\n{desc}\n\n建議先試：{suggest}"),
        ("想用{name_zh}做{action}可以嗎？", "可以。{name_zh}在「{path}」，描述如下：\n\n{desc}\n\n相關操作：{all_actions}"),
        ("說明一下{name_zh}是做什麼的", "「{name_zh}」的路徑是「{path}」。\n\n{desc}\n\n可用操作：{numbered_actions}"),
    ]

    for screen_name, info in SCREEN_KNOWLEDGE.items():
        name_zh = info["path"].split(" > ")[-1]
        actions = info["actions"]
        desc = info["description"]
        path = info["path"]

        candidates: list[dict] = []

        for action in actions:
            other = [a for a in actions if a != action]
            numbered = "\n".join(f"{i}. {a}" for i, a in enumerate(actions, 1))
            suggest = "、".join(actions[:3])

            tpl_list = list(question_templates)
            random.shuffle(tpl_list)
            chosen_tpls = tpl_list[: min(SCREEN_QA_TEMPLATE_SAMPLES_PER_ACTION, len(tpl_list))]

            for q_template, a_template in chosen_tpls:
                try:
                    question = q_template.format(
                        action=action,
                        name=screen_name,
                        name_zh=name_zh,
                        path=path,
                        desc=desc,
                    )
                    answer = a_template.format(
                        action=action,
                        name=screen_name,
                        name_zh=name_zh,
                        path=path,
                        desc=desc,
                        all_actions="、".join(actions),
                        other_actions="、".join(other) if other else "這已經是全部操作",
                        numbered_actions=numbered,
                        suggest=suggest,
                    )
                    candidates.append({"instruction": question, "input": "", "output": answer})
                except KeyError:
                    continue

        random.shuffle(candidates)
        pairs.extend(candidates[:SCREEN_QA_MAX_PAIRS_PER_SCREEN])

    return pairs


def _campus_scenario_pairs() -> list[dict]:
    """Generate scenario-based QA pairs for campus life."""
    scenarios = [
        {
            "instruction": "我快遲到了，下一堂課在哪裡？",
            "input": "[Context] 使用者下一堂課: 資料結構，教室：資訊大樓 302",
            "output": "你的下一堂課「資料結構」在資訊大樓 302 教室。\n\n建議你可以在 APP 的地圖功能中搜尋「資訊大樓」，開啟導航功能幫你找到最快的路線。\n\n建議選項：開啟導航、查看課表",
        },
        {
            "instruction": "今天午餐吃什麼好？",
            "input": "[Context] 校園餐廳: 學生餐廳(紅燒牛肉麵$85,雞腿便當$75), 素食餐廳(蔬菜咖哩$65)",
            "output": "看看今天有什麼好選擇：\n\n1. 🍜 **紅燒牛肉麵** - $85（學生餐廳）\n2. 🍗 **雞腿便當** - $75（學生餐廳）\n3. 🥬 **蔬菜咖哩** - $65（素食餐廳）\n\n如果想吃得豐盛一點，推薦紅燒牛肉麵；想省錢可以試試蔬菜咖哩！\n\n建議選項：更多餐點、查看評價、線上點餐",
        },
        {
            "instruction": "我這學期 GPA 好像不太好，怎麼辦？",
            "input": "[Context] GPA: 2.8, 最低科: 微積分(60分), 最高科: 程式設計(92分)",
            "output": "我看到你這學期的 GPA 是 2.8，讓我幫你分析一下：\n\n📊 **成績概況**\n- 最高分：程式設計 92 分 👏\n- 需加強：微積分 60 分\n\n📋 **具體建議**\n1. **微積分**是拉低 GPA 的主因，建議找同學組讀書會或到課業輔導中心求助\n2. 你的程式設計很強，可以用這個優勢去輔助學習\n3. 到「學分試算」功能查看畢業學分進度\n\n別灰心！GPA 2.8 還有很大的進步空間，一步一步來就好。如果課業壓力太大，學校諮商中心也能幫助你 💪\n\n建議選項：學分試算、查看成績、學習建議",
        },
        {
            "instruction": "我想退選一門課，怎麼做？",
            "input": "",
            "output": "退選課程的步驟如下：\n\n1. 前往 APP 的「課程」分頁\n2. 在「課程首頁」找到你想退選的課程\n3. 點擊進入課程詳情\n4. 查看退選截止日期（通常在學期第 2-3 週）\n\n⚠️ **注意事項**：\n- 退選前請先到「學分試算」確認退選後是否仍滿足畢業學分需求\n- 退選有截止日期，過期無法退選\n- 建議先與授課教師或系辦討論\n\n建議選項：查看課表、學分試算、聯繫系辦",
        },
        {
            "instruction": "圖書館的座位還有空位嗎？",
            "input": "",
            "output": "你可以在 APP 中查看圖書館座位狀態：\n\n1. 前往「校園」分頁\n2. 點擊「圖書館」\n3. 查看各樓層的即時座位狀態\n4. 如果有空位，可以直接「預約座位」\n\n💡 小提示：考試周期間座位會比較緊張，建議提早預約！\n\n建議選項：預約座位、查看地圖、搜尋書籍",
        },
        {
            "instruction": "最近有什麼有趣的活動可以參加？",
            "input": "[Context] 近期活動: 程式設計競賽(4/20), 校慶園遊會(4/25), 職涯講座(4/22)",
            "output": "最近有幾個不錯的活動：\n\n1. 💻 **程式設計競賽** - 4/20\n   適合有程式基礎的同學，可以挑戰自我！\n\n2. 🎪 **校慶園遊會** - 4/25\n   校慶盛會，有各種攤位和表演\n\n3. 👔 **職涯講座** - 4/22\n   對未來職涯規劃有幫助\n\n想報名哪一個？我可以幫你直接前往報名頁面！\n\n建議選項：報名活動、加入行事曆、更多活動",
        },
        {
            "instruction": "我最近壓力好大，不知道該怎麼辦",
            "input": "",
            "output": "聽到你壓力很大，先別擔心，這是很正常的感受 🤗\n\n讓我分享一些可能有幫助的方向：\n\n1. **短期紓壓**\n   - 到校園散散步，呼吸新鮮空氣\n   - 找信任的朋友聊聊\n   - 用 APP 的行事曆功能整理待辦事項，把大任務拆成小步驟\n\n2. **學業壓力**\n   - 到「課程」查看哪些作業快截止，先處理最緊急的\n   - 利用「AI 助理」幫你規劃學習計畫\n\n3. **專業資源**\n   - 🏥 學校諮商中心提供免費的心理諮商服務\n   - 可以在「校園 > 健康中心」預約\n\n記住，尋求幫助是勇敢的表現。你已經很努力了！💪\n\n建議選項：預約諮商、整理待辦、學習建議",
        },
        {
            "instruction": "怎麼用這個 APP 繳交作業？",
            "input": "",
            "output": "繳交作業的步驟很簡單：\n\n1. 前往「課程」分頁\n2. 選擇要繳交作業的課程\n3. 進入「課程中樞」\n4. 點擊「作業」區塊\n5. 找到要繳交的作業，點擊「繳交」\n6. 上傳檔案或輸入內容\n7. 確認送出\n\n💡 **小提示**：\n- 你也可以在「訊息 > 群組」中找到課程群組，裡面會有作業討論\n- 繳交前記得檢查截止時間，可以在「收件匣」查看所有待繳作業\n- 支援的檔案格式：PDF、Word、圖片等\n\n建議選項：查看待繳作業、收件匣、課程群組",
        },
        {
            "instruction": "我的包裹到了，要去哪裡領？",
            "input": "",
            "output": "查看包裹領取資訊：\n\n1. 前往 APP「校園」分頁\n2. 點擊「宿舍」功能\n3. 在「包裹」區塊查看你的包裹狀態和領取地點\n\n通常包裹會在宿舍管理室或指定的收發室。記得帶學生證去領取！\n\n建議選項：查看包裹、宿舍資訊、開啟導航",
        },
        {
            "instruction": "幫我規劃今天的行程",
            "input": "[Context] 今日課程: 10:00資料結構(資訊302), 14:00英文(人文201)。待繳作業: 演算法報告(明天截止)。",
            "output": "好的，幫你規劃今天的行程：\n\n📅 **今日行程建議**\n\n⏰ **09:00-09:50** 早餐 + 複習資料結構\n📚 **10:00-11:50** 資料結構（資訊大樓 302）\n🍽️ **12:00-13:00** 午餐時間（可以去學生餐廳或素食餐廳）\n✏️ **13:00-13:50** 趕工「演算法報告」（明天截止⚠️）\n📚 **14:00-15:50** 英文課（人文大樓 201）\n📝 **16:00-18:00** 繼續完成演算法報告\n🏃 **18:00-19:00** 晚餐 + 休息\n📖 **19:00-21:00** 演算法報告最終檢查和提交\n\n⚠️ **最重要**：演算法報告明天截止，建議今天完成並提交！\n\n建議選項：設定提醒、查看課表、開始寫作業",
        },
    ]
    return scenarios + _diverse_topic_scenario_pairs()


def _diverse_topic_scenario_pairs() -> list[dict]:
    """補充與課表／餐廳／成績不同維度的短情境，拉開主題覆蓋。"""
    return [
        {
            "instruction": "宿舍浴室燈不亮可以報修嗎？",
            "input": "",
            "output": (
                "可以，請走宿舍／設備報修流程。\n\n"
                "1. 開啟「校園」相關頁面找到報修或宿舍入口\n"
                "2. 選類型（例如電力／設備）、填地點與問題描述\n"
                "3. 送出後留意處理進度\n\n"
                "⚠️ 若有立即危險（漏水觸電），請先聯絡舍監或警衛。\n\n"
                "建議選項：建立報修、拍照備註、查看進度"
            ),
        },
        {
            "instruction": "學校哪裡可以影印或列印？",
            "input": "",
            "output": (
                "常見作法是用 APP 內的列印／影印相關功能（若貴校有綁定）。\n\n"
                "大致步驟：\n"
                "1. 到「校園」或服務入口找到列印／印表機\n"
                "2. 選檔案與印表機，確認黑白／彩色與份數\n"
                "3. 若需現場繳費，依頁面指示完成\n\n"
                "若 APP 未顯示任何印表機，代表該校區可能尚未開通線上列印。\n\n"
                "建議選項：查看印表機列表、列印教學、改問圖書館服務台"
            ),
        },
        {
            "instruction": "校園 Wi‑Fi 連不上怎麼辦？",
            "input": "",
            "output": (
                "可先快速自查：\n\n"
                "1. 確認已連到正確 SSID（教室／宿舍可能不同）\n"
                "2. 重新登入校園帳號或忘記網路後重連\n"
                "3. 換個時段或座位排除基地台過載\n\n"
                "若仍失敗：記下時間、地點與錯誤訊息，向電算中心或總務／資訊窗口反映。\n\n"
                "建議選項：查看公告、聯絡電算中心、改用手機熱點應急"
            ),
        },
        {
            "instruction": "心理諮商要怎麼預約？會很麻煩嗎？",
            "input": "",
            "output": (
                "通常不麻煩，重點是先踏出第一步。\n\n"
                "你可以：\n"
                "1. 到「校園」或健康／諮商相關頁面查看預約方式\n"
                "2. 依規定選時段與填寫基本資料\n"
                "3. 依照約時間準時前往（線上／實體依學校規定）\n\n"
                "諮商屬專業資源，**不必覺得不好意思**；若想匿名需求也可先看 FAQ。\n\n"
                "建議選項：預約諮商、查看心理健康資源、先看自助文章"
            ),
        },
        {
            "instruction": "機車停哪裡會被拖吊？",
            "input": "",
            "output": (
                "各校區規定不同，請以學校總務／交通安全公告為準。\n\n"
                "通用原則：\n"
                "- 停在**劃線格內**並依箭头／编号停放\n"
                "- **紅線、人行道、消防通道、出入口**不要停\n"
                "- 留意「禁止停車」告示與時段管制\n\n"
                "建議到 APP「校園／地圖或公告」交叉確認最新規定。\n\n"
                "建議選項：查看公告、開啟校園地圖、聯絡總務"
            ),
        },
        {
            "instruction": "我想加入魔術社要問誰？",
            "input": "",
            "output": (
                "社團資訊通常在「活動／社群／公告」類入口可查。\n\n"
                "你可以：\n"
                "1. 搜尋社團名稱或到活動列表找招新資訊\n"
                "2. 透過公告上的聯絡方式（Line、IG、Email）私訊幹部\n"
                "3. 留意說明會／迎新時間地點\n\n"
                "我不會替你代為報名，但可以幫你整理問題清單。\n\n"
                "建議選項：搜尋社團、查看活動、私訊聯絡人"
            ),
        },
        {
            "instruction": "英文履歷第一段怎麼寫比較自然？",
            "input": "",
            "output": (
                "這題偏一般寫作，可用「目標＋科系／年級＋一項強項」三段式開頭。\n\n"
                "範例骨架：\n"
                "- I am a junior majoring in ___.\n"
                "- I am passionate about ___ because ___.\n"
                "- I hope to contribute ___ through ___.\n\n"
                "請你自己替換具體名詞；我可以再依你的草稿逐句修。\n\n"
                "建議選項：給我草稿、改成申請研究所版、改成工讀版"
            ),
        },
        {
            "instruction": "今晚想早睡但報告寫不完，怎麼取捨？",
            "input": "",
            "output": (
                "先把「後果最大」的事排到前面。\n\n"
                "務實作法：\n"
                "1. 列出截止時間與占总成绩比重\n"
                "2. **先做最小可提交版本**（大纲＋核心段落）\n"
                "3. 設定 25 分鐘番茄鐘，時間到先睡 7 小時再補\n\n"
                "長期睡眠不足會拖累隔天效率；必要時向助教／老師誠實溝通。\n\n"
                "建議選項：拆任務清單、設明日闹钟、请假／延期問答模板"
            ),
        },
        {
            "instruction": "Apple Wallet 學生證載入失敗",
            "input": "",
            "output": (
                "這類問題多半是設備或發卡平台設定。\n\n"
                "可試：\n"
                "1. iOS 更新到相容版本、重開機\n"
                "2. 重新登入校園身分／信箱驗證連結\n"
                "3. 確認貴校是否仍支援該載具（有些僅限 Android）\n\n"
                "若錯誤碼固定出現，請截圖給電算／註冊組。\n\n"
                "建議選項：查看 FAQ、聯絡電算中心、改用實體學生證"
            ),
        },
        {
            "instruction": "我想捐二手書給學校活動可以嗎？",
            "input": "",
            "output": (
                "通常可以，但要依活動主辦單位規定。\n\n"
                "建議流程：\n"
                "1. 到公告／活動頁確認收件時間與地點\n"
                "2. 檢查書況（缺頁、個資涂銷）\n"
                "3. 現場交付並索取簽收或志工時數證明（若有）\n\n"
                "我不會代替你聯絡主辦，但可以幫你列確認問句。\n\n"
                "建議選項：搜尋捐書活動、查看失物／二手平台規範、私訊主辦"
            ),
        },
        {
            "instruction": "明天的气温會冷嗎？要怎麼穿衣服",
            "input": "",
            "output": (
                "我無法取得即時天氣（離線／無外部資料時請勿猜测）。\n\n"
                "你可自行：\n"
                "1. 開啟中央氣象署或手機天氣 App\n"
                "2. 查最低温與降雨機率\n"
                "3. 洋葱式穿法：薄长袖＋外套\n\n"
                "若你需要，我可改幫你整理「雨天備援路線」在校園內怎么走。\n\n"
                "建議選項：查天氣、查看校園地圖避雨點、帶摺傘提醒"
            ),
        },
        {
            "instruction": "和同組的同學吵架了不想一起做專題怎麼辦？",
            "input": "",
            "output": (
                "先照顧安全與完成度：有情緒很正常。\n\n"
                "建議策略：\n"
                "1. **冷靜 24 小時**，用文字列出分工與截止點（留紀錄）\n"
                "2. 找助教／老師協調角色或調組（依課程規定）\n"
                "3. 若涉及騷擾或威脅，請向性平／諮商／學務求助\n\n"
                "我可以幫你起草一封中性禮貌的溝通訊息。\n\n"
                "建議選項：起草訊息、拆解交付里程碑、預約諮商"
            ),
        },
    ]


def _credit_audit_pairs() -> list[dict]:
    """學分試算與選課情境。"""
    return [
        {
            "instruction": "我還差多少學分才能畢業？",
            "input": "[Context] 已修128學分中的必修80/80, 選修30/48, 通識18/20",
            "output": "根據你的學分狀況：\n\n📊 **畢業學分進度**\n- ✅ 必修：80/80（已完成）\n- ⏳ 選修：30/48（還差 18 學分）\n- ⏳ 通識：18/20（還差 2 學分）\n\n**總結**：你還需要 20 學分（選修 18 + 通識 2）才能畢業。\n\n📋 **建議**：\n1. 下學期可以多選 2-3 門選修課\n2. 通識只差 2 學分，選一門通識課就夠了\n3. 建議到「學分試算」功能做更詳細的規劃\n\n建議選項：學分試算、選課建議、查看課程",
        },
        {
            "instruction": "下學期應該選什麼課？",
            "input": "[Context] 系所:資訊工程, 年級:大三, 已修:資料結構,演算法,程式設計. 未修必修:作業系統,計算機組織. 興趣:AI/ML",
            "output": "根據你的狀況，這是我的選課建議：\n\n🎯 **必修優先**（一定要選）\n1. 作業系統 - 大三必修，建議不要再拖\n2. 計算機組織 - 同上\n\n💡 **推薦選修**（符合你的 AI/ML 興趣）\n3. 機器學習概論 - 入門 ML 的好課\n4. 深度學習 - 如果已有 ML 基礎\n5. 資料庫系統 - 做 AI 專案很實用\n\n⚠️ **提醒**：\n- 大三要確保必修都修完，大四才有餘裕做專題\n- 修課學分數建議控制在 18-22 學分\n\n建議選項：學分試算、查看課程大綱、加選課程",
        },
    ]


AGENT_SYSTEM_ZH = (
    "你是校園 App 內的本機助理「靜宜小幫手」。"
    "需要用 App 資料回答時：先簡短說明要做什麼，再在獨立一行使用 "
    "[EXECUTE:工具名:{JSON參數}]（JSON 鍵值皆用雙引號；無參數時用 {}）。"
    "下一則 user 會以 [TOOL_RESULT] 開頭給你工具的結構化結果；請依結果用繁體中文回答，"
    "不可捏造資料；若失敗要說明原因並給「建議選項」。"
    "寫入類動作若僅完成草稿，須提醒使用者到確認卡送出。"
)


def _agent_process_trajectories() -> list[dict]:
    """多輪代理／工具過程訓練樣本（與裝置端 [EXECUTE:…] 語法一致）。"""
    return [
        {
            "messages": [
                {"role": "system", "content": AGENT_SYSTEM_ZH},
                {"role": "user", "content": "我這週還有哪些作業沒交？"},
                {
                    "role": "assistant",
                    "content": (
                        "我先從 App 讀取待繳作業清單。\n"
                        "[EXECUTE:query_assignments:{\"status\":\"pending\"}]"
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        "[TOOL_RESULT] "
                        "{\"success\":true,\"summary\":\"待繳：演算法作業（截止週日 23:59）；"
                        "資料結構 Lab3（截止明天中午）\"}"
                    ),
                },
                {
                    "role": "assistant",
                    "content": (
                        "你目前至少有兩件待繳：\n"
                        "1）演算法作業 — 截止本週日 23:59\n"
                        "2）資料結構 Lab3 — 截止明天中午\n\n"
                        "建議先完成時間較緊的 Lab3，再把演算法分段寫。\n\n"
                        "建議選項：設定提醒、開啟作業詳情、加入行事曆"
                    ),
                },
            ]
        },
        {
            "messages": [
                {"role": "system", "content": AGENT_SYSTEM_ZH},
                {"role": "user", "content": "下週三中午想吃清淡一點，有推薦嗎？"},
                {
                    "role": "assistant",
                    "content": (
                        "我先依照預算與時段抓正餐候選（不下單）。\n"
                        "[EXECUTE:recommend_lunch:{\"timeSlot\":\"lunch\",\"budget\":\"120\"}]"
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        "[TOOL_RESULT] "
                        "{\"success\":true,\"summary\":\"候選：蔬菜炊飯 $75（素食餐廳）；"
                        "野菜豆腐鍋 $95（學餐二樓）\"}"
                    ),
                },
                {
                    "role": "assistant",
                    "content": (
                        "如果要清淡／素食取向，可以優先看這兩個：\n"
                        "- 蔬菜炊飯 $75（素食餐廳）— 較輕\n"
                        "- 野菜豆腐鍋 $95（學餐二樓）— 份量較足\n\n"
                        "你要我幫你開「線上點餐」頁選一家嗎？\n\n"
                        "建議選項：查看完整菜單、線上點餐、改推晚餐"
                    ),
                },
            ]
        },
        {
            "messages": [
                {"role": "system", "content": AGENT_SYSTEM_ZH},
                {"role": "user", "content": "幫我找書架上有没有 Python 入門的書"},
                {
                    "role": "assistant",
                    "content": "我先查館藏關鍵字。\n[EXECUTE:query_library:{\"action\":\"search\",\"keyword\":\"Python 入門\"}]",
                },
                {
                    "role": "user",
                    "content": (
                        "[TOOL_RESULT] "
                        "{\"success\":true,\"summary\":\"找到 3 本：Python 程式設計導論（可借 2 冊）；"
                        "Automate the Boring Stuff（架上 1 冊）\"}"
                    ),
                },
                {
                    "role": "assistant",
                    "content": (
                        "館藏查到有書可取閱，例如《Python 程式設計導論》目前仍可借。\n"
                        "若要借書，請到圖書館頁面完成借閱流程。\n\n"
                        "建議選項：預約取書、查看書籍位置、開啟導航"
                    ),
                },
            ]
        },
        {
            "messages": [
                {"role": "system", "content": AGENT_SYSTEM_ZH},
                {"role": "user", "content": "我下週二整天有空嗎？跟行事曆比對一下"},
                {
                    "role": "assistant",
                    "content": (
                        "我抓你的行事曆區間來對。\n"
                        "[EXECUTE:query_calendar:{\"startDate\":\"2025-05-13\",\"endDate\":\"2025-05-13\"}]"
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        "[TOOL_RESULT] "
                        "{\"success\":true,\"summary\":\"2025-05-13：10:00-12:00 會議；"
                        "14:00 組會；其餘空白\"}"
                    ),
                },
                {
                    "role": "assistant",
                    "content": (
                        "下週二（2025-05-13）**不是**整天有空：上午 10–12 有會議、下午 2 點有組會。"
                        "若你要安排活動，建議選傍晚或會議之間的空檔。\n\n"
                        "建議選項：加入行事曆、調整提醒、查看課表"
                    ),
                },
            ]
        },
        {
            "messages": [
                {"role": "system", "content": AGENT_SYSTEM_ZH},
                {"role": "user", "content": "我期中微積分考几分？"},
                {
                    "role": "assistant",
                    "content": "我先讀成績摘要。\n[EXECUTE:query_grades:{}]",
                },
                {
                    "role": "user",
                    "content": "[TOOL_RESULT] {\"success\":true,\"summary\":\"微積分（期中）：62 分\"}",
                },
                {
                    "role": "assistant",
                    "content": (
                        "你在「微積分」的期中成績是 **62 分**。\n"
                        "若想拉高期末比重，建議先確認課綱配分並規劃複習節奏。\n\n"
                        "建議選項：查看完整成績、請教助教、排讀書計畫"
                    ),
                },
            ]
        },
        {
            "messages": [
                {"role": "system", "content": AGENT_SYSTEM_ZH},
                {"role": "user", "content": "我想請假明天下午的英文課，理由是看病"},
                {
                    "role": "assistant",
                    "content": (
                        "先確認課程對應的課程 ID，才能送出請假。\n"
                        "[EXECUTE:query_courses:{}]"
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        "[TOOL_RESULT] "
                        "{\"success\":true,\"summary\":\"英文課：courseSpaceId=ENG202-spring\"}"
                    ),
                },
                {
                    "role": "assistant",
                    "content": (
                        "我已對到你的英文課，接下來建立請假草稿（需經 App 確認）。\n"
                        "[EXECUTE:request_leave:{\"courseId\":\"ENG202-spring\",\"date\":\"2025-05-14\",\"reason\":\"就醫\",\"leaveType\":\"personal\"}]"
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        "[TOOL_RESULT] "
                        "{\"success\":true,\"summary\":\"請假草稿已建立；請在確認卡按下送出\",\"isDraft\":true}"
                    ),
                },
                {
                    "role": "assistant",
                    "content": (
                        "請假資料已整理成草稿：**英文課（2025-05-14）**，事由為就醫。"
                        "請到畫面上的**確認卡**按下送出後才會正式送出請假。\n\n"
                        "建議選項：檢查草稿、改截止時間前撤回、聯絡助教"
                    ),
                },
            ]
        },
        {
            "messages": [
                {"role": "system", "content": AGENT_SYSTEM_ZH},
                {"role": "user", "content": "我浴室漏水要報修"},
                {
                    "role": "assistant",
                    "content": (
                        "我幫你開報修草稿（需要你確認細節後送出）。\n"
                        "[EXECUTE:create_repair_request:{\"type\":\"plumbing\",\"room\":\"\",\"description\":\"浴室渗水\"}]"
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        "[TOOL_RESULT] "
                        "{\"success\":false,\"errorCode\":\"missing_info\",\"summary\":\"缺少房號與棟別\"}"
                    ),
                },
                {
                    "role": "assistant",
                    "content": (
                        "目前缺「宿舍棟別＋房號」，我沒辦法直接替你送出。\n"
                        "請告訴我例如：**北宿 307** 或 **仁愛樓 B412**，我再幫你補上。\n\n"
                        "建議選項：查看宿舍資訊、拍照上傳、改填緊急聯絡"
                    ),
                },
            ]
        },
        {
            "messages": [
                {"role": "system", "content": AGENT_SYSTEM_ZH},
                {"role": "user", "content": "剛剛訂餐送來了沒？"},
                {
                    "role": "assistant",
                    "content": "我先查訂單狀態。\n[EXECUTE:query_orders:{\"status\":\"pending\"}]",
                },
                {
                    "role": "user",
                    "content": "[TOOL_RESULT] {\"success\":false,\"errorCode\":\"auth_required\",\"summary\":\"請先登入後才能查訂單\"}",
                },
                {
                    "role": "assistant",
                    "content": (
                        "現在無法讀取訂單：**尚未登入或登入狀態過期**。\n"
                        "請先到 App 登入並確認網路／同步完成後再問一次。\n\n"
                        "建議選項：前往登入、查看訂餐紀錄、重新整理"
                    ),
                },
            ]
        },
        {
            "messages": [
                {"role": "system", "content": AGENT_SYSTEM_ZH},
                {"role": "user", "content": "查一下資料結構這門课的教材单元"},
                {
                    "role": "assistant",
                    "content": (
                        "我先列出該課程單元（含教材）。\n"
                        "[EXECUTE:query_modules:{\"courseSpaceId\":\"CS201-spring\",\"includeMaterials\":\"true\"}]"
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        "[TOOL_RESULT] "
                        "{\"success\":true,\"summary\":\"單元：①鏈結串列（投影片 PDF）；②堆疊與佇列（影片＋閱讀）\"}"
                    ),
                },
                {
                    "role": "assistant",
                    "content": (
                        "資料結構課目前已揭露的單元與教材例如：\n"
                        "1）鏈結串列 — 附投影片 PDF\n"
                        "2）堆疊與佇列 — 含影片與閱讀材料\n\n"
                        "你可到課程教材頁依序完成。\n\n"
                        "建議選項：開啟教材、下載離線、設每周進度"
                    ),
                },
            ]
        },
        {
            "messages": [
                {"role": "system", "content": AGENT_SYSTEM_ZH},
                {"role": "user", "content": "提醒我後天下午寫演算法報告"},
                {
                    "role": "assistant",
                    "content": (
                        "建立行事曆提醒草稿。\n"
                        "[EXECUTE:create_reminder:{\"title\":\"演算法報告\",\"time\":\"2025-05-17T14:00:00\",\"source\":\"assistant\"}]"
                    ),
                },
                {
                    "role": "user",
                    "content": "[TOOL_RESULT] {\"success\":true,\"summary\":\"提醒已加入行事曆（本地）\"}",
                },
                {
                    "role": "assistant",
                    "content": (
                        "已幫你把「演算法報告」排到 **後天 14:00** 的提醒。\n"
                        "若需要改成確切截止時刻，告訴我時間我再調整。\n\n"
                        "建議選項：查看行事曆、設定第二次提醒、連結作業頁"
                    ),
                },
            ]
        },
    ]


def _general_conversation_pairs() -> list[dict]:
    """Friendly campus-life conversation examples."""
    return [
        {"instruction": "你好", "input": "", "output": "嗨！我是你的校園智慧助理 🎓 有什麼我可以幫你的嗎？我可以幫你查公告、找餐廳、看課表，或是聊聊天都可以！\n\n建議選項：今日公告、推薦餐點、查看課表"},
        {"instruction": "你是誰？", "input": "", "output": "我是校園智慧助理！我住在你的校園 APP 裡，專門幫助同學處理校園大小事。\n\n我可以幫你：\n- 📣 查詢公告和活動\n- 🍽️ 推薦餐廳和菜單\n- 📚 管理課程和作業\n- 🗺️ 校園導航\n- 📊 分析成績和規劃選課\n- 💬 聊天解悶\n\n試著問我任何問題吧！\n\n建議選項：APP 功能介紹、今日摘要、找地點"},
        {"instruction": "謝謝你的幫助", "input": "", "output": "不客氣！能幫到你我很開心 😊 如果之後有任何問題，隨時來找我聊聊！祝你今天一切順利！\n\n建議選項：還有問題、今日摘要、再見"},
        {"instruction": "無聊死了", "input": "", "output": "無聊的時候可以試試：\n\n1. 🎯 看看有什麼校園活動可以參加\n2. 📚 去圖書館找本有趣的書\n3. 🏃 到操場走走運動一下\n4. 👥 約同學一起吃個下午茶\n5. 🎮 查看你的校園成就，看還有哪些沒解鎖\n\n或者，我們可以繼續聊天！你最近對什麼感興趣？\n\n建議選項：查看活動、校園成就、推薦餐點"},
    ]


def _follow_up_context_message_pairs() -> list[dict]:
    """多輪承接上文：代詞、簡稱、追問（強化對話連貫）。"""
    sys = (
        "你是校園 App 的本機助理。「那個／這門／剛才／同上／為什麼／再講一次」必須對齊上文提到的對象；"
        "若不確定就先一句話確認，不要臆測。"
    )
    return [
        {
            "messages": [
                {"role": "system", "content": sys},
                {"role": "user", "content": "資料結構這門課的期中考範圍到哪一章？"},
                {
                    "role": "assistant",
                    "content": (
                        "範圍要以該課程在 APP／iLMS 的公告為準；我這裡沒看到你的課程細節時無法代為認定章節。\n\n"
                        "你可以：課程中樞 → 該門課 → 公告／教材區查看最新說明。\n\n"
                        "建議選項：開啟課程公告、問助教信箱"
                    ),
                },
                {"role": "user", "content": "那繳交方式是交 PDF 還是紙本？"},
                {
                    "role": "assistant",
                    "content": (
                        "你前一則問的是「資料結構」期中考範圍；這題問繳交方式——若指的是同一門課的考試或報告，"
                        "同樣以該作業／考試公告為準（有些課只收線上 PDF，有些要現場紙本）。\n\n"
                        "請到該門課「作業／考試」頁面確認格式與截止時間。\n\n"
                        "建議選項：開啟作業詳情、下載範本"
                    ),
                },
            ]
        },
        {
            "messages": [
                {"role": "system", "content": sys},
                {"role": "user", "content": "學生餐廳現在有什麼推薦？"},
                {
                    "role": "assistant",
                    "content": (
                        "若 APP 已載入今日菜單，可到「校園／餐廳」查看；離線時我只能給選餐思路（均衡蛋白＋蔬菜）。\n\n"
                        "建議選項：開啟今日菜單、查看過敏標示"
                    ),
                },
                {"role": "user", "content": "那個紅燒的會太鹹嗎？"},
                {
                    "role": "assistant",
                    "content": (
                        "「那個紅燒的」若是指你上一句情境裡提到的紅燒類餐點：口味因人而異，我無法替你試吃。\n\n"
                        "可看菜單備註（鈉含量／辣度）、問現場阿姨能否少鹹，或改選清燙／烤肉類。\n\n"
                        "建議選項：查看營養標示、換一道菜"
                    ),
                },
            ]
        },
        {
            "messages": [
                {"role": "system", "content": sys},
                {"role": "user", "content": "演算法作業明天幾點截止？"},
                {
                    "role": "assistant",
                    "content": (
                        "請到「課程 → 作業」查看該筆作業的截止時間（時區以學校系統為準）。若頁面只顯示日期，通常指當日 23:59。\n\n"
                        "建議選項：設定提醒、提前上傳"
                    ),
                },
                {"role": "user", "content": "同上，遲交扣分嗎？"},
                {
                    "role": "assistant",
                    "content": (
                        "「同上」承接的是你前一則問的「演算法作業」：是否扣分依該課程規定（syllabus／公告），每門課不同。\n\n"
                        "請在作業說明找「遲交 policy」；找不到就 Email 助教確認並留存紀錄。\n\n"
                        "建議選項：查看課程大綱、寄信給助教"
                    ),
                },
            ]
        },
        {
            "messages": [
                {"role": "system", "content": sys},
                {"role": "user", "content": "我想預約明天的諮商。"},
                {
                    "role": "assistant",
                    "content": (
                        "請到 APP「校園／健康或諮商」入口依頁面選時段；若滿額可改選其他時段或電話詢問。\n\n"
                        "建議選項：開啟預約、查看取消規定"
                    ),
                },
                {"role": "user", "content": "剛才說明天若滿額呢？"},
                {
                    "role": "assistant",
                    "content": (
                        "承接上文：若明天諮商時段已滿，通常可以往後幾天換時段，或依學校規定加入候補／現場詢問。\n\n"
                        "仍以預約頁顯示為準。\n\n"
                        "建議選項：換日期、改電話預約"
                    ),
                },
            ]
        },
        {
            "messages": [
                {"role": "system", "content": sys},
                {"role": "user", "content": "這學期英文要退選。"},
                {
                    "role": "assistant",
                    "content": (
                        "退選前請確認截止日期與學分試算；流程多在「課程詳情」或選課系統內操作。\n\n"
                        "建議選項：學分試算、查看退選截止日"
                    ),
                },
                {"role": "user", "content": "這門會影響畢業英文門檻嗎？"},
                {
                    "role": "assistant",
                    "content": (
                        "「這門」承接你上一句想退選的「英文」課：是否影響畢業門檻要看你的系所規定與你是否已有替代修習。\n\n"
                        "請到「學分試算／畢業檢核」頁面對照英文（或其他語言）門檻。\n\n"
                        "建議選項：開啟學分試算、問系辦"
                    ),
                },
            ]
        },
    ]


def generate_all() -> Path:
    """Generate all training data and write to JSONL."""
    all_pairs: list[dict] = []

    all_pairs.extend(_screen_qa_pairs())
    all_pairs.extend(_campus_scenario_pairs())
    all_pairs.extend(_credit_audit_pairs())
    all_pairs.extend(_general_conversation_pairs())
    all_pairs.extend(_follow_up_context_message_pairs())
    # 代理多輪軌跡：維持題型分散但勿過度打散 system 連貫（仍與其它列一併 shuffle）
    all_pairs.extend(_agent_process_trajectories())

    all_pairs = thin_similar_alpaca_instructions(all_pairs)
    before_dedupe = len(all_pairs)
    all_pairs = dedupe_training_records(all_pairs)
    dropped = before_dedupe - len(all_pairs)
    if dropped:
        logger.info("Removed %d duplicate training rows (%d unique)", dropped, len(all_pairs))

    random.shuffle(all_pairs)

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        for pair in all_pairs:
            f.write(json.dumps(pair, ensure_ascii=False) + "\n")

    logger.info("Generated %d training pairs -> %s", len(all_pairs), OUTPUT_PATH)
    return OUTPUT_PATH


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    path = generate_all()
    print(f"Generated training data: {path} ({sum(1 for _ in open(path))} lines)")
