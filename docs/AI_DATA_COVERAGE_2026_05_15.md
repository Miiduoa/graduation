# AI 全資料覆蓋（2026-05-15）

> APP 主打 AI 代理一切，AI 必須掌握所有資料。本文盤點 APP 內所有 domain，逐一檢視 AI 整合等級。

## 1. 整合等級定義

| 等級 | 說明 |
|------|------|
| **native** | AI 直接演算，動作前後都過 AI（如 grade what-if、bulk reminder forecast） |
| **context** | AI 拿得到資料但不主動 orchestrate（如行事曆、好友） |
| **tool** | AI 可主動 invoke tool 取資料（如訂餐、借書） |
| **planned** | 規劃中，下一輪整合 |
| **static** | 純展示，無需 AI |

## 2. 全 APP Domain × AI 整合一覽（33 個）

詳見 `apps/mobile/src/services/aiDataInventory.ts` 的 `AI_DATA_INVENTORY` 陣列，每個 entry 含：
- `key` / `label`
- `roles`：哪些角色用
- `screens`：實際 screen 檔名
- `level`：整合等級
- `aiKnowledge`：AI 能從這 domain 知道什麼
- `aiAction`：AI 能對 domain 做什麼動作
- `snapshot`：對應 buildWideAISnapshot 的 key

### 33 個 domain 速覽

**學習核心（7）**：課程 (native)、點名 (native)、討論 (context)、互評 (context)、錯題本 (native)、筆記 (planned)、AI 學伴 (native)

**校園生活（8）**：餐廳 (tool)、圖書館 (tool)、交通 (context)、地圖 (context)、健康 (tool)、宿舍 (context)、失物 (context)、列印 (tool)

**社群 / 訊息（4）**：公告 (context)、活動 (context)、社群 (context)、訊息 (tool)、朋友 (context)

**時間 / Gamification（4）**：行事曆 (tool)、精靈花園 (native)、星圖 (context)、成就 (context)

**學業 / 個人（3）**：學業總覽 (native)、學分審查 (context)、個人設定 (context)

**管理 / 服務（4）**：教師工作台 (native)、系所管理 (native)、餐廳管理 (native)、職員工作台 (context)

**公共 / 輔助（4）**：全域搜尋 (tool)、通知 (native)、離線佇列 (context)、幫助 (tool)

## 3. AI 覆蓋率

`aiDataInventoryStats()` 計算：

```
總 domain：33
native：10
context：14
tool：8
planned：1（筆記 AI 摘要）
static：0
整合率（native + context + tool）：32 / 33 ≈ 97%
```

## 4. AI 入口與工具

### 已有 AI Tools（11 個）

| Tool | 對應引擎 |
|------|---------|
| `grade_predict_what_if` | gradePredictor.simulateWhatIf |
| `study_plan_today` | studyPlanner.planStudy |
| `mistake_due_today` | mistakeRepertoire.recommendDailyPracticeSet |
| `urgent_notifications` | notificationPlanner.planNotifications |
| `socratic_hint` | socraticCoach.fallbackHint |
| `ai_full_context` | aiContextBuilder.buildFullAIContext |
| **`ai_data_inventory`** (新) | aiDataInventory.buildWideAISnapshot |
| `order_food` / `borrow_book` / `reserve_seat` / `send_message` / `create_reminder` / `create_health_appointment` / `create_print_job` | 既有 |

AI 對話時可主動呼叫，動作前後都會過 orchestrator。

### AI Orchestrator（7 個演算介面）

`aiOrchestrator.ts`：
- `aiPreReviewGrade` — 老師批改前預測學生成績變化、是否進 risk
- `aiForecastBulkReminder` — 預測補交率、檢查 tone 配置
- `aiSummarizeStudentInbox` — 學生 inbox 即時摘要
- `aiCommentOnWhatIf` — 學生改假設分數的即時回饋
- `aiDepartmentHealthScore` — 系所健康度評分
- `aiVendorNextAction` — 餐廳下一步建議
- `aiRecomputeStudentPlanAfterEvent` — 任何 RoleEvent 後重算學生計畫

## 5. AI Wide Snapshot

`buildWideAISnapshot(uid)` 一次拉出所有 domain 的精簡狀態：

- courses（5 門 + 待繳作業 / 考試）
- mistakes（總題 / 已熟練）
- companion（精靈 storage 摘要）
- notes（跨課筆記計數）
- messagesInbox（roleEvent inbox 計數）
- profile（個人偏好）
- 其他 27 個 domain 標 `available: true` 並指示可透過對應 AI Tool 即時取資料

每次 `buildFullAIContext` 自動包含 wide snapshot，AI system prompt 直接看得到。

## 6. 角色聯動（cross-role data flow）

```
┌─ 老師端 ──────────────────────────────┐
│  TeacherCockpit                       │
│    └─ aiPreReviewGrade 預測影響      │
│    └─ aiForecastBulkReminder 預檢    │
│    └─ emitFeedbackDrafted →           │
│    └─ emitBulkReminder →              │
└──────────────────┬───────────────────┘
                   │ RoleEventBus
                   ▼
┌─ 學生端 ──────────────────────────────┐
│  TodayCockpit                         │
│    └─ loadRoleEventInbox             │
│    └─ aiSummarizeStudentInbox 即摘要 │
│    └─ aiRecomputeStudentPlan 重排     │
│    └─ Hero 顯示「來自老師」推薦動作 │
└───────────────────────────────────────┘

       ⇆ 雙向：學生繳交 → 老師收到 grade_published（規劃中下一輪實作）
```

## 7. 測試

新增 `__tests__/aiDataInventory.test.ts` 7/7 全綠：
- 至少 30 個 domain
- 每個 entry 必填欄位完整
- 6 個核心 domain 是 native level
- 覆蓋率 ≥ 80%
- buildWideAISnapshot 不會 throw
- promptLine 含覆蓋率 + 課程數 + 錯題

加上之前 18 條 aiOrchestrator 測試 → 共 25 條新 AI 測試全綠。

## 8. 下一輪

- planned (1)：筆記 AI 摘要 + 跨課全文搜尋（task 153）
- 把 RoleEventBus 反向：學生動作（繳交 / 簽到）→ 老師 inbox（task 169）
- 把 AI Orchestrator 接到實際 chatWithAI 的 system prompt（task 170）
