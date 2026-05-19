# 校園整合應用 App · 口試交付包 v2

> 2026-05-16 重產 / 口試 5/23 / 組員：周攸晨、顧晉瑋、楊世堅、吳容陞

## v2 vs v1 主要變動

過去一週 15 個 commit + AI-Core 大改版，v1 全部過時。v2 反映**真實當前狀態**：

| 面向 | v1 | v2 |
|------|------|------|
| 角色數 | 5 mobile | 5 mobile + 8 Web 角色 |
| AI 架構 | 三層腦 | 5 層：Perceive / Think / Act / Background / Learn |
| AI service | 11 個 | 27 個有實作（避講 5 個 dead stub） |
| 新畫面 | 無 | AIStudyBuddy / BusV2 / OnBusMode / GoogleMapsLike / Web admin |
| Demo 長度 | 7 分鐘 | 10 分鐘 |
| 影片數 | 8 段 | 13 段 |
| 截圖數 | 10 張 | 18 張 |
| PPT 張數 | 14 張 | 22 張（內容更豐富） |

## 4 份 v2 檔案（都在 /Users/miiduoa/Desktop/畢業專題/）

| 檔案 | 內容 |
|------|------|
| `口試簡報_v2.pptx` | 22 張，含：架構圖、AI 5 層 deep dive、8 角色梳理、5 cockpit 各 1 頁、3 新功能 deep dive、guardrail + 信任卡、10 分鐘 timeline、Roadmap |
| `口試Demo主持腳本_v2.docx` | 10 分鐘逐秒主持稿 + v2 變動摘要 + 4 組員分工 + 環境準備 + 拍攝清單 + 10 條 Q&A + 最後 checklist |
| `角色資料畫面對照矩陣_v2.xlsx` | 9 個 sheet：總覽 / 5+8 cockpit / 14 事件 / AI 5 層 / 新畫面 / 10 分鐘逐秒 / 拍攝分鏡 / 7 guardrail / NBA+aiBrain |
| `口試交付包_README_v2.md` | 本檔 |

## 真實 AI 架構（避免講錯）

```
Perceive 感知 → Think 思考 → Act 動作 → Background 掃描 → Learn 學習
       ↓             ↓           ↓             ↓              ↓
        ┌──── aiBrain Hub（singleton, getAIBrain）───────────┐
```

**27 個有實作的 AI service**（按層分）：
- **Perceive**: aiAppContext / aiRealtimeSync / aiCrossModuleInference / aiRealtimeAnalytics / aiContextBuilder
- **Think**: aiOrchestrator (8 funcs) / aiThinking / aiSemanticReasoner / aiReflexion / aiDynamicTraining
- **Act**: aiActionCoordinator / aiSkillApplicator / aiLocalAgent / dynamicQuietHours / aiTrustCard
- **Background Scan**: proactiveAIAgent
- **Learn**: aiContinualLearning / aiActiveLearning / aiLearning
- **Hub**: aiBrain
- **NBA pipeline**（獨立）: campusAgentSource.listNextBestActions

**⚠️ Demo 時不要提的 dead stub**（敵意提問時也別認）：
- aiAgentOrchestrator（全 no-op）
- aiAmbientAwareness（純 re-export）
- agentToolkit、agentWrite（stub）
- agentReasoningEngine（完整實作但無人 import，可講「下一階段」）

## 8 角色（注意：mobile 5 vs Web 8）

| Mobile（5 主要）| Web 多 3 |
|------|------|
| 🎓 學生 顧晉瑋 | 🏃 社團幹部 |
| 👨‍🏫 老師 張怡君 | ⚙️ 系統管理員 |
| 🧑‍💼 助教 林助教 | 🎓 校友（read-only） |
| 🏛 主任 黃主任 | 👤 訪客（未登入） |
| 🍱 餐廳 阿英 | |

口委會問「5 vs 8」標準答案：「mobile 是每天打開的核心 5 種使用者；Web 端為了照顧到瀏覽器查詢的人（校友、訪客、社團幹部、系統管理員）擴成 8 種。」

## 13 段影片 + 18 張截圖

**影片 V01-V13**：8-30 秒不等，按拍攝清單錄。**截圖 S01-S18**：iPhone native 解析度。

**必拍的關鍵 4 段**（其他可後製）：
1. **V03** — AI 起草評語 Modal（AI banner + forecast 65→72）
2. **V05** — 雙手機並排：學生下單 / 餐廳即時跳
3. **V09** — AI 學伴配對嚴格模式 + 邀請 Alert
4. **V12** — Web 8 角色切換 + alumni 攔截卡

存到 `/Users/miiduoa/Desktop/畢業專題/demo-media/`，照檔名規範。PPT 已預留 placeholder。

## 4 組員分工（重新分配）

| 組員 | 主負責 | demo 操作時段 | 口頭講解 |
|------|--------|---------------|---------|
| **周攸晨** | 🎓 學生 + 校園生活 | 2:30 切學生 → 3:00 AI 學伴 → 4:30 BusV2 → 5:00 OnBusMode → 6:00 學生下單 → 7:15 / 8:30 收公告 | AI 駕駛艙概念、跨角色 inbox |
| **顧晉瑋** | 👨‍🏫 老師 + AI 編排 | 0:00 老師 cockpit → 0:30 AI 預判補交率 → 1:30 AI 起草評語 | 主軸講者：RoleEventBus、aiOrchestrator、7 條 guardrail、信任卡 |
| **楊世堅** | 🍱 餐廳 + 設計 | 5:30 切阿英 → 6:30 訂單即時 +1 → 6:45 推進三段 | demoActionSimulator + AI 應用層 + Guardrail |
| **吳容陞** | 🏛 主任 + Web + Q&A | 7:30 切主任 → 8:00 廣播 → 8:50 Web 多身份 → 9:30 GoogleMapsLike | 技術棧、vs TronClass、商轉、Q&A 主答 |

## 5/23 之前要做的事

### 必做（本週末前）
1. **錄 13 段影片 + 18 張截圖**（照拍攝清單分工）
2. **AIStudyBuddyScreen 接 navigator**（目前沒掛在 nav stack）
3. **`npm install expo-speech`**（GoogleMapsLike 導航 HUD 需要）
4. **demo 前 5 分鐘從 AIAgentObservatoryScreen 觸發 simulator**：simulateFullGradingCycle + simulateStudentRequestHelp(high) + simulateStudentPostDiscussion + simulateTeacherPublishHomework

### 選做
- 修 `proactiveAI.test.ts` 的 `30 分鐘後` 失敗（時區或 mock data）
- 修 AIAgentObservatoryScreen 的舊 type 不一致
- vendorPredictor 接進 VendorDashboard hero（如果有時間 → 多一個賣點）

## 簡報注意事項

- 字體用 **PingFang TC**（macOS / Office 內建）。LibreOffice 預覽會把 emoji 變豆腐字 □，但真實 PowerPoint / Keynote 開啟 emoji 會正常顯示。
- 22 張 PPT 已預留所有實機影片 / 截圖 placeholder，檔名都對得上，錄完直接拖進去即可。
- 投影建議用 Keynote 開啟（顯示效果最好），不要用 LibreOffice。

## 加油！

> 5/23 不只演 demo，是把這整套「校園駕駛艙」概念講清楚。
> 我們不是 LMS 對手，是 LMS 之上的 AI 編排層。

