export type ThemeMode = 'dark' | 'light';

export type ThemeColors = {
  bg: string;
  background: string;
  surface: string;
  surface2: string;
  surface3: string;
  surfaceElevated: string;
  surfaceInteractive: string;
  surfaceInteractiveStrong: string;
  /** 區塊／捲動區底色 — 介於 bg 與 surface 之間，強化分段感 */
  surfaceMuted: string;
  border: string;
  separator: string;
  text: string;
  textSecondary: string;
  muted: string;
  accent: string;
  accentSoft: string;
  accentHover: string;
  accentStrong: string;
  /** 靜宜金 — 用於獎勵、高亮、CTA 輔色 */
  gold: string;
  goldSoft: string;
  gradientStart: string;
  gradientMid: string;
  gradientEnd: string;
  success: string;
  successSoft: string;
  danger: string;
  error: string;
  dangerSoft: string;
  warning: string;
  warningSoft: string;
  info: string;
  infoSoft: string;
  focusRing: string;
  overlay: string;
  disabledBg: string;
  disabledText: string;
  cardShadow: string;
  shimmer: string;
  /** 心理學情緒色盤 — Psychological Emotional Palette */
  /** 成就/獎勵（靜宜金）— Variable Reward + Competence */
  achievement: string;
  achievementSoft: string;
  /** 連續打卡 Streak（活力橘紅）— Habit Loop + Loss Aversion */
  streak: string;
  streakSoft: string;
  /** 成長/完成（翡翠綠）— Growth Mindset + Competence */
  growth: string;
  growthSoft: string;
  /** 情感安撫（天空藍）— Anxiety Reduction，用於截止日期提醒 */
  calm: string;
  calmSoft: string;
  /** 輕度警示（暖黃）— Framing Effect，取代部分紅色場景 */
  gentleWarn: string;
  gentleWarnSoft: string;
  urgent: string;
  urgentSoft: string;
  fresh: string;
  freshSoft: string;
  /** 社交互動（靜宜紫）— Creativity + Social Connection */
  social: string;
  socialSoft: string;
  confidenceHigh: string;
  confidenceHighSoft: string;
  confidenceMedium: string;
  confidenceMediumSoft: string;
  confidenceLow: string;
  confidenceLowSoft: string;
  roleStudent: string;
  roleStudentSoft: string;
  roleTeacher: string;
  roleTeacherSoft: string;
  roleAdmin: string;
  roleAdminSoft: string;
  focusSurface: string;
  /** 語意別名：主色（同 accent，供元件語意化使用） */
  primary: string;
  /** 語意別名：輔色／獎勵色（同 gold） */
  secondary: string;
  /** 卡片／浮起區塊底色 */
  card: string;
  /** 鋪滿主色／accent 按鈕上的文字與圖示（維持對比） */
  onAccent: string;
  /** 底部導覽列半透明底 */
  chromeTabBar: string;
  chromeTabBorder: string;
  chromeTabItemActive: string;
};

export type ThemeShadow = {
  color: string;
  opacity: number;
  radius: number;
  offsetY: number;
  elevation: number;
};

/**
 * Calm Clarity: 單向 elevation 陰影（移除 Neumorphic 雙向陰影）
 * 心理學：明確的物件感知 (Object Perception)，減少認知負荷
 */
export type SoftShadow = {
  shadowColor?: string;
  shadowOpacity?: number;
  shadowRadius?: number;
  shadowOffset?: { width: number; height: number };
  color?: string;
  opacity?: number;
  radius?: number;
  offset?: { width: number; height: number };
  elevation: number;
};

export type ThemeShadows = {
  sm: ThemeShadow;
  md: ThemeShadow;
  lg: ThemeShadow;
  xl: ThemeShadow;
  glow: ThemeShadow;
  /** Legacy soft (kept for compatibility, now uses single-direction elevation) */
  soft: SoftShadow;
  /** Legacy inset (kept for compatibility, now minimal) */
  inset: SoftShadow;
};

export type ThemeRadius = {
  full: number;
  xl: number;
  lg: number;
  md: number;
  sm: number;
  xs: number;
};

