# AI Service 收斂計畫（2026-05-15）

> 現況：`apps/mobile/src/services/` 共有 **34 個 AI / agent 相關檔案、26,361 行**。
> 重複嚴重，新加入的開發者搞不清楚該用哪一個。
> 本文件提出 **5 個核心 service + 1 個 facade** 的收斂目標。

---

## 一、現況盤點

```
ai.ts                       4161 lines  ← 巨型 API 層（Gemini call、prompt routing）
aiAgentTools.ts             3529 lines  ← Function Calling tool 定義（與 aiToolRegistry 重複）
aiLocalAgent.ts             3004 lines  ← 本地代理 v2
aiToolRegistry.ts           2300 lines  ← 工具註冊（與 aiAgentTools 重複）
aiAppContext.ts             1369 lines  ← Context builder（與 aiContextBuilder 重複）
aiToolLayer.ts              1011 lines  ← Tool abstraction layer
aiRealtimeAnalytics.ts       968 lines  ← 即時資料運算
agentReasoningEngine.ts      759 lines  ← Plan-Execute-Verify
aiActionExecutor.ts          738 lines  ← 動作執行（與 aiSkillApplicator 部分重複）
aiSemanticReasoner.ts        641 lines  ← 語意推理（與 aiThinking 部分重複）
aiSmartActions.ts            546 lines  ← 智慧行動
aiBrain.ts                   535 lines  ← 統一 AI 入口（理論上是 facade，但和 ai.ts 重複）
aiOrchestrator.ts            458 lines  ← 動作前後演算（核心，留）
aiCrossModuleInference.ts    440 lines  ← 跨模組推理
aiContinualLearning.ts       422 lines  ← 持續學習（與 aiLearning 重複）
aiThinking.ts                404 lines  ← 思考引擎（核心，留）
aiSkillApplicator.ts         392 lines  ← Guardrail（核心，留）
aiActiveLearning.ts          ~        ← 主動學習（與 aiLearning 部分重複）
aiAmbientAwareness.ts        ~        ← RE-EXPORT STUB（已 deprecated）
aiAgentOrchestrator.ts       ~        ← DEPRECATED STUB
aiDataInventory.ts           549 lines  ← 33 個 domain 盤點
aiProactiveThinker.ts        ~        ← 主動思考（與 proactiveAIAgent 重複）
aiReflexion.ts               ~        ← Reflexion 模式
aiRealtimeSync.ts            ~        ← Firestore 同步（與資料層耦合）
aiSelfDialog.ts              ~        ← 自我對話評估（測試用）
aiSelfDialogMultiTurn.ts     ~        ← 多輪自我對話
aiDynamicTraining.ts         ~        ← 動態訓練 hooks
aiLearning.ts                ~        ← 學習引擎（核心，留）
aiContextBuilder.ts          ~        ← Context builder（核心，留）
aiStudyBuddyMatcher.ts       558 lines  ← 學伴配對（本輪新加，留）
aiTrustCard.ts               ~        ← 信任卡（本輪新加，留）
agentReasoningEngine.ts      759 lines  ← 規劃推理
agentToolkit.ts              ~        ← 工具集
agentWrite.ts                ~        ← 寫入工具
```

---

## 二、收斂目標：5 核心 + 1 facade

### 留下（核心 6 個 service，預估 ~3,000 行）

| 檔案 | 角色 | 為什麼留 |
|------|------|---------|
| `aiThinking.ts` | **思考引擎** — observe / infer / tradeoff / rank / explain | 純函式 + 完整 test，唯一思考層 |
| `aiLearning.ts` | **學習引擎** — recordInteraction / discoverPatterns / selfReflect | 純函式 + 完整 test，唯一學習層 |
| `aiSkillApplicator.ts` | **Guardrail 應用** — evaluateGuardrails / applySkills / audit log | 唯一守門層，與 dynamicQuietHours 串接 |
| `proactiveAIAgent.ts` | **主動掃描** — scanForStudent / Teacher / TA / Department / Vendor | 5 角色入口，與 cockpit 緊耦 |
| `aiOrchestrator.ts` | **動作前後演算** — aiPreReviewGrade / aiVendorNextAction / aiForecastBulkReminder | 教師端 / 餐廳端動作的 calibration 層 |
| `aiContextBuilder.ts` | **Context 組裝** — buildFullAIContext | Context 唯一來源 |

