# 口試 Demo 錄影腳本 v4.1

**目標長度**：8–10 分鐘
**錄製方式**：QuickTime → 新增影片錄製 → 鏡頭選 iPhone 17 Pro Max Simulator → 麥克風選內建
**iPhone Simulator**：FF459004-59DC-4E8A-8DCD-7DF7DAC7706E（iPhone 17 Pro Max · iOS 26.4）
**App**：`com.campus.app.dev`（已安裝在 sim）

---

## 開錄前 30 秒準備

```bash
# 1. 開 iOS 模擬器並啟動 demo app
open -a Simulator
xcrun simctl boot FF459004-59DC-4E8A-8DCD-7DF7DAC7706E 2>/dev/null
xcrun simctl launch FF459004-59DC-4E8A-8DCD-7DF7DAC7706E com.campus.app.dev

# 2. 等 5 秒 app 載完
sleep 5

# 3. 用學生身分起跑（如果不是請手動切角色）
# 此時畫面：學生王小明 TodayCockpit
```

QuickTime 錄影鏡頭設「iPhone 17 Pro Max」，**不要錄整個 Mac 桌面**（解析度 1170×2532 比較像 demo 影片）。

---

## 0:00 – 0:30 ＿ 開場 ✦ Slide 1 + Slide 2

**手機畫面**：學生 TodayCockpit（早安王小明 / 今天 3 堂課）

> 「大家好，我們的專題是『校園整合應用 App』。
>
> 跟一般校園 App 最大的差別在於：我們做的不是 chatbot，而是 **AI Agent**——它真的會幫你完成跨服務、跨角色的事。
>
> 整個系統有 9 個 AI Agent intent、5 層 AI 架構、7 條 Guardrail、17 個跨角色事件、Web 端覆蓋 8 個角色。」

**手機動作**：靜止在 TodayCockpit hero 一秒，讓觀眾看到「AI Agent 待命中 / AI 建議：先去主餐廳吃中餐？」

---

## 0:30 – 1:00 ＿ 問題切入 ✦ Slide 3 + Slide 4

**手機畫面**：保持學生 TodayCockpit，**輕輕往下滑**讓觀眾看到「下節課 / 本週待辦 / 請假草稿」一連串卡片

> 「學生每天平均花 18 分鐘在 5 個 App 之間找資訊。ChatGPT 知道答案，但不會幫你『下單便當』、不會『繳作業』、不會『傳訊息給老師』。
>
> 我們的 AI Agent 跟 chatbot 5 大差異——可以執行、會主動掃描、跨服務、跨角色、有 Guardrail 風險控管。」

---

## 1:00 – 1:30 ＿ 5 層 AI 架構 + 9 個 intent ✦ Slide 5 + Slide 6

**手機畫面**：點下方 **AI 球** (中央懸浮按鈕) 開 AI Overlay，講完後關掉

> 「我們的 AI 大腦分 5 層——L1 Perceive 感知環境、L2 Think 思考信心與風險、L3 Act 經過 7 條 Guardrail 後執行、L4 Background Scan 使用者沒問也主動 plan、L5 Learn 從採納/拒絕學習。
>
> 整個 mobile 端有 32 個 ai\*.ts service，由 1 個 aiBrain hub 統一進入點。9 個 Agent intent 分布在 5 個角色——學生 S1/S2、老師 T1/T2、TA TA1、主任 D1/D2、餐廳 V1/V2。」

**手機動作**：關掉 AI Overlay 回到 TodayCockpit

---

## 1:30 – 2:30 ＿ 學生 cockpit + S1 ✦ Slide 11

**手機畫面**：學生 TodayCockpit

> 「先看學生角色。這是 TodayCockpit，上面這條 **AgentBanner** 是 5 個角色 cockpit 共用的入口。每個角色點進去都會看到自己的 AI 駕駛室。」

**手機動作**：**點 AgentBanner（中央 AI 待命中那條）**

**手機畫面**：跳轉到 AIAgentConsoleScreen，看到 hero / metric chips / 🛡️ AI 信任卡 / Autonomy Mode 三段

> 「Hero 顯示 AI 今天已代我完成幾件、4 個 metric chips、AI 信任卡入口、然後 Autonomy Mode 三段切換——assistive 完全詢問、collaborative 協作模式、autonomous 全自動。預設是協作模式。」

---

## 2:30 – 4:30 ＿ 老師 T1 主秀 ✦ Slide 12（demo 高潮 #1）