export type ThemeSpace = {
  xxs: number;
  xs: number;
  sm: number;
  md: number;
  lg: number;
  xl: number;
  xxl: number;
  xxxl: number;
  /** 區塊間分隔 — 心理分離感 */
  section: number;
};

/**
 * 版面語意權杖：與 space 階梯對齊，避免各處魔法數字。
 * 留白取向：較鬆的垂直節奏、列表分隔與卡片內距，維持校園助手定位但降低壓迫感。
 */
export type ThemeLayout = {
  /** 畫面／捲動內容左右內縮 */
  screenPadding: number;
  /** 與 screenPadding 相同；語意化命名，方便閱讀版面程式 */
  screenHorizontalPadding: number;
  /** 垂直堆疊區塊之間的 gap（ScrollView / 設定列表節奏） */
  sectionGap: number;
  /** 主區塊之間較鬆的節奏（個人頁、公告列表分段） */
  sectionGapLarge: number;
  /** 卡片內距 */
  cardPadding: number;
  /** 列表列垂直內距（維持觸控高度） */
  listItemVertical: number;
  /** FlatList / 搜尋結果等列與列之間的垂直呼吸空間 */
  listSeparatorGap: number;
  /** Screen 內容區頂部與標題列下方的距離 */
  contentPaddingTop: number;
  /** 懸浮按鈕／Tab 中央 AI 球等相對導覽列的位移參考 */
  fabOffset: number;
  /** 浮動 Tab Bar 占用：ScrollView / FlatList 底部留白 */
  scrollBottomInset: number;
};

export type ThemeTypographyScale = {
  fontSize: number;
  lineHeight: number;
  letterSpacing?: number;
  fontWeight?: '400' | '500' | '600' | '700' | '800' | '900';
};

export type ThemeTypography = {
  hero: ThemeTypographyScale;
  display: ThemeTypographyScale;
  h1: ThemeTypographyScale;
  h2: ThemeTypographyScale;
  h3: ThemeTypographyScale;
  body: ThemeTypographyScale;
  bodySmall: ThemeTypographyScale;
  label: ThemeTypographyScale;
  labelSmall: ThemeTypographyScale;
  caption: ThemeTypographyScale;
  /** Eyebrow / overline — 區塊標籤用 */
  overline: ThemeTypographyScale;
};

export type ThemeAnimation = {
  fast: number;
  normal: number;
  slow: number;
  spring: { friction: number; tension: number };
};

/** 全 App 共用的柔和漸層（抽屜頭、個人頁、AI 球） */
export type ThemeGradients = {
  drawerHeader: readonly [string, string];
  profileHero: readonly [string, string, string];
  avatar: readonly [string, string];
  aiOrbNormal: readonly [string, string, string];
  aiOrbUrgent: readonly [string, string, string];
};

export type SchoolBrand = {
  primary: string;
  secondary?: string;
  logo?: string;
};

export type Theme = {
  mode: ThemeMode;
  colors: ThemeColors;
  shadows: ThemeShadows;
  radius: ThemeRadius;
  space: ThemeSpace;
  layout: ThemeLayout;
  typography: ThemeTypography;
  animation: ThemeAnimation;
  gradients: ThemeGradients;
  schoolId?: string;
  brand?: SchoolBrand;
};

const sharedRadius: ThemeRadius = {
  full: 9999,
  xl: 20,
  lg: 16,
  md: 12,
  sm: 8,
  xs: 6,
};

const sharedSpace: ThemeSpace = {
  xxs: 2,
  xs: 4,
  sm: 10,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 44,
  xxxl: 64,
  section: 40,
};

const sharedLayout: ThemeLayout = {
  screenPadding: sharedSpace.md + sharedSpace.xs,
  screenHorizontalPadding: sharedSpace.md + sharedSpace.xs,
  sectionGap: sharedSpace.lg,
  sectionGapLarge: sharedSpace.section,
  cardPadding: sharedSpace.lg,
  listItemVertical: sharedSpace.sm + sharedSpace.xs,
  listSeparatorGap: sharedSpace.sm,
  contentPaddingTop: sharedSpace.md,
  fabOffset: 18,
  scrollBottomInset: 118,
};

