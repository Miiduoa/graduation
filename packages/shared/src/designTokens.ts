/**
 * Campus AI-First Design Tokens
 * ---
 * 跨端共用設計變數（Web / Mobile / Admin）
 * 與 apps/web/src/app/globals.css 的 CSS 變數一一對應
 *
 * 使用方式：
 *   Web:    直接用 globals.css 的 var(--xxx)
 *   Mobile: import { tokens } from '@campus/shared/designTokens'
 */

export const tokens = {
  // ─────────────────────────────────────────────────
  // 色彩系統（Color System）
  // ─────────────────────────────────────────────────
  color: {
    // ── 基底 (繼承 v3.0 Campus Soft) ──
    bg: '#F8F9FC',
    bgSoft: '#FAFBFC',
    surface: '#FFFFFF',
    surfaceTint: 'rgba(255,255,255,0.6)',
    panel: '#F2F2F7',
    panel2: '#E8E8ED',

    text: '#1C1C1E',
    muted: '#8E8E93',
    mutedLight: '#AEAEB2',

    border: '#E5E5EA',
    borderStrong: '#D1D1D6',

    // ── 品牌 ──
    brand: '#2563EB',
    brand2: '#60A5FA',
    accentSoft: 'rgba(37,99,235,0.10)',

    // ── 狀態 ──
    success: '#34C759',
    successSoft: 'rgba(52,199,89,0.12)',
    warning: '#FF9500',
    warningSoft: 'rgba(255,149,0,0.12)',
    danger: '#FF3B30',
    dangerSoft: 'rgba(255,59,48,0.12)',
    info: '#007AFF',
    infoSoft: 'rgba(0,122,255,0.12)',

    // ── AI 專屬色（新增）──
    // AI 是介面本身，需要與其他狀態色明顯區隔
    ai: '#6366F1',                   // Indigo 500 — AI 主色
    aiStrong: '#4F46E5',             // Indigo 600 — hover/pressed
    aiSoft: 'rgba(99,102,241,0.10)', // AI 卡背景
    aiHalo: 'rgba(99,102,241,0.20)', // AI focus halo
    aiSurface: '#FAFBFF',            // AI 卡的純色 fallback

    // AI 漸層（Web 用 CSS gradient，Mobile 用 expo-linear-gradient）
    aiGradient: ['#6366F1', '#8B5CF6', '#EC4899'] as const, // Indigo → Purple → Pink
    aiGradientSoft: ['#EEF2FF', '#FAF5FF', '#FCE7F3'] as const,

    // ── 信心度（Confidence）──
    confidenceHigh: '#34C759',  // 綠 — 已驗證
    confidenceMid:  '#FF9500',  // 琥珀 — 請再確認
    confidenceLow:  '#FF3B30',  // 紅 — 風險高，建議找真人
  },

  // ─────────────────────────────────────────────────
  // 暗黑模式（Dark Mode）
  // ─────────────────────────────────────────────────
  colorDark: {
    bg: '#0D1420',
    surface: '#1A1F2E',
    panel: '#222838',
    text: '#F2F4FA',
    muted: '#9CA3B5',
    border: '#2A3142',
    ai: '#818CF8',
    aiSurface: '#1A1B2E',
    aiHalo: 'rgba(139,92,246,0.32)',
  },

  // ─────────────────────────────────────────────────
  // 間距（Spacing）— 4px 基底
  // ─────────────────────────────────────────────────
  space: {
    xs: 4,
    sm: 8,
    md: 16,
    lg: 24,
    xl: 32,
    '2xl': 48,
    '3xl': 64,
  },

  // ─────────────────────────────────────────────────
  // 圓角（Radius）— iOS 風格
  // ─────────────────────────────────────────────────
  radius: {
    xs: 8,
    sm: 12,
    md: 18,
    lg: 22,
    pill: 999,
  },

  // ─────────────────────────────────────────────────
  // 字級（Typography）
  // ─────────────────────────────────────────────────
  font: {
    family: {
      sans: '-apple-system, BlinkMacSystemFont, "PingFang TC", "Noto Sans TC", "Helvetica Neue", Helvetica, Arial, sans-serif',
      mono: 'SF Mono, Menlo, Consolas, "Courier New", monospace',
    },
    size: {
      display: 32,
      h1: 24,
      h2: 20,
      h3: 17,
      body: 15,
      bodySm: 13,
      label: 13,
      caption: 11,
    },
    lineHeight: {
      display: 38,
      h1: 30,
      h2: 26,
      h3: 22,
      body: 21,
      bodySm: 18,
      caption: 14,
    },
    weight: {
      regular: '400',
      medium: '500',
      semibold: '600',
      bold: '700',
    },
    // letter-spacing 在小字上 +0.1，大字 -0.3 → -0.5（iOS 慣例）
    letterSpacing: {
      display: -0.5,
      h1: -0.3,
      h2: -0.2,
      h3: -0.1,
      body: 0,
      caption: 0.1,
    },
  },

  // ─────────────────────────────────────────────────
  // 陰影（Shadow）— Soft / Layered
  // ─────────────────────────────────────────────────
  shadow: {
    sm: '0 2px 10px rgba(17,25,60,0.08)',
    md: '0 6px 18px rgba(17,25,60,0.10)',
    lg: '0 10px 28px rgba(17,25,60,0.14)',
    // AI 元件專屬：紫色微光
    ai: '0 0 0 3px rgba(99,102,241,0.18), 0 8px 24px rgba(99,102,241,0.12)',
    aiStrong: '0 0 0 4px rgba(99,102,241,0.25), 0 12px 32px rgba(139,92,246,0.20)',
  },

  // ─────────────────────────────────────────────────
  // 動效（Motion）
  // ─────────────────────────────────────────────────
  motion: {
    duration: {
      instant: 0,
      fast: 120,
      base: 220,
      slow: 280,
      breath: 1600, // AI 呼吸動畫
    },
    easing: {
      out: 'cubic-bezier(0.16, 1, 0.3, 1)',         // 標準退場
      in: 'cubic-bezier(0.4, 0, 1, 1)',              // 標準進場
      inOut: 'cubic-bezier(0.4, 0, 0.2, 1)',         // 標準雙向
      spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',   // 彈性（AI 浮現用）
    },
  },

  // ─────────────────────────────────────────────────
  // Z-Index（層次規範）
  // ─────────────────────────────────────────────────
  z: {
    base: 0,
    raised: 10,
    sticky: 100,           // sticky header
    drawer: 200,           // AI side drawer
    commandBar: 300,       // 全屏 Command Bar
    overlay: 400,          // 模態背景
    modal: 500,            // 模態本體
    toast: 600,            // toast / 浮島提醒
    takeover: 700,         // 緊急廣播（Alarm 級主動式 AI）
  },

  // ─────────────────────────────────────────────────
  // 斷點（Breakpoints）
  // ─────────────────────────────────────────────────
  breakpoint: {
    mobile: 0,
    tablet: 768,
    desktop: 1024,
    wide: 1440,
  },

  // ─────────────────────────────────────────────────
  // AI 介面專屬常數
  // ─────────────────────────────────────────────────
  ai: {
    commandBarHeight: 56,        // Desktop / Tablet
    commandPillHeight: 56,       // Mobile 底部浮島
    commandSheetMaxHeight: 0.75, // 占螢幕比例
    drawerWidth: 380,            // Desktop AI Drawer
    slotCardMaxWidth: 720,
    typingDotCount: 3,
    typingDotInterval: 1200,     // ms
    breathPeriod: 1600,          // ms
    sourceStampMaxAge: 24 * 3600 * 1000, // 24h 後標示「資料可能過舊」
  },
} as const;