### 留下（功能 service 4 個）

| 檔案 | 角色 |
|------|------|
| `aiStudyBuddyMatcher.ts` | 學伴配對（本輪新加） |
| `aiTrustCard.ts` | 期末信任卡（本輪新加） |
| `dynamicQuietHours.ts` | 動態 quiet hours（本輪新加） |
| `vendorPredictor.ts` | 餐廳預測（本輪新加） |
| `aiDataInventory.ts` | 33 domain 盤點，給 AI tools 用 |

### 新增（facade 1 個）

| 檔案 | 角色 |
|------|------|
| `aiFacade.ts` 🆕 | **單一進入點** export 上述所有 service 的 public API，未來 import 都從這裡來，方便重構 |

### 合併 / 砍掉（18 個檔案）

| 來源 | 處置 | 為什麼 |
|------|------|--------|
| `ai.ts` (4161 行) | **拆分**：純 API call 留下 → `aiTransport.ts`；prompt routing 併入 `aiOrchestrator` | 4000 行混 routing / call / parsing，難維護 |
| `aiBrain.ts` (535 行) | **砍掉**：「統一 AI 入口」這個概念由 `aiFacade.ts` 取代 | 名字像 facade 但實作和 ai.ts 重疊 |
| `aiAgentOrchestrator.ts` | **直接刪除** | 已標 `DEPRECATED STUB` |
| `aiAmbientAwareness.ts` | **直接刪除** | 已標 `RE-EXPORT STUB` |
| `aiProactiveThinker.ts` | **砍掉** | 與 `proactiveAIAgent` 重複，前者 dead code |
| `aiContinualLearning.ts` (422 行) | **併入** `aiLearning.ts` | 同一概念分兩處 |
| `aiActiveLearning.ts` | **併入** `aiLearning.ts` | 主動學習其實是 reaction-based，已在 aiLearning |
| `aiSemanticReasoner.ts` (641 行) | **併入** `aiThinking.ts` | 語意推理是思考的子集 |
| `aiCrossModuleInference.ts` (440 行) | **併入** `aiThinking.ts` | 跨模組推理是思考的應用 |
| `aiSmartActions.ts` (546 行) | **併入** `aiOrchestrator.ts` | 智慧行動是 action 前演算 |
| `aiActionCoordinator.ts` | **併入** `aiOrchestrator.ts` | 同一概念 |
| `aiActionExecutor.ts` (738 行) | **拆分**：執行 → `aiSkillApplicator`；動作 schema → `aiOrchestrator` | 兩種職責塞同一檔 |
| `aiToolLayer.ts` (1011 行) | **併入** `aiToolRegistry.ts` | tool 抽象只該有一個 |
| `aiAgentTools.ts` (3529 行) | **併入** `aiToolRegistry.ts` | 兩處都在註冊 tools |
| `aiAppContext.ts` (1369 行) | **併入** `aiContextBuilder.ts` | Context 應該只有一個出處 |
| `aiSelfDialog.ts` + `aiSelfDialogMultiTurn.ts` | **移到** `__tests__/` 下，作為測試 fixture | 本來就是評估用，不是 runtime |
| `aiDynamicTraining.ts` | **檢視後決定**：若沒被 UI 呼叫 → 砍 | 看似 training pipeline，但 mobile app 不該做 training |
| `aiRealtimeAnalytics.ts` (968 行) | **保留但拆分**：放到 `analytics/` 子目錄 | 不是 AI core，是 dashboard 用 |
| `aiRealtimeSync.ts` | **移到** `services/firestore/` 子目錄 | 是資料同步不是 AI |
| `aiLocalAgent.ts` (3004 行) | **保留但拆分** | 本地代理 v2 是真實功能，但 3000 行太肥 → 拆 4 個檔 |
| `agentReasoningEngine.ts` (759 行) | **併入** `aiThinking.ts` | Plan-Execute-Verify 是思考的執行模式 |
| `agentToolkit.ts` / `agentWrite.ts` | **併入** `aiToolRegistry.ts` | 是 agent 用的 tool subset |

