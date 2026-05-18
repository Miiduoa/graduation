# Campus AI-First Redesign 設計總綱

> Version 1.0 · 2026-05-18
> 適用範圍：apps/web（學生 / 教師 / 校友端）、apps/web/app/lms-admin（管理後台）、apps/mobile（Expo App）

---

## 0. TL;DR — 一張圖看懂

```
舊架構 (功能導向)                    新架構 (意圖導向 / AI-First)
─────────────────                    ─────────────────────────────
首頁 = Dashboard 卡片堆疊        →    首頁 = AI Command Center
固定 Tab Bar (6 個分頁)          →    自適應 Tab + AI 主導浮層
點 → 找 → 看                     →    說 → AI 抓 → 確認
分散的 AI 助理頁                 →    AI 是系統殼層，無所不在
靜態 UI                          →    Generative UI：對話即介面
```

「使用者不再尋找功能；他描述他要什麼，AI 把功能組裝出來。」

---

## 1. 設計哲學：三條鐵則

### 1.1 AI 是介面本身，不是功能之一
傳統 App 把 AI 收在「AI 助理」分頁底下，使用者必須記得「我要去問 AI」。在這個改版裡，**AI 是所有導航的預設方式**，舊的功能頁從「主要入口」降為「AI 拉出來的工具卡」。

* 對話框（Command Bar）出現在 100% 的頁面頂部
* 所有功能都有可被 AI 喚出的「快速卡片 (Slot Card)」表達式
* AI 不再是綠色機器人氣泡；AI 是頁面的呼吸節奏

### 1.2 意圖優先（Intent-First），位置其次（Location-Second）
使用者說「我這週還能不能蹺一次必修」→ AI 應直接生出「曠課額度 + 出缺勤紀錄 + 後果預測」卡片。**不要逼使用者先進「成績」分頁再進「缺曠」子頁**。

導航邏輯重寫成兩層：
1. **意圖層**（Intent Layer）：自然語言 → AI 路由 → 對應卡片/頁
2. **檔案層**（Catalog Layer）：傳統樹狀，給「我已經知道路徑」的人作為備援

### 1.3 不對使用者說謊 — Trust by Design
AI 介面最大的風險是讓人懷疑「這個資料是真的還是 AI 編的」。每一張 AI 生出的卡片都必須有：

* `來源戳記`：例如 `來源：教務系統 · 09:43`
* `信心度條`：高/中/低，搭配建議動作（「已驗證」「請再向系辦確認」）
* `可追溯`：點卡片可下鑽到原始資料頁

---

## 2. 資訊架構 (IA) 重整

### 2.1 舊 IA 缺陷
原 Web SiteShell 共 14 個導航項（Today, 課程, 訊息, 校園, 收件匣, 我的, 課表, 學分試算, LMS 管理, AI 助理, 餐廳, 公車, 圖書館, 設定），對於不同角色（學生 / 教師 / TA / 社團幹部 / 系主任 / 管理員 / 校友）都顯示同一份清單，導致：

* **過度暴露**：管理者功能被學生看見
* **失焦**：「Today」「AI 助理」「課程」其實大量重疊
* **角色錯亂**：DemoRolePill 切換角色後 Tab 不變，只有內容變

### 2.2 新 IA — 三層金字塔

```
              ┌─────────────────────┐
              │   ⊕ ASK ANYTHING    │  ← Layer 0：AI Command (永遠在頂)
              └─────────────────────┘
                 ▲       ▲       ▲
        ┌────────┴───┬───┴───┬───┴────────┐
        │  TODAY     │ HUB    │  ME       │  ← Layer 1：三大時空軸
        │ (現在)     │ (校園) │ (我的歷程) │     僅 3 個主要分頁
        └────────────┴────────┴───────────┘
              │              │
              ▼              ▼
       Slot Cards         Catalog (索引頁)  ← Layer 2：AI 拉的卡 + 傳統頁面
       (AI 拉出來的)      (我想自己翻)
```

#### Layer 0：AI Command Bar
* 全域置頂、永遠可用、`Cmd+K` / 點擊 / 語音三種喚出方式
* 預測式 quick chips：根據時間、角色、上次行為動態給三個建議
  * 例：學生週一早上 → `今日課表` / `週末作業` / `中午吃什麼`
  * 例：教師週五下午 → `本週批改進度` / `下週課程資料` / `產生週報`