/**
 * Tab Bar 留白：source of truth 在 `./navigationTheme.ts`。
 * 這裡保留 re-export shim 給可能還在使用舊路徑的 bundle / stale Metro cache，
 * 避免 _theme.tabBarExtraScrollPadding undefined 的 runtime crash。
 *
 * 用普通 const + 普通 function（不再用 sharedLayout）確保不會 circular。
 */
export const TAB_BAR_SCROLL_BOTTOM_PADDING = 118;

export function tabBarExtraScrollPadding(insetsBottom: number): number {
  return Math.max(0, insetsBottom - 8);
}

const sharedTypography: ThemeTypography = {
  hero: {
    fontSize: 30,
    lineHeight: 38,
    letterSpacing: 0,
    fontWeight: '800',
  },
  display: {
    fontSize: 24,
    lineHeight: 32,
    letterSpacing: 0,
    fontWeight: '700',
  },
  h1: {
    fontSize: 21,
    lineHeight: 29,
    letterSpacing: 0,
    fontWeight: '700',
  },
  h2: {
    fontSize: 19,
    lineHeight: 26,
    letterSpacing: 0,
    fontWeight: '600',
  },
  h3: {
    fontSize: 16,
    lineHeight: 22,
    letterSpacing: 0,
    fontWeight: '600',
  },
  body: {
    fontSize: 15,
    lineHeight: 26,
    letterSpacing: 0,
    fontWeight: '400',
  },
  bodySmall: {
    fontSize: 13,
    lineHeight: 20,
    letterSpacing: 0,
    fontWeight: '400',
  },
  label: {
    fontSize: 14,
    lineHeight: 18,
    letterSpacing: 0,
    fontWeight: '600',
  },
  labelSmall: {
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0,
    fontWeight: '600',
  },
  caption: {
    fontSize: 11,
    lineHeight: 15,
    letterSpacing: 0,
    fontWeight: '500',
  },
  overline: {
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 0,
    fontWeight: '700',
  },
};

const sharedAnimation: ThemeAnimation = {
  fast: 120,
  normal: 220,
  slow: 400,
  spring: { friction: 7, tension: 80 },
};

/*
 * Apple HIG — iOS system surfaces / typography scales；
 * Primary interactive：AI-First 使用 Indigo（見下方 DEFAULT_ACCENT），狀態色仍對齊 iOS system colors。
 * Secondary: campus gold for achievement/reward signal only (kept restrained for low-frequency use).
 */
// ── AI-First v1：主色從校園綠改為 AI Indigo（#6366F1）──
// 此覆寫讓所有沿用 theme.colors.accent 的舊畫面自動變紫色 AI 配色
// 設計總綱：docs/design/AI_FIRST_REDESIGN.md
// Dark theme default accent：較亮一階的 Indigo，在深色系統底上維持對比（對齊 iOS「深色用較亮主色」）
const DEFAULT_ACCENT = '#6366F1';
const DEFAULT_ACCENT_DARK = '#818CF8';
const DEFAULT_GOLD = '#C79532';

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
    : null;
}

function rgba(hex: string, opacity: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return `rgba(91,33,182,${opacity})`;
  return `rgba(${rgb.r},${rgb.g},${rgb.b},${opacity})`;
}

function createAccentSoft(accent: string, opacity: number): string {
  return rgba(accent, opacity);
}