**手機動作**：點返回回到 cockpit → 點右上「學生」role pill → 選「教師·張怡君」

**手機畫面**：老師 TeacherCockpit（AI 教學中樞 / AI Agent 待命中）

> 「切到老師。AI 教學中樞顯示需要關注 7 位學生、缺繳 17 人次。下方 AI 已經整理好下一步——**一鍵核可請假**、**檢視 AI 預批成績**。我直接 demo T1『批量草擬評語』。」

**手機動作**：點 AgentBanner → 進 Console → 滑到底「新增 AI 代理任務」 → 點 **批量草擬評語 + 提醒缺繳**

**手機畫面**：Alert 跳出「🤖 AI 已準備好 plan / 5 份評語批量草擬 / 等你批准後 AI 才會開始執行」

> 「注意這個彈窗——這是 **Guardrail G3 高影響先問**。risk = medium、step 裡有 alwaysConfirm flag 的話，不管現在是不是全自動模式都會跳確認。」

**手機動作**：按 OK → 展開 Plan card → 看到 5 個 steps：
1. 對 5 份作業跑 aiPreReviewGrade 預判（low）
2. 對每份用 draftFeedback 草擬評語（medium）
3. 對 3 位缺繳學生跑 aiForecastBulkReminder（low）
4. 生成 5 條評語 + 3 條提醒 → awaiting（high）
5. 老師審計後 → emit feedback_drafted + bulk_reminder_sent（high）

> 「5 個 step，每一步都標 risk 等級、有 alwaysConfirm 標記。底下『批准 AI 開始執行』。」

**手機動作**：按 **✅ 批准 AI 開始執行** → AI 開始跑 5 個 step → 等 8–10 秒 → 跳出「✅ AI 已完成 / 全部 5 個步驟成功完成」

> 「AI 5 個步驟全部跑完，verify 自評通過。原本老師批改 5 份 + 提醒 3 個缺繳要 30+ 分鐘，現在 AI 草擬完只剩審閱送出。**這就是我們講的『AI Agent 代你跑事情』，不是『告訴你怎麼做』。**」

---

## 4:30 – 5:30 ＿ 跨角色：學生下單 → 餐廳即時 +1 ✦ Slide 15（demo 高潮 #2）

> 「接下來這段是整個系統最炫的部分——**跨角色 RoleEventBus 即時聯動**。」

**手機動作**：role pill → 切回**學生** → 校園 tab → 點 **餐廳** → 進 餐廳列表 → 點任一餐廳（例：靜宜中餐部）→ 加 1–2 個菜 → 結帳

**手機畫面**：訂單建立、彈出「下單成功」

> 「學生剛剛下單，這背後做了三件事：
> 1. 寫進 demoMerchantOrders in-memory store
> 2. 透過 RoleEventBus emit `order_placed` event
> 3. VendorDashboardScreen 訂閱了這個 event」

**手機動作**：role pill → 切到 **餐廳·阿櫻** → 立刻看到剛剛的訂單跳進去

**手機畫面**：餐廳 cockpit「靜宜中餐部」現在多出一筆新訂單（pending）

> 「2 秒內，餐廳這邊就收到新訂單。如果開兩支 iPhone 一邊學生一邊餐廳，這條鏈會即時跑——這在傳統的 LMS / chatbot 都做不到。」

---

## 5:30 – 6:30 ＿ TA / 主任 / 餐廳 agent ✦ Slide 13

**手機動作**：role pill → 切 **TA·林助教**

**手機畫面**：TA dashboard「AI 協助中樞 / 今日 2 份批改、1 串待回覆」

> 「TA 角色——AI 已經整理好今日 2 份手動批改 + 對學生問題草擬回覆。TA1 是『求助自動草擬回覆』：對學生在課程討論串提的問題用 aiSemanticReasoner 解讀、搜歷史、草擬。原本回覆要 30 分，現在 3 分。」

**手機動作**：role pill → 切 **系主任·黃主任**

**手機畫面**：主任 dashboard「AI 系所中樞 / 系所健康度 79%」

> 「主任端 D1 風險課程關懷、D2 本週系所重點。系所健康度即時計算，AI 從 RoleEvent 歸納 5 重點直接產出廣播稿，每週省 3 小時。」

**手機動作**：role pill → 切 **餐廳·阿櫻**