#### Layer 1：三大時空軸（取代 14 分頁）
| 分頁 | 中文名 | 涵蓋什麼 | 原 14 分頁吸收到這裡 |
|---|---|---|---|
| **Today** | 此刻 | 現在/今日相關 | Today, 訊息, 收件匣, 公車（即時） |
| **Hub** | 校園 | 場域與資源 | 校園地圖, 餐廳, 圖書館, 課程, 社團 |
| **Me** | 我的 | 我的歷程資料 | 成績, 課表, 學分, 個人檔案, 設定 |

管理後台 / 教師工作台 / 社團管理在角色切換時，**從第三個分頁「Me」展開**，不再佔用通用 Tab。

#### Layer 2：Slot Cards + Catalog
* Slot Card：AI 從對話中生出來的 inline 元件（見 §4）
* Catalog：傳統清單頁，給「我就想自己滑」的人 — 保留功能完整性

---

## 3. 導航邏輯規範

### 3.1 跨端通則
| 平台 | Layer 0 位置 | Layer 1 位置 |
|---|---|---|
| Web Desktop | 頂部全寬 Command Bar，sticky | 左側 Rail (3 icons + AI 主按鈕) |
| Web Tablet | 頂部 Command Bar | 上方 Tab |
| Web Mobile | 底部置中浮島 Command Pill | 底部 Tab（3 個 + 中央 AI） |
| iOS / Android | 底部置中浮島 Command Pill | 底部 Tab（3 個 + 中央 AI） |

中央 AI 鈕在 mobile 是「凸起的圓形主按鈕」，視覺權重最重，按下後彈出 Command Sheet。

### 3.2 角色自適應
不再用 DemoRolePill 切換固定 navigation；改用「Role Surface」概念：

* **學生**：Today = 今日課表 + 作業 + 公告；Me = 成績 / 學分 / 課表
* **教師**：Today = 今日課 + 待批改 + TA 訊息；Me = 我授課的課 / 學生分布 / 教學週報
* **TA**：Today 同教師；Me 多一個「我的助教任務」
* **社團幹部**：Hub 第一個 surface = 我的社團；Me 多一個「社團管理」
* **系主任 / Admin**：Me 底下多一個 Admin Console（不再放在主 nav）
* **校友**：只有 Today + Hub，沒有 Me 的學業歷程，改成「校友連結」

### 3.3 路徑命名 — 從「位置」到「動詞」
| 舊 (位置) | 新 (動詞 / 意圖) |
|---|---|
| `/timetable` | `/me/schedule`（保留） + `/today/next` |
| `/grades` | `/me/transcript` + `/today/scores-this-week` |
| `/cafeteria` | `/hub/dining` |
| `/bus` | `/hub/transit` |
| `/lms-admin` | `/me/admin/*` 或 `/console/*`（不在主 nav） |
| `/ai-assistant` | 廢除為獨立頁，整合進 Command Bar |

> 過渡期：保留舊路由 301 轉址，不破壞既有書籤。

---

## 4. AI-First 互動模式：四種 Slot Card

「Slot Card」是 AI 從對話中生出的 inline UI 元件。它取代了「AI 回答純文字 + 連結你去某頁」的舊模式。四種規範類型：

### 4.1 答案卡 (Answer Card)
單純問句的快速結構化回應。例如「下節課在哪？」

```
┌──────────────────────────────────────────┐
│  ⏰ 下節課                                │
│  ─────────────────────────────────────   │
│  資料結構  09:10–10:50                    │
│  📍 工程館 302  (步行 4 分鐘)              │
│  [導航] [課程資料] [請假]                  │
│  來源：教務系統 · 09:43 · 高信心 ✓        │
└──────────────────────────────────────────┘
```

### 4.2 任務卡 (Action Card)
需要使用者確認的可執行動作。例如「幫我請週四的假」

```
┌──────────────────────────────────────────┐
│  📝 請假草稿（待確認）                     │
│  ─────────────────────────────────────   │
│  日期：5/22（週四）                       │
│  課程：資料庫系統 (CS302)                  │
│  事由：[請選擇 ▾ 病假]                     │
│  附件：請放診斷證明 (選用)                 │
│                                          │
│  [取消]      [提交給授課老師 →]            │
│  ⚠ 中信心：建議再讀一次事由                 │
└──────────────────────────────────────────┘
```

設計鐵則：**Action Card 永遠需要二次確認**，AI 不直接執行不可逆操作。

### 4.3 比較卡 (Compare Card)
多選一情境。例如「中午吃什麼，便宜又營養」