function lighten(hex: string, amount: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const r = Math.min(255, Math.max(0, rgb.r + Math.round((255 - rgb.r) * amount)));
  const g = Math.min(255, Math.max(0, rgb.g + Math.round((255 - rgb.g) * amount)));
  const b = Math.min(255, Math.max(0, rgb.b + Math.round((255 - rgb.b) * amount)));
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

export function createDarkTheme(
  accent: string = DEFAULT_ACCENT_DARK,
  schoolId?: string,
  brand?: SchoolBrand,
): Theme {
  const gold = brand?.secondary ?? DEFAULT_GOLD;
  const orbLilac = lighten(accent, 0.42);
  const orbPeri = lighten('#818CF8', 0.12);
  return {
    mode: 'dark',
    colors: {
      // iOS Dark: 純黑底 + elevated surfaces（systemBackground / secondarySystemBackground）
      bg: '#000000',
      background: '#000000',
      surface: '#1C1C1E',
      surface2: '#2C2C2E',
      surface3: '#3A3A3C',
      surfaceElevated: '#2C2C2E',
      surfaceInteractive: '#2C2C2E',
      surfaceInteractiveStrong: '#3A3A3C',
      surfaceMuted: '#1C1C1E',
      // iOS Dark: separator / opaqueSeparator
      border: '#38383A',
      separator: '#48484A',
      // iOS Dark: label / secondaryLabel / tertiaryLabel
      text: '#FFFFFF',
      textSecondary: '#EBEBF5',
      muted: '#8E8E93',
      accent,
      accentSoft: createAccentSoft(accent, 0.2),
      accentHover: lighten(accent, 0.16),
      accentStrong: lighten(accent, 0.28),
      gold,
      goldSoft: rgba(gold, 0.2),
      gradientStart: accent,
      gradientMid: lighten(accent, 0.18),
      gradientEnd: '#5AC8FA',
      // iOS Dark system colors
      success: '#30D158',
      successSoft: 'rgba(48,209,88,0.16)',
      danger: '#FF453A',
      error: '#FF453A',
      dangerSoft: 'rgba(255,69,58,0.18)',
      warning: '#FF9F0A',
      warningSoft: 'rgba(255,159,10,0.16)',
      info: '#5AC8FA',
      infoSoft: 'rgba(90,200,250,0.16)',
      focusRing: rgba(accent, 0.45),
      overlay: 'rgba(0,0,0,0.6)',
      disabledBg: 'rgba(255,255,255,0.07)',
      disabledText: 'rgba(255,255,255,0.24)',
      cardShadow: 'rgba(0,0,0,0.5)',
      shimmer: 'rgba(255,255,255,0.05)',
      achievement: gold,
      achievementSoft: rgba(gold, 0.2),
      streak: '#FF9F0A',
      streakSoft: 'rgba(255,159,10,0.18)',
      growth: '#30D158',
      growthSoft: 'rgba(48,209,88,0.16)',
      calm: '#5AC8FA',
      calmSoft: 'rgba(90,200,250,0.16)',
      gentleWarn: '#FFD60A',
      gentleWarnSoft: 'rgba(255,214,10,0.16)',
      urgent: '#FF453A',
      urgentSoft: 'rgba(255,69,58,0.16)',
      fresh: '#5AC8FA',
      freshSoft: 'rgba(90,200,250,0.16)',
      // iOS System Purple
      social: '#BF5AF2',
      socialSoft: 'rgba(191,90,242,0.16)',
      confidenceHigh: '#30D158',
      confidenceHighSoft: 'rgba(48,209,88,0.16)',
      confidenceMedium: '#FF9F0A',
      confidenceMediumSoft: 'rgba(255,159,10,0.16)',
      confidenceLow: '#FF453A',
      confidenceLowSoft: 'rgba(255,69,58,0.16)',
      roleStudent: accent,
      roleStudentSoft: createAccentSoft(accent, 0.2),
      roleTeacher: '#BF5AF2',
      roleTeacherSoft: 'rgba(191,90,242,0.16)',
      roleAdmin: gold,
      roleAdminSoft: rgba(gold, 0.2),
      focusSurface: rgba(accent, 0.18),
      primary: accent,
      secondary: gold,
      card: '#1C1C1E',
      onAccent: '#FFFFFF',
      // iOS Tab Bar：blur + translucent
      chromeTabBar: 'rgba(28,28,30,0.94)',
      chromeTabBorder: 'rgba(255,255,255,0.10)',
      chromeTabItemActive: createAccentSoft(accent, 0.22),
    },
    shadows: {
      sm: { color: '#000000', opacity: 0.22, radius: 10, offsetY: 3, elevation: 2 },
      md: { color: '#000000', opacity: 0.30, radius: 18, offsetY: 5, elevation: 5 },
      lg: { color: '#000000', opacity: 0.38, radius: 24, offsetY: 8, elevation: 8 },
      xl: { color: '#000000', opacity: 0.46, radius: 34, offsetY: 12, elevation: 14 },
      glow: { color: accent, opacity: 0.28, radius: 26, offsetY: 0, elevation: 0 },
      soft: {
        shadowColor: '#000000',
        shadowOpacity: 0.26,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 4 },
        elevation: 4,
      },
      inset: {
        shadowColor: '#000000',
        shadowOpacity: 0.16,
        shadowRadius: 4,
        shadowOffset: { width: 0, height: 1 },
        elevation: 0,
      },
    },
    radius: sharedRadius,
    space: sharedSpace,
    layout: sharedLayout,
    typography: sharedTypography,
    animation: sharedAnimation,
    gradients: {
      drawerHeader: ['#2C2C2E', '#000000'] as const,
      profileHero: ['#1C1C1E', '#000000', '#000000'] as const,
      avatar: [lighten(accent, 0.22), accent] as const,
      aiOrbNormal: [orbLilac, lighten(accent, 0.12), orbPeri] as const,
      aiOrbUrgent: ['#FF6961', '#FF453A', '#D70015'] as const,
    },
    schoolId,
    brand,
  };
}

