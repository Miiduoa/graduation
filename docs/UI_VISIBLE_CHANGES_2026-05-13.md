# 變更可見清單（重啟 APP 後肉眼可確認）

> 你說「看不見變更」很可能是 hot reload 沒抓到。請：
>
> 1. 在 Expo Dev Tools 按 `R` 或拖下重新整理
> 2. 還不行就完全關 APP（從多工列滑掉）再重開
> 3. 還不行就 `npx expo start --clear`
>
> 重啟後依下表逐項確認 — 每一項都是這幾輪做出來、肉眼能看到的變更。

## 一、打開 APP 第一頁（Today / 今天）

| 位置 | 你會看到 |
|------|---------|
| Greeting Header 下方 | **3 個彩色大方塊**：🦊 校園精靈（橘）/ ⚠️ 學習風險（紅）/ ✨ AI 學伴（深藍） |
| 再下方 | CompanionStrip（精靈狀態條） |
| 中段 | AI 智慧日報、本日課程、待辦 |
| 點 🦊 校園精靈 | 跳 CompanionScreen — 精靈狀態 / 4 需求 / careHint / 花園 / 解鎖 |

## 二、學習 tab → 我的課程 → 「課程」分頁

| 位置 | 你會看到 |
|------|---------|
| 頂端 tab 下方 | **「本週需注意」AI 摘要橫條**（紅 / 黃 / 藍依緊急度） |
| 每張課程卡 | **8 個 chip**（從左到右）：📚 教材 / ❓ 測驗 / 📊 成績 / ✅ 點名 / 💬 討論 / ✨ AI 學伴 / 📝 筆記 / 💯 互評 |
| 點 💬 討論 | 跳 CourseDiscussion — 本地討論串、無 navigation error |
| 點 📝 筆記 | 跳 CourseNotes — 本地筆記本 + 標籤 + 匯出 |
| 點 💯 互評 | 跳 PeerReviewSubmit — Rubric 打分 + 即時預覽 |

## 三、學習 tab → 我的課程 → 「作業」分頁

| 位置 | 你會看到 |
|------|---------|
| 待辦作業卡 | 點下去 **不再跳教材模組**，直接跳 **HomeworkSubmit（本地繳交）**：標題、截止倒數、寫文字、附檔案、送出 |
| 已交過的作業 | 點下去仍跳 CourseModules 看詳情 |

## 四、學習 tab → 任何課程 → 教材

| 位置 | 你會看到 |
|------|---------|
| 點任何 PDF / 影片 / 連結 | **不再跳出 APP 到 TronClass 網頁**，改開 CourseMaterialViewer（in-app webview） |
| 原本「在 TronClass 查看完整成績」 | 文案改成「**在 APP 內查看完整成績**」 |
| 影片 | 跳 VideoMaterial — expo-av 原生播放 + 進度紀錄 |

## 五、我的 → 個人主頁

| 位置 | 你會看到 |
|------|---------|
| 列表中段 | **3 個新 ListRow**：校園精靈 / 我的收藏 / 校園星圖 |
| 點校園精靈 | CompanionScreen |
| 點我的收藏 | CompanionCollectionScreen — 22 個成就 + 進度條 + 即將解鎖 |
| 點校園星圖 | ConstellationScreen — 校園地圖變星座 + 季節限定 |

## 六、Web 教師端（apps/web）

| 位置 | 你會看到 |
|------|---------|
| `/teacher/course/[courseId]` 課程總覽 | **新增 6 個工具按鈕**：教材 / 測驗 / 題庫 / Rubric / 點名 / 成績簿 |
| `/teacher/course/[courseId]/rubrics` | Rubric editor + 即時加權預覽 |
| `/teacher/course/[courseId]/question-banks` | 題庫 CRUD + 健康檢查警示 + 抽題預覽 |
| `/teacher/course/[courseId]/gradebook` | 加權成績簿 + 即時計算 + 發布按鈕 |
| `/teacher/course/[courseId]/quizzes` | 測驗發布管理 |
| `/teacher/course/[courseId]/attendance` | QR 點名啟動 |
| `/teacher/course/[courseId]/modules` | 教材單元管理 |

## 七、實際在 APP 內可以做的事（不再被踢到 TronClass）

- ✅ 看課程列表、課程詳情
- ✅ 看教材 PDF / Word / 連結
- ✅ 看教材影片（原生播放 + 進度）
- ✅ **繳交作業**（文字 + 附件）
- ✅ **作答測驗**（自動計分）
- ✅ **完成課程問卷**（單複選 / 量表 / 文字）
- ✅ **發課程討論 / 回覆**
- ✅ **送同儕互評**（Rubric 打分）
- ✅ **寫課程筆記**（標籤、過濾、匯出）
- ✅ **掃 QR 簽到**
- ✅ 看成績（本地計算加權）
- ✅ **教師批改作業**（mobile 端 Rubric）
- ✅ 看校園精靈、學習花園、星圖、收藏成就
- ✅ AI 學伴對話

