# Campus Companion 互動回饋系統設計

> 「讓嚴肅的校園 APP 變成大家每天都想打開的地方，但不靠成癮、不靠焦慮、不靠 streak 懲罰。」

## 一、思考過程：為什麼大多數校園 APP 的「養寵物」設計會失敗

我先逆推這題目的常見反例，再講解我的設計：

| 常見設計 | 為什麼會失敗 | Campus Companion 怎麼做 |
|---------|-------------|------------------------|
| 連續登入 streak | 學生生病 / 期考週 / 寒暑假被懲罰；焦慮值上升 | **不存在 streak**。考試週、病假、假期自動 hibernate，需求降至 0，回來不掉等級 |
| 寵物會餓死 | 強迫使用變成壓力來源；對憂鬱 / 高敏感族群有害 | **精靈不會死**。狀態低時是「想睡」，不是「快死」；careHint 主動建議休息 |
| 純積分排行榜 | 競爭把學業變成 KPI，且把弱勢學生公開羞辱 | **沒有 leaderboard**。只看自己的、同學之間是合作（送鼓勵雲、互相澆水） |
| 課金道具 | 不公平；違反校園產品定位 | **完全不存在課金**。所有道具都來自「採收自己的學習果實」 |
| 一次性遊戲 | 玩 2 週就膩 | **5 個互鎖系統 + 自成長**。精靈會跨四年進化、新生會收到學長種子、四年後種傳承樹 |
| 與校務無關 | 變成跟 APP 主功能無關的小遊戲 | **每個遊戲機制都由 APP 既有資料驅動**（出席、作業、餐廳、地圖、群組） |

我的設計目標不是「另加一個遊戲分頁」，而是「把日常使用 APP 這件事本身變成一場慢長大的故事」。

---

## 二、Campus Companion：5 個互鎖系統

```
                ┌──────────────────────────┐
                │  Campus Companion (你)   │
                └────────────┬─────────────┘
        ┌────────────┬───────┴────────┬─────────────┐
        ▼            ▼                ▼             ▼
   ┌────────┐  ┌──────────┐    ┌──────────┐   ┌──────────┐
   │ 校園精靈│  │ 學習花園 │    │ 校園星圖 │   │ 同儕共生 │
   │ Sprite │  │ Garden   │    │Constella-│   │Symbiosis │
   │        │  │          │    │ tion     │   │          │
   └───┬────┘  └────┬─────┘    └─────┬────┘   └────┬─────┘
       │            │                │             │
       └────────────┴──────┬─────────┴─────────────┘
                           ▼
                ┌─────────────────────┐
                │  自成長 Self-Growth │
                │ (校園氣象 / 學年事件)│
                └─────────────────────┘
```

### 系統 1：校園精靈 Campus Sprite

一隻會從蛋孵化、跟你一起在這所學校長大的小生物。

**4 個需求（直接對應 APP 主功能）：**

| 需求 | 怎麼填 | 資料來源 |
|------|--------|---------|
| **學 Study** | 出席、教材閱讀、作業、測驗 | enrollments / assignments / attendanceRecords / quizAttempts |
| **動 Move** | 校園地圖走動、公車打卡、健康中心 | location traces / TransportHub / HealthScreen |
| **食 Nourish** | 點餐、不同店家數、飲食均衡（呼應前面 P0 修復） | CafeteriaScreen / orders / recommendLunch |
| **友 Social** | 群組互動、揪團、互評、討論 | GroupPosts / group_order / PeerReview / discussions |

**進化階段**（不靠刷活躍度，靠時間 + 廣度）：

```
🥚 egg  (前 14 天，新生不施壓)
↓
🌱 sprout (14-60 天)
↓
🐣 fledgling (60-180 天)
↓
🦝 companion (180-540 天)
↓
🦊 guardian (大三/大四，可種傳承樹給學弟妹)
```

**情緒（mood）**：energetic / focused / curious / caring / tired / lonely / sleepy
**careHint**：精靈會主動講話，建議行動（不命令）
- 連 5 天爆肝讀書沒社交 → 「你最近很拚，要不要先散個步？」
- 一週沒紀錄餐點 → 「今天還沒吃飯，去看看餐廳？」
- 完全沒社交 → 「揪同學一起吃飯，精靈會跟著開心。」

**核心算法**：`packages/shared/src/companion/spriteEngine.ts`，已實作 + 11 條測試

### 系統 2：學習花園 Learning Garden

每門選修課變成花園裡的一棵植物。

```
🌱 seed → 🌿 sprout → 🪴 leafy → 🌷 budding → 🌸 blossoming → 🍎 fruiting
                                                                ↓
                                                           可採收（學期末）
不及格 → 🥀 withering（可重新栽種 = 重修）
```

**驅動公式**（已實作在 `gardenEngine.ts`）：

```
growth = 出席率×25 + 作業繳交率×25 + 測驗參與率×20 + 教材閱讀率×20 + 討論貢獻×10
health = 100 − 缺席扣分 − 缺交扣分
```