```
┌──────────────────────────────────────────┐
│  🍱 中午選擇  3 個建議                     │
│  ┌──────┬──────┬──────┐                  │
│  │ 學餐 │ 主餐廳│ 7-11 │                  │
│  │ ¥65  │ ¥95  │ ¥45  │                  │
│  │ ⭐4.2│ ⭐4.5│ ⭐3.8│                  │
│  │ 5min │ 8min │ 2min │                  │
│  └──────┴──────┴──────┘                  │
│  [展開全部 12 個選項]                      │
└──────────────────────────────────────────┘
```

### 4.4 排程卡 (Schedule Card)
時間序列或進度型回應。例如「這週還要交什麼？」

```
┌──────────────────────────────────────────┐
│  📅 本週待辦  4 件                        │
│  ────────────────────────────────────    │
│  週三 23:59  作業系統 Lab 3   未開始 ⚠    │
│  週四 09:00  資料庫小考       已準備 ✓    │
│  週五 14:00  專題期中報告     進行中 ●60% │
│  週日 23:59  英文週記                     │
│                                          │
│  [產生週計畫] [全部加入行事曆]             │
└──────────────────────────────────────────┘
```

### 4.5 Slot Card 共用規範
* 圓角：`var(--radius-lg)` 22px
* 邊框：1px `var(--border)`；hover/focus 改 `var(--brand)`
* 內距：`var(--space-lg)` 24px
* 卡內字級：標題 17px / 內文 15px / 來源戳記 12px
* 來源戳記：右下角，永遠存在
* 信心度：高 = ✓ 綠 / 中 = ● 琥珀 / 低 = ⚠ 紅
* 動效：浮現 220ms ease-out，下鑽 280ms cubic-bezier(.2,.8,.2,1)

---

## 5. Generative UI：對話即介面

### 5.1 三層 fallback
當 AI 想生 UI 時，按順序嘗試：

1. **已知元件**（Templated Slot Card）：四種 Slot Card 之一 → 用既定 React 元件，最穩定
2. **拼裝元件**（Composed Card）：AI 從 design system 元件庫拼出客製布局
3. **純文字 + Quick Replies**：兜底，永遠可用

### 5.2 對話與分頁的合流
傳統「AI 助理是一個獨立頁」廢除。改為：

* AI 對話視窗是 **PageOverlay**，從任何頁面下拉/上拉都可呼出
* AI 生出的卡片若使用者點「展開」，**該卡片變成一頁**（push 進 history stack），使用者可回頭
* 每張 AI 卡片底下有 `📌 釘到 Today`：把這張卡常駐到 Today 分頁，相當於使用者自製 widget

這實作了「對話即介面」：使用者透過聊天「種」出自己的個人化主畫面。

### 5.3 主動式 AI (Proactive Surfaces)
不只被動回答。AI 在以下時機主動冒出：

* 上課前 10 分鐘：浮島提醒「資料結構 09:10 工程館 302，要先看複習嗎？」
* 作業截止前 6 小時：紅色徽章 + 浮島
* 校園緊急廣播：強制全屏 takeover
* 連續登入第 7 天：成就 toast

主動式介面分三級（按打擾程度）：
1. **Whisper**（耳邊低語）：徽章數字、icon 動畫 — 不阻擋操作
2. **Whistle**（吹哨）：頂部 banner / 底部浮島 — 可點可關
3. **Alarm**（鈴聲）：全屏 takeover — 只用於安全/緊急

---

## 6. 視覺語言（與既有 v3.0 共存）

現有 globals.css 已有完整的 Campus Soft v3.0 token，本次改版**不打掉重練**，而是延伸：

### 6.1 新增 tokens
詳見 `docs/design/design-system.md`，重點：

* **AI Surface Palette**：AI 卡片專用底色 `--ai-surface: linear-gradient(180deg, #FAFBFF 0%, #F2F5FF 100%)`，與既有 `--surface` 有微妙區隔
* **AI Halo**：AI 元件聚焦時的光暈 `box-shadow: 0 0 0 3px rgba(99, 102, 241, .18), 0 8px 24px rgba(99,102,241,.12)`
* **AI Brand Gradient**：`linear-gradient(135deg, #6366F1 0%, #8B5CF6 50%, #EC4899 100%)` — 只用在 AI 主按鈕、Command Bar focus、AI logo
* **Confidence Tokens**：
  * `--confidence-high: #34C759`
  * `--confidence-mid: #FF9500`
  * `--confidence-low: #FF3B30`