export function createLightTheme(
  accent: string = DEFAULT_ACCENT,
  schoolId?: string,
  brand?: SchoolBrand,
): Theme {
  const gold = brand?.secondary ?? DEFAULT_GOLD;
  /**
   * AI 球等小面積：必須與 chromeTabBar 白／淺灰底有足夠對比；
   * 第三段固定在 accent（辨識度）；前兩段略收斂淺色，避免「发白」淡出。
   */
  const orbTint = lighten(accent, 0.14);
  const orbMid = lighten(accent, 0.02);
  return {
    mode: 'light',
    colors: {
      // iOS Light: 中性灰底（systemGroupedBackground）
      bg: '#F2F2F7',
      background: '#F2F2F7',
      surface: '#FFFFFF',
      surface2: '#F2F2F7',
      surface3: '#E5E5EA',
      surfaceElevated: '#FFFFFF',
      surfaceInteractive: '#F2F2F7',
      surfaceInteractiveStrong: '#E5E5EA',
      surfaceMuted: '#F2F2F7',
      // iOS Light: separator / opaqueSeparator
      border: '#E5E5EA',
      separator: '#C6C6C8',
      /** iOS label：對比約 16:1，符合 WCAG AAA */
      text: '#1C1C1E',
      textSecondary: '#3C3C43',
      /** iOS secondaryLabel（灰 500），約 4.7:1 */
      muted: '#8E8E93',
      accent,
      accentSoft: createAccentSoft(accent, 0.12),
      accentHover: lighten(accent, 0.12),
      accentStrong: lighten(accent, 0.22),
      gold,
      goldSoft: rgba(gold, 0.14),
      /** iOS：大面積漸層用 system 中性灰，accent 僅限按鈕等小面積 */
      gradientStart: '#F2F2F7',
      gradientMid: '#E5E5EA',
      gradientEnd: '#FFFFFF',
      // iOS System Colors (Light)
      success: '#34C759',
      successSoft: 'rgba(52,199,89,0.12)',
      danger: '#FF3B30',
      error: '#FF3B30',
      dangerSoft: 'rgba(255,59,48,0.12)',
      warning: '#FF9500',
      warningSoft: 'rgba(255,149,0,0.12)',
      info: '#5AC8FA',
      infoSoft: 'rgba(90,200,250,0.12)',
      focusRing: rgba(accent, 0.28),
      overlay: 'rgba(0,0,0,0.36)',
      disabledBg: 'rgba(142,142,147,0.12)',
      disabledText: 'rgba(142,142,147,0.55)',
      cardShadow: 'rgba(0,0,0,0.08)',
      shimmer: 'rgba(255,255,255,0.9)',
      achievement: gold,
      achievementSoft: rgba(gold, 0.14),
      streak: '#FF6B35',
      streakSoft: 'rgba(255,107,53,0.12)',
      growth: '#34C759',
      growthSoft: 'rgba(52,199,89,0.12)',
      calm: '#5AC8FA',
      calmSoft: 'rgba(90,200,250,0.12)',
      gentleWarn: '#FFCC00',
      gentleWarnSoft: 'rgba(255,204,0,0.16)',
      urgent: '#FF3B30',
      urgentSoft: 'rgba(255,59,48,0.12)',
      fresh: '#5AC8FA',
      freshSoft: 'rgba(90,200,250,0.12)',
      // iOS System Purple (Light)
      social: '#AF52DE',
      socialSoft: 'rgba(175,82,222,0.12)',
      confidenceHigh: '#34C759',
      confidenceHighSoft: 'rgba(52,199,89,0.12)',
      confidenceMedium: '#FF9500',
      confidenceMediumSoft: 'rgba(255,149,0,0.12)',
      confidenceLow: '#FF3B30',
      confidenceLowSoft: 'rgba(255,59,48,0.12)',
      roleStudent: accent,
      roleStudentSoft: createAccentSoft(accent, 0.12),
      roleTeacher: '#AF52DE',
      roleTeacherSoft: 'rgba(175,82,222,0.12)',
      roleAdmin: gold,
      roleAdminSoft: rgba(gold, 0.14),
      focusSurface: 'rgba(0,0,0,0.04)',
      primary: accent,
      secondary: gold,
      card: '#FFFFFF',
      onAccent: '#FFFFFF',
      // iOS Tab Bar：blur + translucent white
      chromeTabBar: 'rgba(255,255,255,0.94)',
      chromeTabBorder: 'rgba(0,0,0,0.10)',
      chromeTabItemActive: createAccentSoft(accent, 0.10),
    },
    shadows: {
      sm: { color: '#000000', opacity: 0.06, radius: 10, offsetY: 2, elevation: 2 },
      md: { color: '#000000', opacity: 0.08, radius: 18, offsetY: 5, elevation: 5 },
      lg: { color: '#000000', opacity: 0.10, radius: 24, offsetY: 9, elevation: 9 },
      xl: { color: '#000000', opacity: 0.12, radius: 32, offsetY: 13, elevation: 13 },
      glow: { color: accent, opacity: 0.16, radius: 24, offsetY: 0, elevation: 0 },
      soft: {
        shadowColor: '#000000',
        shadowOpacity: 0.07,
        shadowRadius: 14,
        shadowOffset: { width: 0, height: 5 },
        elevation: 5,
      },
      inset: {
        shadowColor: '#000000',
        shadowOpacity: 0.05,
        shadowRadius: 4,
        shadowOffset: { width: 0, height: 1 },
        elevation: 0,
      },
    },
    radius: sharedRadius,
    space: sharedSpace,
    layout: sharedLayout,
    typography: sharedTypography,
    animation: sharedAnimation,
    gradients: {
      drawerHeader: ['#F2F2F7', '#FFFFFF'] as const,
      profileHero: ['#F2F2F7', '#FFFFFF', '#FFFFFF'] as const,
      avatar: [lighten(accent, 0.12), accent] as const,
      aiOrbNormal: [orbTint, orbMid, accent] as const,
      aiOrbUrgent: ['#FFD2D0', '#FF6961', '#FF3B30'] as const,
    },
    schoolId,
    brand,
  };
}

