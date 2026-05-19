# Campus AI-First Design System

> 與 `packages/shared/src/designTokens.ts` 與 `apps/web/src/app/globals.css` 同步
> Version 1.0 · 2026-05-18

---

## 1. 色彩系統

### 1.1 基礎色（沿用 v3.0 Campus Soft）

| Token | Hex | 用途 |
|---|---|---|
| `--bg` | `#F8F9FC` | 頁面底色 |
| `--surface` | `#FFFFFF` | 卡片底色 |
| `--panel` | `#F2F2F7` | 次要面板（iOS Grouped Bg） |
| `--text` | `#1C1C1E` | 主要文字 |
| `--muted` | `#8E8E93` | 次要文字 |
| `--border` | `#E5E5EA` | 分隔線 / 邊框 |
| `--brand` | `#2563EB` | 品牌主色（藍） |

### 1.2 AI 專屬色（新增）

| Token | Hex / Gradient | 用途 |
|---|---|---|
| `--ai` | `#6366F1` | AI 主色（Indigo 500） |
| `--ai-strong` | `#4F46E5` | AI hover / pressed |
| `--ai-soft` | `rgba(99,102,241,.10)` | AI 卡背景 |
| `--ai-halo` | `rgba(99,102,241,.20)` | AI focus 光暈 |
| `--ai-surface` | `#FAFBFF` | AI 卡純色 fallback |
| `--ai-gradient` | `linear-gradient(135deg, #6366F1 0%, #8B5CF6 50%, #EC4899 100%)` | AI 主按鈕 / Logo / 主按鈕 |
| `--ai-gradient-soft` | `linear-gradient(180deg, #EEF2FF 0%, #FCE7F3 100%)` | AI 卡微背景 |

### 1.3 信心度（Confidence）

| Token | 顏色 | 圖示 | 用途 |
|---|---|---|---|
| `--confidence-high` | `#34C759` | `✓` | 已驗證 / 高信心 — 可放心執行 |
| `--confidence-mid` | `#FF9500` | `●` | 中信心 — 建議再確認 |
| `--confidence-low` | `#FF3B30` | `⚠` | 低信心 — 強烈建議找真人 |

**規範**：每張 AI 生成的卡片右下角必須有信心度標記。低信心卡片不得隱藏「找真人」按鈕。

---

## 2. 間距（Spacing Scale）

4px 基底，相乘規則：

| Token | px | 適用 |
|---|---|---|
| `xs` | 4 | icon 與文字間距 |
| `sm` | 8 | 同列元件間距 |
| `md` | 16 | 卡片內元素垂直間距 |
| `lg` | 24 | 卡片內距、區塊垂直間距 |
| `xl` | 32 | 區塊間距 |
| `2xl` | 48 | 大區塊分隔 |
| `3xl` | 64 | 頁面 Hero 上下 |

---

## 3. 圓角（Radius Scale）

| Token | px | 適用 |
|---|---|---|
| `xs` | 8 | 標籤、輸入框 |
| `sm` | 12 | 小按鈕、Chip |
| `md` | 18 | 標準按鈕 |
| `lg` | 22 | 卡片（所有 Slot Card） |
| `pill` | 999 | Pill 按鈕、Command Pill |

---

## 4. 字級系統

| Token | Size / LH / LS | 用途 |
|---|---|---|
| `display` | 32 / 38 / -0.5 | Today Hero 主標 |
| `h1` | 24 / 30 / -0.3 | 頁面標題 |
| `h2` | 20 / 26 / -0.2 | 區塊標題 |
| `h3` | 17 / 22 / -0.1 | 卡片標題 |
| `body` | 15 / 21 / 0 | 內文 |
| `body-sm` | 13 / 18 / 0 | 次要內文 |
| `label` | 13 / 18 / 0 | 表單標籤 |
| `caption` | 11 / 14 / +0.1 | 來源戳記、時間 |

字族統一：`-apple-system, "PingFang TC", "Noto Sans TC", system-ui`

---

## 5. 陰影層次

| Token | 值 | 適用 |
|---|---|---|
| `sm` | `0 2px 10px rgba(17,25,60,.08)` | 卡片 resting |
| `md` | `0 6px 18px rgba(17,25,60,.10)` | 卡片 hover |
| `lg` | `0 10px 28px rgba(17,25,60,.14)` | 下拉 / Drawer |
| `ai` | `0 0 0 3px rgba(99,102,241,.18), 0 8px 24px rgba(99,102,241,.12)` | AI 元件 focus |
| `ai-strong` | `0 0 0 4px rgba(99,102,241,.25), 0 12px 32px rgba(139,92,246,.20)` | AI 主按鈕 pressed |

---

## 6. 動效

### 6.1 時長
| Token | ms | 用途 |
|---|---|---|
| `fast` | 120 | hover / press 反饋 |
| `base` | 220 | 卡片浮現、tab 切換 |
| `slow` | 280 | 頁面切換、drawer |
| `breath` | 1600 | AI 思考呼吸 |

