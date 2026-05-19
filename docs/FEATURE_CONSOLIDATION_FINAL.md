# 功能整合計畫 — 重複入口去除策略（口試最終版）

> **問題**：App 跑得太久，同一件事有 3-4 個入口，使用者迷路。
>
> **解法**：每個「動作類型」只留一個權威入口，其他做為 alias，
> 透過 LearnStack 的別名機制把舊路由都導向同一個 dispatcher。

---

## 1. 成績相關（4 → 1）

| 舊入口 | 用途 | 整合後 |
|---|---|---|
| `GradesScreen` | 通用成績列表 | ⇒ `AcademicScreen?initialTab=grades` |
| `CourseScoresScreen` | 單門課成績 | ⇒ `AcademicScreen?initialTab=gradebook&courseId=X` |
| `CourseGradebookScreen` | 教師成績簿 | ⇒ `AcademicScreen?initialTab=gradebook&courseId=X`（角色感知） |
| `AcademicScreen` | **統一入口（保留）** | 內建 4 個 tab：grades / insights / gradebook / analytics |

**實作對照**：`LearnStack.tsx` 已用 `withAcademicInitialTab(tab)` HOC
把 `Grades`、`AcademicInsights`、`CourseGradebook`、`LearningAnalytics`
四個路由全部映射到同一個 `AcademicScreen`，依 `initialTab` 切換。
**結論**：路由層已整合，無需再改。

---

## 2. 課程入口（3 → 2）

| 舊入口 | 用途 | 整合後 |
|---|---|---|
| `CourseCatalogScreen` | 課綱查詢／加選 | **保留**（查詢專用） |
| `CourseHubScreen` | 我的課程詳情 | **保留**（已選課的詳情） |
| `CoursesHomeScreen` | 課程首頁 | **保留**（透過 LearnHomeDispatcher） |
| `AcademicScreen` 內嵌課程清單 | 重複 | **移除嵌入**，改連結到 `CourseHub` |

---

## 3. 討論區（4 → 2）

| 舊入口 | 用途 | 整合後 |
|---|---|---|
| `CourseDiscussion` | 課程討論列表 | **保留**（入口） |
| `DiscussionThreadDetail` | 單一執行緒 | **保留**（細節） |
| `GroupDetail` 內嵌貼文 | 重複 | 點貼文連到 `DiscussionThreadDetail` |
| `GroupPostScreen` | 群組貼文 | **保留**（社團群組用） |

---

## 4. AI 對話 / 助理（5 → 2）

| 舊入口 | 用途 | 整合後 |
|---|---|---|
| `AIFloatingBall` + `AIOverlayHost` | **全域 AI 對話（保留）** | **唯一**的對話入口 |
| `AIAgentConsoleScreen` | 開發者觀察台 | **保留**（給工程師看 trace） |
| `AIChatScreen` | 舊聊天頁 | 改為 alias 到 `AIOverlay.open({ mode: 'chat' })` |
| `AIModelManagerScreen` | 模型管理 | 移到設定頁子分頁 |
| `CompanionScreen` | 學伴對話 | 改為「學伴」是 AIChat 的一個 mode |

**使用者心智模型**：
- 「想跟 AI 講話」 → **永遠按中央那顆球**
- 「看 AI 在背後做什麼」 → 開發者觀察台
- 沒有第三種

---

## 5. 學業風險（2 → 1）

| 舊入口 | 用途 | 整合後 |
|---|---|---|
| `StudentRiskScreen` | 系主任專用風險面板 | ⇒ `AcademicOverview?tab=risk` |
| `SmartDashboardScreen` 學業風險區 | 學生自己的風險（柔和呈現） | **保留**（角色不同表現不同） |

不同角色看到的「風險」呈現方式天然不同：
- 學生看的是 **「該怎麼補」** 的建議
- 系主任看的是 **「該派誰去談」** 的決策

所以保留 2 個入口是對的，但都使用同一份 `AcademicInsights` 引擎的資料。

---

## 6. 通知 / 收件箱（多 → 1）

| 舊入口 | 用途 | 整合後 |
|---|---|---|
| `InboxScreen` | 通用收件匣 | **唯一**入口（保留） |
| `NotificationsScreen` | 系統通知 | 已併入 InboxScreen 上方 banner |
| `StudentInboxScreen` | 學生專用 | 已併入 InboxScreen（依角色顯示） |

`InboxScreen` 現在頂部會出現 `AIMissionControl`（依登入身分），
下方是傳統 inbox tasks。一個畫面解決所有「我有什麼待辦」需求。

---

## 7. 訊息（多 → 3 個明確語意）

整合前：MessagesHome、Inbox、Groups、Dms、Chat、GroupPost、GroupDetail
等 7+ 個有時候會混淆。

**整合後的語意分層**：

| 語意層 | 入口 | 內容 |
|---|---|---|
| **工作台** | `Inbox`（訊息 Tab 預設） | AI 排好的下一步、系統通知、待辦 |
| **對話列表** | `MessagesHome` / `Dms` / `Groups` | 我的所有對話與群組 |
| **單一對話** | `Chat` / `GroupDetail` | 雙方訊息流 |

**訊息 Tab 的初始畫面是 `Inbox`**（已在 `MessagesStack.tsx` 設定 `initialRouteName="Inbox"`），
不是 `MessagesHome` — 因為「我要做的事」比「我要聊天」優先。

---

## 8. 已死路由清理（onUnhandledAction Fallback）

`App.tsx` 的 `onUnhandledAction` 現在會：
1. 顯示「AI 找不到該畫面的連結」（口語化錯誤訊息）
2. 比對 `TAB_HINTS` 對照表，告訴使用者該去哪個 Tab
3. 提供「前往 X 分頁」按鈕一鍵帶過去
4. 若不在對照表，提供「回主畫面」

這確保 **demo 期間沒有任何點擊會變成白屏死當**。

---

## 9. 為什麼不直接刪 ScreensFile？

技術債務考量：
- 這些 Screen 散在 150+ 檔案，互相 import
- 刪一個會破壞另一個 import 鏈
- 口試時間敏感，**穩定 > 完美**

策略：**保留檔案，路由收斂**。LearnStack/MessagesStack 等的別名機制
（多個 `Stack.Screen name="X" component={SameComponent}`）已經是
正確的路由收斂模式。

未來迭代時可以再做 deep refactor。
