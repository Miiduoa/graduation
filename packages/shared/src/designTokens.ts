/**
 * nuni design tokens for shared surfaces and controls.
 * Keep assistant aliases compatible with existing imports; they use the product palette.
 */

export const tokens = {
  // ─────────────────────────────────────────────────
  // 色彩系統（Color System）
  // ─────────────────────────────────────────────────
  color: {
    bg: '#FAF8F2',
    bgSoft: '#F1EFE7',
    surface: '#FFFDF8',
    surfaceTint: 'rgba(255,255,255,0.6)',
    panel: '#EFEDE4',
    panel2: '#E6E4DA',
    text: '#24251F',
    muted: '#5E6057',
    mutedLight: '#686B60',
    border: '#DEDBD0',
    borderStrong: '#A7A89B',
    brand: '#214C3D',
    brand2: '#345E4C',
    onBrand: '#FFFFFF',
    accentSoft: '#E5EDE5',
    success: '#386146',
    successSoft: '#E6EEE4',
    warning: '#8B631E',
    warningSoft: '#F6EEDA',
    danger: '#983F32',
    dangerSoft: '#F7E9E3',
    info: '#41646A',
    infoSoft: '#E6EEEE',
    ai: '#214C3D',
    aiStrong: '#345E4C',
    aiSoft: '#E5EDE5',
    aiHalo: 'rgba(33,76,61,0.20)',
    aiSurface: '#F0F1EB',
    aiGradient: ['#214C3D', '#345E4C', '#526750'] as const,
    aiGradientSoft: ['#E5EDE5', '#F0F1EB', '#FAF8F2'] as const,
    confidenceHigh: '#386146',
    confidenceMid: '#8B631E',
    confidenceLow: '#983F32',
  },

  colorDark: {
    bg: '#000000',
    bgSoft: '#080808',
    surface: '#151614',
    surfaceTint: 'rgba(255,255,255,0.06)',
    panel: '#181916',
    panel2: '#24251F',
    text: '#F2F0E8',
    muted: '#B3B4AA',
    mutedLight: '#9B9E93',
    border: '#34362F',
    borderStrong: '#55584E',
    brand: '#B6D0B9',
    brand2: '#CCDDCE',
    onBrand: '#17291D',
    accentSoft: 'rgba(182,208,185,0.14)',
    success: '#A6CA9E',
    successSoft: 'rgba(166,202,158,0.16)',
    warning: '#DEC080',
    warningSoft: 'rgba(222,192,128,0.16)',
    danger: '#EFAC9A',
    dangerSoft: 'rgba(239,172,154,0.16)',
    info: '#A7C7CA',
    infoSoft: 'rgba(167,199,202,0.16)',
    ai: '#B6D0B9',
    aiStrong: '#CCDDCE',
    aiSoft: 'rgba(182,208,185,0.14)',
    aiSurface: '#273229',
    aiHalo: 'rgba(182,208,185,0.24)',
    aiGradient: ['#B6D0B9', '#B4CEAE', '#CCDDCE'] as const,
    aiGradientSoft: ['#273229', '#151614', '#000000'] as const,
    confidenceHigh: '#A6CA9E',
    confidenceMid: '#DEC080',
    confidenceLow: '#EFAC9A',
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
  // 圓角（Radius）
  // ─────────────────────────────────────────────────
  radius: {
    xs: 4,
    sm: 6,
    md: 8,
    lg: 12,
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
    sm: '0 2px 8px rgba(36,59,53,0.04)',
    md: '0 4px 16px rgba(36,59,53,0.07)',
    lg: '0 8px 24px rgba(36,59,53,0.10)',
    // Assistant aliases share the same focus treatment.
    ai: '0 0 0 3px rgba(49,77,64,0.18), 0 8px 24px rgba(49,77,64,0.12)',
    aiStrong: '0 0 0 4px rgba(49,77,64,0.25), 0 12px 32px rgba(49,77,64,0.20)',
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
      breath: 1600, // 循環提示動畫
    },
    easing: {
      out: 'cubic-bezier(0.16, 1, 0.3, 1)', // 標準退場
      in: 'cubic-bezier(0.4, 0, 1, 1)', // 標準進場
      inOut: 'cubic-bezier(0.4, 0, 0.2, 1)', // 標準雙向
      spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)', // 彈性
    },
  },

  // ─────────────────────────────────────────────────
  // Z-Index（層次規範）
  // ─────────────────────────────────────────────────
  z: {
    base: 0,
    raised: 10,
    sticky: 100, // sticky header
    drawer: 200, // side drawer
    commandBar: 300, // 全屏 Command Bar
    overlay: 400, // 模態背景
    modal: 500, // 模態本體
    toast: 600, // toast / 浮島提醒
    takeover: 700, // 緊急廣播
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
  // 助理介面尺寸與更新間隔
  // ─────────────────────────────────────────────────
  ai: {
    commandBarHeight: 56, // Desktop / Tablet
    commandPillHeight: 56, // Mobile 底部浮島
    commandSheetMaxHeight: 0.75, // 占螢幕比例
    drawerWidth: 380, // Desktop drawer
    slotCardMaxWidth: 720,
    typingDotCount: 3,
    typingDotInterval: 1200, // ms
    breathPeriod: 1600, // ms
    sourceStampMaxAge: 24 * 3600 * 1000, // 24h 後標示「資料可能過舊」
  },
} as const;

export type DesignTokens = typeof tokens;

// ─────────────────────────────────────────────────
// Helper: 把 tokens 轉成 CSS 變數字串（給 Web 用）
// ─────────────────────────────────────────────────
export function tokensToCssVariables(mode: 'light' | 'dark' = 'light'): string {
  const lines: string[] = [mode === 'dark' ? ":root[data-theme='dark'] {" : ':root {'];
  const colors = mode === 'dark' ? tokens.colorDark : tokens.color;
  // Color
  for (const [k, v] of Object.entries(colors)) {
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