**手機畫面**：餐廳 cockpit（中餐部 / 校園咖啡屋 / 麵食館 3 個分頁）

> 「餐廳端 V1 久候自動補時——20 分鐘還沒出餐的訂單，AI 自動發折扣券給學生（low risk 全自動跑）。V2 尖峰前備料——AI 預測 30 分鐘後進尖峰，推員工 checklist。」

---

## 6:30 – 7:30 ＿ 校園生活 ✦ Slide 16

**手機動作**：role pill → 切回**學生** → 校園 tab

**手機畫面**：校園 hub（餐廳 / 圖書館 / 宿舍 / 校園公車 / 校園地圖 V2 / ...）

> 「校園 tab 是『實體生活』入口——這 9 格是物理服務，抽象功能交給 AI 球。」

**手機動作**：點 **校園公車**

**手機畫面**：BusV2「下班公車 14:20 / 還有 32 分鐘 / AI 摘要：你週四 17:30 後常坐 B 路線回家」

> 「BusV2 主打**沉浸搭車 + AI 學會你的習慣**——AI 摘要會記得你平常搭哪條，今天 B 路線只剩 2 班會主動建議改 A。下車前 1 站手機會 Haptics 震動提醒，不用一直盯著手機。」

**手機動作**：返回校園 hub → 點 **校園地圖 V2**

**手機畫面**：GoogleMapsLike（4 種底圖切換、POI 過濾）

> 「校園地圖 POC——4 種底圖、9 類別 POI、turn-by-turn 大箭頭 HUD、expo-speech 中文語音導航。視覺上最炫的一頁。」

---

## 7:30 – 8:30 ＿ 透明度 ✦ Slide 18 + Slide 19

**手機動作**：返回 → 學生 cockpit → AgentBanner → 進 Console → 點 **🛡️ AI 信任卡**

**手機畫面**：TrustCardScreen（AI 為你守住了什麼 / 41 信任分 / 推送 / 採納 / 自律擋下）

> 「最後是我們專題最重要的差異化——**AI 信任卡**。
>
> 每一次 AI 推送、每一次拒絕、每一次自律擋下，都會寫進 audit log。期末給學生看一份對帳單——『AI 推了你幾次、你採納幾次、AI 為你擋下幾次（12 次夜間 quietHours + 5 次上課中）』。
>
> 7 條 Guardrail——每日上限 8 次、信心閾值 60%、高影響先問、Quiet Hours、連拒煞車、killSwitch、Audit + Verify。AI 不是黑盒，它是可審計的工具。
>
> 業界——TronClass、ChatGPT、其他校園 App——目前**沒有人做這件事**。這也是我們認為 AI 在校園裡應該走的路。」

---

## 8:30 – 9:00 ＿ 收尾 ✦ Slide 28

**手機畫面**：停在 AI 信任卡 上，或回到學生 TodayCockpit

> 「總結：5 個 mobile cockpit、9 個 Agent intent、17 條跨角色事件、5 層 AI 架構、7 條 Guardrail、3 段 Autonomy、信任卡可審計。
>
> 我們做的不是 LMS 對手，我們做的是『校園駕駛艙』。
>
> 謝謝大家。」

---

## Tips

- **role pill 在右上角**，圖示是 ⇅ + 角色名（「學生」/「教師」/「TA」...）
- 切角色後**第一次**會跳「Failed to sync events: ReferenceError」紅字 → 已修，但若舊 bundle 還沒重 build 仍會出現，可手動按 X 關閉，**或在錄影前 cmd+R reload simulator 跑一次新 bundle**
- T1 plan 第一次點會看不到 5 個 step——要先**展開 plan card**（點右上箭頭）
- 跨角色下單 demo（5:30 段）建議**先把學生帳號的購物車預先放好 1 個品項**，這樣錄影時省下 30 秒挑菜
- 在 sim 切角色比實機快——iPhone 17 Pro Max sim 在 macOS 上點擊延遲 <100ms

## 失敗緊急 fallback

| 情境 | 處理 |
|---|---|
| AI Plan 卡在 executing | 等 12 秒；超過就 kill app 重來 |
| role 切了但畫面沒換 | 拉下 refresh、或關 app 重開 |
| 訂單沒跳到餐廳 | 講「在實機這條鏈會即時跑」，跳過這段不浪費時間 |
| Map tile 一直 blank | 講「離線 demo 不顯示 OSM tiles，本身 UI chrome / POI 都在」 |