**預期成果**：34 檔 / 26K 行 → **10-12 檔 / ~8-10K 行**（壓縮 65%+）。

---

## 三、分階段執行建議

### Phase 1（低風險，可立即做，預估 1 天）

1. 刪除已標 deprecated 的檔案（`aiAgentOrchestrator`, `aiAmbientAwareness`）
2. 把 `aiSelfDialog*` 移到 `__tests__/`
3. 把 `aiRealtimeSync` 移到 `services/firestore/`
4. 在 `aiFacade.ts` 統一 re-export 6 個核心 service

**驗證**：跑全套 tests，無 import error → 通過。

### Phase 2（中風險，預估 2-3 天）

1. 把 `aiContinualLearning` + `aiActiveLearning` 內容併入 `aiLearning`
2. 把 `aiCrossModuleInference` + `aiSemanticReasoner` 併入 `aiThinking`
3. 把 `aiActionCoordinator` + `aiSmartActions` 併入 `aiOrchestrator`
4. 把 `aiAppContext` 併入 `aiContextBuilder`

**驗證**：
- 每併一個跑一次 `tsc --noEmit`
- 每併一個跑相關 test suite
- import 都從 `aiFacade` 走，避免 deep import

### Phase 3（高風險，要重構，預估 1 週）

1. 拆 `ai.ts`（4161 行）→ `aiTransport.ts` + 部分 routing 進 `aiOrchestrator`
2. 拆 `aiAgentTools.ts`（3529 行）→ 整併到 `aiToolRegistry`
3. 拆 `aiLocalAgent.ts`（3004 行）→ 4 個檔（核心 / tools / context / dialog）

**驗證**：
- E2E（Maestro flows）必須跑過
- 對 demo 7 分鐘腳本走一次手動測試
- 對 demo 帳號跑一次 proactive scan，確認 suggestion 數量不變

### Phase 4（dead code 清掃）

ts-prune / depcheck 找出沒被 import 的 export，逐一移除。

---

## 四、新檔依賴圖（收斂後）

```
┌──────────────────────────────┐
│ UI Screens / Cockpits        │
└────────────────┬─────────────┘
                  │
                  ▼
       ┌──────────────────────┐
       │  aiFacade.ts         │  ← 唯一進入點
       └──────────┬───────────┘
                  │
       ┌──────────┼──────────┬────────────┬────────────┐
       ▼          ▼          ▼            ▼            ▼
   aiThinking aiLearning aiSkill...  proactive  aiContext...
                          │              │
                          ▼              ▼
                  dynamicQuietHours  aiOrchestrator
                                         │
                                         ▼
                            (vendorPredictor, aiTrustCard, ...)
```

每層職責清楚：
- **Layer 0**: 純資料 (`aiDataInventory`, `aiContextBuilder`)
- **Layer 1**: 純運算 (`aiThinking`, `aiLearning`, `dynamicQuietHours`, `vendorPredictor`)
- **Layer 2**: 守門 (`aiSkillApplicator`)
- **Layer 3**: 編排 (`aiOrchestrator`, `proactiveAIAgent`)
- **Layer 4**: facade (`aiFacade`)
- **Layer 5**: UI

---

## 五、ROI 預估

| 收益 | 量化 |
|------|------|
| Codebase 行數縮減 | **−65%**（26K → ~9K） |
| 新進開發者 onboarding 時間 | **−50%**（不用看 34 檔猜哪個是真的） |
| TypeScript 編譯時間 | **−30%**（少 18 個檔案） |
| Bundle 大小（mobile） | **約 −1.5 MB**（依現有 tree-shake 效果） |
| 維護心智成本 | **顯著降低**：所有 import 走 facade，重構不會 ripple |
| 測試 coverage 提升 | **+15%**（少了 dead code 後分母變小） |

---

## 六、什麼時候 **不該** 做收斂

- 學期最後 2 週（demo / 口試前）— 凍結期，不動 codebase
- 沒有完整 e2e test 涵蓋率時（會炸）
- 一個人單獨做的話 — 至少要有 reviewer 看 PR

---

*建議在學期結束、demo 過後第 1 週執行 Phase 1-2，第 2-3 週執行 Phase 3。*
*Phase 4 持續進行。*