export const darkTheme: Theme = createDarkTheme();
export const lightTheme: Theme = createLightTheme();

export function getTheme(
  mode: ThemeMode,
  accent?: string,
  schoolId?: string,
  brand?: SchoolBrand,
): Theme {
  return mode === 'light'
    ? createLightTheme(accent, schoolId, brand)
    : createDarkTheme(accent, schoolId, brand);
}

export type SchoolThemeConfig = {
  schoolId: string;
  accent: string;
  secondary?: string;
  logo?: string;
};

const schoolThemeRegistry = new Map<string, SchoolThemeConfig>();

export function registerSchoolTheme(config: SchoolThemeConfig): void {
  schoolThemeRegistry.set(config.schoolId, config);
}

export function getSchoolThemeConfig(schoolId: string): SchoolThemeConfig | undefined {
  return schoolThemeRegistry.get(schoolId);
}

export function createSchoolTheme(
  mode: ThemeMode,
  schoolId: string,
  fallbackAccent: string = DEFAULT_ACCENT,
): Theme {
  const config = schoolThemeRegistry.get(schoolId);
  const accent = config?.accent ?? fallbackAccent;
  const brand: SchoolBrand = {
    primary: accent,
    secondary: config?.secondary,
    logo: config?.logo,
  };
  return getTheme(mode, accent, schoolId, brand);
}