### 6.2 曲線
* `out`: `cubic-bezier(0.16, 1, 0.3, 1)` — 退場
* `in`: `cubic-bezier(0.4, 0, 1, 1)` — 進場
* `inOut`: `cubic-bezier(0.4, 0, 0.2, 1)` — 雙向
* `spring`: `cubic-bezier(0.34, 1.56, 0.64, 1)` — AI 浮現

### 6.3 AI 簽名動畫
* **Breath**：1.6s 循環，scale(0.98 → 1.0)，alpha (0.95 → 1.0) — AI Logo 永遠在做這件事
* **Typing**：3 個 6px 圓點，相位差 200ms，1.2s 一輪 — AI 思考時用
* **SlotCard Enter**：220ms，translateY(12px → 0) + opacity(0 → 1) + 220ms ease-out
* **PageOverlay**：280ms，scale(1.02 → 1.0)，背景模糊 0 → 8px

---

## 7. 元件規範（核心元件清單）

### 7.1 必備元件
| 元件 | 路徑（建議） | 用途 |
|---|---|---|
| `CommandBar` | `apps/web/src/components/ai/CommandBar.tsx` | 全域 AI 對話入口 |
| `CommandSheet` | mobile 版 | Mobile 底部浮島展開 |
| `SlotCard` | `apps/web/src/components/ai/SlotCard.tsx` | AI 生成卡片基底 |
| `AnswerCard` | `…/AnswerCard.tsx` | 4 種 Slot Card 之一 |
| `ActionCard` | `…/ActionCard.tsx` | 需確認的操作 |
| `CompareCard` | `…/CompareCard.tsx` | 多選一 |
| `ScheduleCard` | `…/ScheduleCard.tsx` | 時序型 |
| `ConfidenceBadge` | `…/ConfidenceBadge.tsx` | 信心度標記 |
| `SourceStamp` | `…/SourceStamp.tsx` | 來源戳記 |
| `AppShell` | `apps/web/src/components/AppShell.tsx` | 新版三層導航殼 |
| `IntentBreadcrumb` | `…/IntentBreadcrumb.tsx` | 「你說 X → AI 給你 Y」可回溯麵包屑 |

### 7.2 元件 API 範例（SlotCard）

```tsx
type SlotCardProps = {
  variant: 'answer' | 'action' | 'compare' | 'schedule';
  title: string;
  icon?: string;
  confidence: 'high' | 'mid' | 'low';
  source: {
    name: string;       // "教務系統"
    timestamp: Date;
    href?: string;      // 點戳記跳轉
  };
  onExpand?: () => void;       // 展開為一頁
  onPinToToday?: () => void;   // 釘到 Today
  children: React.ReactNode;
};
```

---

## 8. Z-Index 規範

由低到高：

| Token | Z | 用途 |
|---|---|---|
| `base` | 0 | 預設 |
| `raised` | 10 | 卡片浮起 |
| `sticky` | 100 | sticky header |
| `drawer` | 200 | 側邊 AI Drawer |
| `commandBar` | 300 | 全屏 Command Bar |
| `overlay` | 400 | 模態背景 |
| `modal` | 500 | 模態本體 |
| `toast` | 600 | 提示浮島 |
| `takeover` | 700 | 緊急廣播 |

---

## 9. 響應式斷點

| Token | min-width | 行為 |
|---|---|---|
| mobile | 0 | 單欄 + 底部 Tab + 中央凸起 AI |
| tablet | 768 | 雙欄 + 上方 Tab |
| desktop | 1024 | 三欄（Rail / Content / AI Drawer） |
| wide | 1440 | 加寬 AI Drawer |

---

## 10. 無障礙（A11y）

* 對比度：所有文字對背景 ≥ 4.5:1（小字）/ ≥ 3:1（大字 / 圖示）
* Focus ring：所有可點擊元件必須有 2px outline，使用 `--ai-halo` 或 `--focus-ring`
* 鍵盤：`Cmd+K` 開 Command Bar；`Esc` 關；`Tab` / `Shift+Tab` 在 Slot Card 間移動；`Enter` 觸發主動作
* 螢幕報讀：AI 思考前讀「AI 正在思考」，回應後讀完整內容
* 動畫：`prefers-reduced-motion` 媒體查詢下，所有非必要動畫降為 fade
* 字級：支援使用者放大字級 ≥ 200% 不破版

---

## 11. 與既有 v3.0 共存策略

* 既有 `globals.css` 不動，新增 token 接在 `:root` 之後（以 `/* === AI-First Tokens v1 === */` 註解區隔）
* 舊頁面繼續用 `var(--brand)`，新元件用 `var(--ai)`；兩者不互衝
* 過渡期：新元件以 `data-ai-system="v1"` 屬性區分，方便 QA

---

## 12. 變更紀錄

* **v1.0 (2026-05-18)**：首版，建立 AI 專屬色 + 信心度 + Slot Card 規範