**採收（Harvest）規則**：
- 學期結束 + 達 fruiting + 健康 ≥ 60 + 通過（分數 ≥ 60）
- 採收知識點 = (成績 − 50) × 2
- 知識點可餵精靈、解鎖場景、種傳承樹

**為什麼不及格不消失**：枯萎只是視覺提示，「下學期可以重新栽種」對應 LMS 的重修。不羞辱、不刪除歷史。

### 系統 3：校園探索星圖 Constellation

把校園地圖變成星圖。去過的地方、用過的服務 = 點亮一顆星。

- 各區域連成不同星座（教學區、宿舍區、運動區、商業區）
- 季節限定星座（春櫻 / 夏螢 / 秋楓 / 冬燈）
- 點亮一座星座 → 解鎖該區域 AR 導航的限定裝飾
- 大四畢業前可生成「我與這所學校的足跡」可分享圖

### 系統 4：同儕共生 Symbiosis

軟性社交。**重點是「鼓勵不羞辱、合作不競爭」**。

- 看見同學花園的「天氣」（氛圍：晴 / 陰 / 雨 / 烏雲），看不到細節
- 同學心情低（精靈 tired/lonely）→ 可送「鼓勵雲」（一句話 + emoji，可匿名）
- 揪團讀書 = 兩株植物互相澆水，雙方 growth +5%
- **沒有 leaderboard、沒有 PK、沒有「你輸給某人」**

### 系統 5：自成長機制 Self-Growth（最重要）

> 這是回應你說「能自己成長」的核心：系統本身會隨時間進化。

**A. 校園氣象（每週一次，全校共享）**

Cloud Function cron 每週分析全校學生集體資料，產生「本週校園氣象」：

```
連續陰雨 → 全校大家最近壓力大 → 給所有人 +5% nourish 加成、推送諮商中心 CTA
晴朗 → 學業狀況良好 → 解鎖「課外活動」限定星座
雪天 → 寒假前夕 → 觸發「種傳承樹」事件
```

**B. 學年解鎖（自動）**

| 學年 | 解鎖內容 |
|------|---------|
| 大一春 | 從學長學姐花園收到「新生種子」（系上前輩用知識點種的） |
| 大二夏 | 開放「實驗室」場景 + 第二隻精靈 |
| 大三秋 | 解鎖「畢業準備」事件：花園可種「未來樹」 |
| 大四冬 | 可種「傳承樹」給下屆學弟妹（樹會生長成現實學弟妹首次登入時的新生種子） |

**C. AI 衍生新精靈品種（每學期）**

每學期末 Cloud Function 用該校全體精靈狀態 + 校園氣象 + 校園特色（地理、社團、課程）→ AI 生成 1-2 個該校獨有的精靈品種，下學期新生可孵化。

例如靜宜大學專屬：因為靠近大肚山與梧棲海邊 → 可能生成「霧海精靈」「山靈鹿」「圖書館裡的書蟲」。

**D. 限時事件（每月）**

- 期中考週 → 「精靈幫你撐傘」事件（自動 hibernate + 解鎖期考裝扮）
- 校慶週 → 全校精靈聚集校門口
- 期末週 → 「採收嘉年華」（收穫翻倍）

---

## 三、資料模型

### 3.1 Firestore 結構

```
users/{uid}/
  companion/
    state         // 主精靈狀態 cache
    inventory     // 知識點 / 裝飾 / 種子
  companionSignals/{date}  // 每日活動信號（feed engine）
  gardenCache/current     // 每門課的 CourseSignals 聚合
  constellation/{starId}  // 點亮的星 + 星座進度

schools/{schoolId}/
  campusWeather/{weekId}  // 每週氣象（cron 寫）
  spriteSpecies/{species} // 該校 AI 生成的精靈品種
  legacyTrees/{treeId}    // 大四傳承樹 → 新生領種子來源
```

### 3.2 資料來源 → 信號聚合（每日 cron）

```text
attendance.checkins → companionSignals.attendanceCheckins
quiz.attempts       → companionSignals.quizAttempts
materials.read      → companionSignals.materialsRead
orders.placed       → companionSignals.mealsOrdered (+ distinctVendors)
map.locationHits    → companionSignals.campusVisitsCount
groupPosts.comments → companionSignals.socialInteractions
```

### 3.3 防作弊

- 信號取得只走 Cloud Function（學生不可直接寫 companionSignals）
- 每個信號有「事件對應」要求：mealsOrdered 必須有 orderId、attendanceCheckins 必須有 sessionId
- 同一事件不能重覆計分（每筆 docId）

---

## 四、安全護欄（與前面 Wellbeing 護欄一致）

1. **無 streak、無懲罰**：考試週 / 病假 / 寒暑假 → hibernate，回來不掉
2. **wellbeing 偵測**：連 5 天 burnout 自動觸發休息 CTA 而非催促
3. **PII**：鼓勵雲 ≤ 30 字、預設匿名、有檢舉按鈕
4. **不接受課金**：所有道具來自學業，沒有支付 API 接入
5. **家長 / 自己看健康使用儀表板**：每週使用時數、是否壓力過高、是否該休息（接近 Apple Screen Time 概念）
6. **退出機制**：使用者可一鍵關閉所有 gamification UI（純 LMS 模式）