let _currentTheme: Theme = lightTheme;
let _themeVersion = 0;
let _currentSchoolId: string | undefined;
const _themeListeners = new Set<(theme: Theme) => void>();

export function subscribeToTheme(listener: (theme: Theme) => void): () => void {
  _themeListeners.add(listener);
  return () => _themeListeners.delete(listener);
}

export function getCurrentTheme(): Theme {
  return _currentTheme;
}

export function getThemeVersion(): number {
  return _themeVersion;
}

export function getCurrentSchoolId(): string | undefined {
  return _currentSchoolId;
}

export const theme: Theme = new Proxy({} as Theme, {
  get(_target, prop: keyof Theme) {
    return _currentTheme[prop];
  },
});

function notifyListeners(newTheme: Theme): void {
  _themeListeners.forEach((listener) => {
    try {
      listener(newTheme);
    } catch (e) {
      console.warn('[theme] Listener error:', e);
    }
  });
}

export function applyTheme(mode: ThemeMode, schoolId?: string, fallbackAccent?: string): void {
  const effectiveSchoolId = schoolId ?? _currentSchoolId;

  let next: Theme;
  if (effectiveSchoolId) {
    next = createSchoolTheme(mode, effectiveSchoolId, fallbackAccent);
  } else if (fallbackAccent) {
    next = getTheme(mode, fallbackAccent);
  } else {
    next = mode === 'light' ? lightTheme : darkTheme;
  }

  const sameCore =
    _currentTheme.mode === next.mode &&
    _currentTheme.schoolId === next.schoolId &&
    _currentTheme.colors.accent === next.colors.accent;
  /** 漸層／品牌球體 token 單獨改版時也要套用，否則 HMR 後仍握著舊 Theme 參考 */
  const sameGradients = JSON.stringify(_currentTheme.gradients) === JSON.stringify(next.gradients);
  if (sameCore && sameGradients) {
    return;
  }

  _currentTheme = next;
  _currentSchoolId = effectiveSchoolId;
  _themeVersion++;

  notifyListeners(next);
}

export function applySchoolTheme(schoolId: string, fallbackAccent?: string): void {
  _currentSchoolId = schoolId;
  applyTheme(_currentTheme.mode, schoolId, fallbackAccent);
}

export function clearSchoolTheme(): void {
  _currentSchoolId = undefined;
  applyTheme(_currentTheme.mode);
}

export function shadowStyle(shadow: ThemeShadow) {
  return {
    shadowColor: shadow.color,
    shadowOpacity: shadow.opacity,
    shadowRadius: shadow.radius,
    shadowOffset: { width: 0, height: shadow.offsetY },
    elevation: shadow.elevation,
  };
}

export function softShadowStyle(shadow: SoftShadow) {
  return {
    shadowColor: shadow.shadowColor ?? shadow.color ?? '#000',
    shadowOpacity: shadow.shadowOpacity ?? shadow.opacity ?? 0.16,
    shadowRadius: shadow.shadowRadius ?? shadow.radius ?? 12,
    shadowOffset: shadow.shadowOffset ?? shadow.offset ?? { width: 0, height: 4 },
    elevation: shadow.elevation,
  };
}