### 6.2 動效原則
* AI 的所有元素都有「呼吸感」：1.6s ease-in-out 微縮放（0.98–1.0），暗示有思考發生
* Slot Card 出現：220ms 從下方 12px 浮起 + opacity 0→1
* AI 思考中：3 個點 1.2s 循環，不要轉圈圈

### 6.3 暗黑模式
保留現有 dark mode tokens；新增 AI 暗黑色：
* `--ai-surface-dark: linear-gradient(180deg, #1A1B2E 0%, #14152A 100%)`
* `--ai-glow-dark: rgba(139, 92, 246, .32)`

---

## 7. 各端落地差異

### 7.1 Web Desktop（≥ 1024px）
* 三欄式：左 Rail (72px) / 中內容 (流動) / 右 AI Drawer (可摺疊 380px)
* Command Bar 永遠在頂部，按 `Cmd+K` 全屏
* AI Drawer 預設摺疊；對話中自動展開

### 7.2 Web Tablet (768–1023px)
* 兩欄：左 Tab (上方水平) / 全寬內容
* AI Drawer 改為從右滑出，覆蓋 40% 寬

### 7.3 Web Mobile / Native Mobile
* 單欄
* 底部三個 Tab + 中央凸起 AI 大按鈕
* AI 大按鈕點下 → 從底部上升 75% 高度的 Command Sheet
* 上下滑：上滑展開 AI 全屏，下滑收回 75%

### 7.4 Admin Console（`/console/*`）
* 進入後上方無 Command Bar 改為 **Admin Command Bar**（紅紫漸層，提醒「正在管理模式」）
* 左側多一個「審計軌跡」Tab — 顯示我做了什麼，何時，誰看得到
* 所有 AI 動作預設關閉 auto-execute，全部要二次確認

---

## 8. 無障礙與信任

* 全部 AI 互動可純鍵盤操作（`Cmd+K`, `Tab`, `Enter`, `Esc`）
* 對話視窗符合 WCAG 2.1 AA：對比度 4.5:1 以上
* 螢幕報讀：AI 回應前讀「AI 正在思考」；回應後讀完整內容並提示「按 R 重複，按 S 來源」
* 來源戳記 100% 覆蓋，無例外
* `/me/privacy`：使用者可清空所有 AI 對話歷史 + 不讓 AI 使用我的資料訓練

---

## 9. 不做的事（Anti-Goals）

* **不做 AI 擬人化**：不取暱稱、不用 emoji 笑臉、不講「我覺得你今天看起來不錯」
* **不做 AI 自動執行**：請假、選課、退選、轉帳等永遠需二次確認
* **不取代真人**：心理諮商、緊急通報直接給「找人類」按鈕，不做擬似諮商
* **不收集情緒資料用於行銷**：AI ambient awareness 只用於介面個人化，不存到分析

---

## 10. 落地路線圖

| 階段 | 範圍 | 時程估計 |
|---|---|---|
| **P0 立基** | 新 design tokens + AppShell + Command Bar 殼層（不接 AI 邏輯） | 1 週 |
| **P1 學生端** | Today / Hub / Me 三分頁 + 四種 Slot Card 元件 + 改 / 首頁 | 2 週 |
| **P2 AI 接線** | 把現有 ai-server / aiBrain 串到 Command Bar，先做問答卡 | 1 週 |
| **P3 教師 + 角色擴展** | 教師 / TA / 社團 / 系主任的 Today surfaces | 2 週 |
| **P4 Mobile** | apps/mobile 同步重做 AppShell + 底部凸起 AI 鈕 | 2 週 |
| **P5 Admin Console** | /console/* 抽出 lms-admin，做 Admin Command Bar | 1 週 |
| **P6 Generative UI** | Composed Card / Pinned to Today / 主動式提醒 | 2 週 |

總計約 11 週，但 P0 + P1 + 部分 P2 已可作為口試 demo（4 週可達）。

---

## 11. 相關文件

* `docs/design/design-system.md` — Design tokens 規範
* `docs/design/prototype.html` — 視覺化原型（雙擊在瀏覽器開）
* `apps/web/src/components/AppShell.tsx` — 新版 AppShell 起手式（已實作）
* `apps/web/src/components/CommandBar.tsx` — Command Bar 元件
* `apps/web/src/app/globals.css` — 新增 AI tokens（附加在 v3.0 之後）

---

*本文件是設計總綱，不是工程規格。實作時若與現實資料/技術不符，以技術合理性優先，回頭更新此文件。*