## 八、新加的所有檔案（驗證用，可進 git diff 看）

### Mobile 新畫面（11 個）

```
apps/mobile/src/screens/
├── CompanionScreen.tsx          ← 校園精靈主畫面
├── CompanionCollectionScreen.tsx ← 我的收藏（22 個成就）
├── ConstellationScreen.tsx       ← 校園星圖
├── CourseMaterialViewerScreen.tsx ← 取代 WebBrowser 跳出
├── CourseDiscussionScreen.tsx    ← 本地討論串
├── HomeworkSubmitScreen.tsx      ← 本地作業繳交
├── VideoMaterialScreen.tsx       ← 本地影片播放
├── SurveyScreen.tsx              ← 本地問卷
├── PeerReviewSubmitScreen.tsx    ← 本地同儕互評
├── TeacherGradingScreen.tsx      ← mobile 教師批改
└── CourseNotesScreen.tsx         ← 本地筆記
```

### Mobile 新服務（4 個）

```
apps/mobile/src/services/
├── companionSignalRecorder.ts   ← 信號錄製
├── companionHooks.ts             ← 29 個 hook 對應 APP 各動作
├── inboxActions.ts               ← 收件匣可執行動作解析
└── learningRiskService.ts        ← 風險雷達 wired
```

### Mobile 修改的既有畫面（3 個）

```
apps/mobile/src/screens/
├── CoursesHomeScreen.tsx         ← 課程卡 chips 從 3 個 → 8 個 + 本週需注意橫條 + 作業點開跳本地繳交
├── PersonalHubScreen.tsx         ← 新加 3 個 ListRow（精靈/收藏/星圖）
├── SmartDashboardScreen.tsx      ← Today 加 3 個彩色快速入口
├── CourseModulesScreen.tsx       ← 11 個 WebBrowser 改成 in-app
└── LearnStack.tsx                ← 註冊 9 個新 route
```

### Web 新頁面（6 個）

```
apps/web/src/app/teacher/course/[courseId]/
├── modules/page.tsx
├── quizzes/page.tsx
├── attendance/page.tsx
├── gradebook/page.tsx
├── rubrics/page.tsx
└── question-banks/page.tsx
```

### 純函式引擎（12 個 + 對應測試）

```
packages/shared/src/
├── lms/
│   ├── quizScoring.ts
│   ├── gradebookCompute.ts
│   ├── rubricScoring.ts
│   ├── riskRadar.ts
│   ├── discussionEngine.ts
│   ├── questionBank.ts
│   ├── tronclassAdapter.ts
│   └── actionGraph.ts
└── companion/
    ├── spriteEngine.ts
    ├── gardenEngine.ts
    ├── achievements.ts
    └── signalAggregator.ts
```

### 後端 Cloud Functions（4 個新 callable）

```
backend/functions/agent/tools/
├── submitQuizAttempt.js
├── computeGradebook.js
├── computeCompanionState.js
├── upsertQuestionBank.js
├── draftQuizFromBank.js
└── upsertRubric.js

backend/functions/companion/
└── aggregateCompanionSignals.js (nightly cron)
```

### 設計文件（7 份）

```
docs/
├── AI助理測試訓練報告.md
├── TRONCLASS_PARITY_INTEGRATION_MAP.md
├── TRONCLASS_PARITY_ROADMAP.md
├── CAMPUS_COMPANION_DESIGN.md
├── CAMPUS_COMPANION_INTEGRATION_MAP.md
├── TRONCLASS_TO_APP_DATA_FLOW.md
├── TRONCLASS_LOCAL_COVERAGE.md
└── UI_VISIBLE_CHANGES_2026-05-13.md（本檔）
```

## 九、若你依然看不見變更的可能原因

1. **Metro bundler 沒重啟** — 試 `pkill -9 -f metro` 然後 `npm start --reset-cache`
2. **舊版 build 在用** — 試 `npx expo start --clear`
3. **連到舊伺服器** — 試 `expo r -c`
4. **Hot reload 抓不到 navigator 變更** — Stack screen 註冊變動需要完整 reload，不是 hot reload

## 十、測試證據

```
backend agent jest:        122 / 122 ✓
mobile 純函式引擎:          94 / 94 ✓
screenFirebaseBoundary:     1 / 1 ✓
總計:                       217 條 ✓
```