export type DesignTokens = typeof tokens;

// ─────────────────────────────────────────────────
// Helper: 把 tokens 轉成 CSS 變數字串（給 Web 用）
// ─────────────────────────────────────────────────
export function tokensToCssVariables(): string {
  const lines: string[] = [':root {'];
  // Color
  for (const [k, v] of Object.entries(tokens.color)) {
    if (typeof v === 'string') {
      lines.push(`  --c-${kebab(k)}: ${v};`);
    }
  }
  // Space
  for (const [k, v] of Object.entries(tokens.space)) {
    lines.push(`  --s-${k}: ${v}px;`);
  }
  // Radius
  for (const [k, v] of Object.entries(tokens.radius)) {
    lines.push(`  --r-${k}: ${v}px;`);
  }
  lines.push('}');
  return lines.join('\n');
}

function kebab(s: string): string {
  return s.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}

// ─────────────────────────────────────────────────
// Mobile 用：React Native StyleSheet-friendly helpers
// ─────────────────────────────────────────────────
export const rnStyles = {
  aiCard: {
    backgroundColor: tokens.color.aiSurface,
    borderRadius: tokens.radius.lg,
    padding: tokens.space.lg,
    borderWidth: 1,
    borderColor: tokens.color.border,
  },
  slotCard: {
    backgroundColor: tokens.color.surface,
    borderRadius: tokens.radius.lg,
    padding: tokens.space.lg,
    marginBottom: tokens.space.md,
  },
  commandPill: {
    height: tokens.ai.commandPillHeight,
    borderRadius: tokens.radius.pill,
    paddingHorizontal: tokens.space.lg,
    backgroundColor: tokens.color.surface,
  },
} as const;