---

## 五、為什麼這個設計能「讓學生每天打開 APP」

不是因為它好玩到上癮。是因為：

1. **每天 APP 自然動作（出席、吃飯、走路）都會看見精靈反應** → 不打開錯過的不是「進度」，是「看自己今天怎樣」的儀式感
2. **精靈會講話、會建議**，比硬 push notification 親近
3. **學期末有採收儀式** → 期末成績不只是數字，是一棵結了果的樹
4. **跨四年累積** → 不是用完即丟，是會有歷史感的紀念物
5. **不焦慮** → 不像 IG/TikTok 那種焦慮成癮，是「等公車時看看牠在做什麼」的輕量陪伴

---

## 六、技術交付（本輪完成）

| 檔案 | 用途 |
|------|------|
| `packages/shared/src/companion/spriteEngine.ts` | 精靈狀態純函式引擎 |
| `packages/shared/src/companion/gardenEngine.ts` | 花園計算純函式引擎 |
| `apps/mobile/src/__tests__/spriteEngine.test.ts` | 11 條精靈測試 |
| `apps/mobile/src/__tests__/gardenEngine.test.ts` | 11 條花園測試 |
| `backend/functions/agent/tools/computeCompanionState.js` | 後端 callable：聚合精靈 + 花園回傳 |
| `aiToolRegistry.ts` 新增 5 個 AI 工具 | `query_companion` / `pet_companion` / `harvest_plant` / `send_encouragement` / `explore_constellation` |

---

## 七、落地 Roadmap（4 階段）

### Phase A：MVP（4 週）
- ✅ 兩個純函式引擎 + 測試（本輪完成）
- ✅ 後端 callable + AI tool 註冊（本輪完成）
- ⬜ Mobile 端 `CompanionScreen.tsx`（顯示精靈 + 4 需求 + careHint）
- ⬜ 信號聚合 cron（每晚 11 點把今日 events → companionSignals）
- ⬜ 收件匣加「精靈跟你說 …」卡片

### Phase B：花園 + 採收（4 週）
- ⬜ Mobile `GardenScreen.tsx`（每門課一株植物）
- ⬜ 採收動畫 + 知識點寫入 inventory
- ⬜ 教師端可看到「我這門課大家植物的氣象」（不是看誰）

### Phase C：星圖 + 同儕（6 週）
- ⬜ 校園地圖增加星圖 overlay
- ⬜ 鼓勵雲收發 + 檢舉
- ⬜ 揪團讀書連動雙方 growth

### Phase D：自成長（8 週）
- ⬜ campusWeather cron + 季節事件
- ⬜ AI 生成精靈品種 cron（每學期末）
- ⬜ 傳承樹機制（大四 → 新生種子）

---

## 八、評估指標（不是 DAU，是 wellbeing）

| 指標 | 目標 | 警示線 |
|------|------|--------|
| 7-day retention | ≥ 55% | < 30% 重新審視 |
| 平均每日使用時間 | 5-15 分鐘 | > 30 分鐘要降低拉力 |
| burnout 偵測命中率 | ≥ 70% | 若 < 50% 表示 careHint 沒效果 |
| 鼓勵雲日均收發 | 中位數 ≥ 1 | 0 = 同儕共生失敗 |
| 「健康使用儀表板」打開率 | ≥ 20% | 低 = 學生不覺得需要關心自己 |
| 主動禁用 gamification 的比例 | ≤ 5% | 高 = 設計太擾人 |

---

## 九、口試怎麼講（一頁版）

> 「我設計了一套叫 Campus Companion 的回饋系統。它不像一般校園 APP 那樣靠『連續登入 streak』、『寵物會餓死』、『排行榜』來綁住使用者——這些設計對焦慮族群和高壓的考試週都有害。
>
> 我的設計是把『使用 APP 的日常動作』本身變成精靈成長的養分：出席、繳作業、吃飯、走校園、跟同學互動，這 4 個維度直接對應到精靈的 4 種需求。
>
> 系統有 5 個互鎖子系統：校園精靈、學習花園（每門課一棵樹）、校園星圖（地圖變星座）、同儕共生（鼓勵雲、合作澆水）、自成長機制（系統會隨學年解鎖、AI 每學期生成該校獨有的精靈品種、大四可種傳承樹給新生）。
>
> 安全護欄是直接寫進 prompt 與引擎的：考試週自動 hibernate、burnout 偵測會主動建議休息、無 PvP、無課金、可一鍵關閉所有遊戲化 UI 變回純 LMS。
>
> 技術上兩個核心引擎是純函式（`spriteEngine.ts` + `gardenEngine.ts`），22 條單元測試全綠，可在 mobile / web / cloud function 共用。」

---

## 十、最後一句

「讓嚴肅 APP 變有趣」的最佳設計不是把 APP 變成遊戲，是讓使用 APP 本身變成一場慢慢長大的故事。
