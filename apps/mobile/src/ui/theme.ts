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
  xl: 28,
  lg: 22,
  md: 18,
  sm: 14,
  xs: 10,
};

const sharedSpace: ThemeSpace = {
  xxs: 2,
  xs: 4,
  sm: 12,
  md: 20,
  lg: 32,
  xl: 40,
  xxl: 56,
  xxxl: 80,
  section: 56,
};

const sharedLayout: ThemeLayout = {
  screenPadding: sharedSpace.lg + sharedSpace.xs,
  screenHorizontalPadding: sharedSpace.lg + sharedSpace.xs,
  sectionGap: sharedSpace.md + sharedSpace.md,
  sectionGapLarge: sharedSpace.section,
  cardPadding: sharedSpace.xl,
  listItemVertical: sharedSpace.sm + sharedSpace.xs,
  listSeparatorGap: sharedSpace.md,
  contentPaddingTop: sharedSpace.lg,
  fabOffset: 20,
  scrollBottomInset: 130,
};

/** 與浮動 Tab Bar 對齊的捲動底部留白（供 navigationTheme 轉匯） */
export const TAB_BAR_SCROLL_BOTTOM_PADDING = sharedLayout.scrollBottomInset;

const sharedTypography: ThemeTypography = {
  hero: {
    fontSize: 32,
    lineHeight: 40,
    letterSpacing: -0.8,
    fontWeight: '800',
  },
  display: {
    fontSize: 26,
    lineHeight: 34,
    letterSpacing: -0.5,
    fontWeight: '700',
  },
  h1: {
    fontSize: 22,
    lineHeight: 30,
    letterSpacing: -0.3,
    fontWeight: '700',
  },
  h2: {
    fontSize: 19,
    lineHeight: 26,
    letterSpacing: -0.2,
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
    letterSpacing: 0.06,
    fontWeight: '400',
  },
  bodySmall: {
    fontSize: 13,
    lineHeight: 20,
    letterSpacing: 0.1,
    fontWeight: '400',
  },
  label: {
    fontSize: 14,
    lineHeight: 18,
    letterSpacing: 0.2,
    fontWeight: '600',
  },
  labelSmall: {
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.3,
    fontWeight: '600',
  },
  caption: {
    fontSize: 11,
    lineHeight: 15,
    letterSpacing: 0.4,
    fontWeight: '500',
  },
  overline: {
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 1.5,
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
 * 靜宜紫金 — Providence University Brand
 * Primary: 靜宜紫 #5B21B6 (Violet-700) — 高貴、學術、創新
 * Secondary: 靜宜金 #D4A843 — 成就、溫暖、信賴
 * 紫色在高等教育中象徵智慧與創造力，金色則傳達價值與獎勵
 */
const DEFAULT_ACCENT = '#5B21B6';
const DEFAULT_GOLD = '#D4A843';

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
  accent: string = DEFAULT_ACCENT,
  schoolId?: string,
  brand?: SchoolBrand,
): Theme {
  const gold = brand?.secondary ?? DEFAULT_GOLD;
  const orbLilac = lighten(accent, 0.42);
  const orbPeri = lighten('#818CF8', 0.12);
  return {
    mode: 'dark',
    colors: {
      bg: '#15121E',
      background: '#15121E',
      surface: '#211C2E',
      surface2: '#2B253A',
      surface3: '#352F45',
      surfaceElevated: '#2F2842',
      surfaceInteractive: '#2B253A',
      surfaceInteractiveStrong: '#3A3350',
      surfaceMuted: '#1A1628',
      border: '#3E3758',
      separator: '#302A44',
      text: '#F7F4FF',
      textSecondary: '#B4ABCC',
      muted: '#8C85A3',
      accent,
      accentSoft: createAccentSoft(accent, 0.2),
      accentHover: lighten(accent, 0.16),
      accentStrong: lighten(accent, 0.28),
      gold,
      goldSoft: rgba(gold, 0.2),
      gradientStart: accent,
      gradientMid: '#8B7FD8',
      gradientEnd: lighten(accent, 0.32),
      success: '#5EEAD4',
      successSoft: 'rgba(94,234,212,0.14)',
      danger: '#FDA4AF',
      error: '#FDA4AF',
      dangerSoft: 'rgba(253,164,175,0.14)',
      warning: '#FCD34D',
      warningSoft: 'rgba(252,211,77,0.14)',
      info: '#A5B4FC',
      infoSoft: 'rgba(165,180,252,0.14)',
      focusRing: rgba(accent, 0.45),
      overlay: 'rgba(12,10,19,0.78)',
      disabledBg: 'rgba(255,255,255,0.07)',
      disabledText: 'rgba(255,255,255,0.24)',
      cardShadow: 'rgba(0,0,0,0.5)',
      shimmer: 'rgba(255,255,255,0.05)',
      achievement: gold,
      achievementSoft: rgba(gold, 0.2),
      streak: '#FDA4AF',
      streakSoft: 'rgba(253,164,175,0.14)',
      growth: '#5EEAD4',
      growthSoft: 'rgba(94,234,212,0.14)',
      calm: '#A5B4FC',
      calmSoft: 'rgba(165,180,252,0.14)',
      gentleWarn: '#FCD34D',
      gentleWarnSoft: 'rgba(252,211,77,0.14)',
      urgent: '#FDA4AF',
      urgentSoft: 'rgba(253,164,175,0.14)',
      fresh: '#A5B4FC',
      freshSoft: 'rgba(165,180,252,0.14)',
      social: '#C4B5FD',
      socialSoft: 'rgba(196,181,253,0.18)',
      confidenceHigh: '#5EEAD4',
      confidenceHighSoft: 'rgba(94,234,212,0.14)',
      confidenceMedium: '#FCD34D',
      confidenceMediumSoft: 'rgba(252,211,77,0.14)',
      confidenceLow: '#FDA4AF',
      confidenceLowSoft: 'rgba(253,164,175,0.14)',
      roleStudent: accent,
      roleStudentSoft: createAccentSoft(accent, 0.2),
      roleTeacher: '#5EEAD4',
      roleTeacherSoft: 'rgba(94,234,212,0.14)',
      roleAdmin: gold,
      roleAdminSoft: rgba(gold, 0.2),
      focusSurface: rgba(accent, 0.18),
      primary: accent,
      secondary: gold,
      card: '#2F2842',
      onAccent: '#FFFFFF',
      chromeTabBar: 'rgba(40,36,56,0.96)',
      chromeTabBorder: 'rgba(255,255,255,0.09)',
      chromeTabItemActive: createAccentSoft(accent, 0.22),
    },
    shadows: {
      sm: { color: '#0B0912', opacity: 0.22, radius: 10, offsetY: 3, elevation: 2 },
      md: { color: '#0B0912', opacity: 0.3, radius: 18, offsetY: 5, elevation: 5 },
      lg: { color: '#0B0912', opacity: 0.38, radius: 26, offsetY: 8, elevation: 8 },
      xl: { color: '#0B0912', opacity: 0.46, radius: 38, offsetY: 12, elevation: 14 },
      glow: { color: accent, opacity: 0.28, radius: 26, offsetY: 0, elevation: 0 },
      soft: {
        shadowColor: '#0B0912',
        shadowOpacity: 0.26,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 4 },
        elevation: 4,
      },
      inset: {
        shadowColor: '#0B0912',
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
      drawerHeader: ['#3D3558', '#221B32'] as const,
      profileHero: ['#3D3558', '#261F38', '#15121E'] as const,
      avatar: [lighten(accent, 0.22), accent] as const,
      aiOrbNormal: [orbLilac, lighten(accent, 0.12), orbPeri] as const,
      aiOrbUrgent: ['#FECDD3', '#FB7185', '#9F1239'] as const,
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
  const orbLilac = '#DDD6FE';
  const orbPeri = '#C4D0FF';
  return {
    mode: 'light',
    colors: {
      bg: '#FCF8FB',
      background: '#FCF8FB',
      surface: '#FFFCFD',
      surface2: '#F3ECFA',
      surface3: '#EDE5F5',
      surfaceElevated: '#FFFFFF',
      surfaceInteractive: '#F3ECFA',
      surfaceInteractiveStrong: '#EDE5F5',
      surfaceMuted: '#EFE6F7',
      border: '#E5DEF0',
      separator: '#EDE5F5',
      text: '#18122E',
      textSecondary: '#564F6D',
      muted: '#8F89A3',
      accent,
      accentSoft: createAccentSoft(accent, 0.12),
      accentHover: lighten(accent, 0.12),
      accentStrong: lighten(accent, 0.22),
      gold,
      goldSoft: rgba(gold, 0.14),
      gradientStart: accent,
      gradientMid: '#8B7FD8',
      gradientEnd: '#C4B5FD',
      success: '#0D9F7A',
      successSoft: 'rgba(13,159,122,0.11)',
      danger: '#DC3D4E',
      error: '#DC3D4E',
      dangerSoft: 'rgba(220,61,78,0.11)',
      warning: '#D97706',
      warningSoft: 'rgba(217,119,6,0.11)',
      info: '#5B63E8',
      infoSoft: 'rgba(91,99,232,0.11)',
      focusRing: rgba(accent, 0.28),
      overlay: 'rgba(24,18,46,0.38)',
      disabledBg: 'rgba(143,137,163,0.12)',
      disabledText: 'rgba(143,137,163,0.55)',
      cardShadow: 'rgba(91,33,182,0.07)',
      shimmer: 'rgba(255,255,255,0.9)',
      achievement: gold,
      achievementSoft: rgba(gold, 0.14),
      streak: '#DC3D4E',
      streakSoft: 'rgba(220,61,78,0.11)',
      growth: '#0D9F7A',
      growthSoft: 'rgba(13,159,122,0.11)',
      calm: '#5B63E8',
      calmSoft: 'rgba(91,99,232,0.11)',
      gentleWarn: '#D97706',
      gentleWarnSoft: 'rgba(217,119,6,0.11)',
      urgent: '#DC3D4E',
      urgentSoft: 'rgba(220,61,78,0.11)',
      fresh: '#5B63E8',
      freshSoft: 'rgba(91,99,232,0.11)',
      social: '#6D4FB8',
      socialSoft: 'rgba(124,92,237,0.12)',
      confidenceHigh: '#0D9F7A',
      confidenceHighSoft: 'rgba(13,159,122,0.11)',
      confidenceMedium: '#D97706',
      confidenceMediumSoft: 'rgba(217,119,6,0.11)',
      confidenceLow: '#DC3D4E',
      confidenceLowSoft: 'rgba(220,61,78,0.11)',
      roleStudent: accent,
      roleStudentSoft: createAccentSoft(accent, 0.12),
      roleTeacher: '#0D9F7A',
      roleTeacherSoft: 'rgba(13,159,122,0.11)',
      roleAdmin: gold,
      roleAdminSoft: rgba(gold, 0.14),
      focusSurface: rgba(accent, 0.1),
      primary: accent,
      secondary: gold,
      card: '#FFFCFD',
      onAccent: '#FFFFFF',
      chromeTabBar: 'rgba(255,252,253,0.97)',
      chromeTabBorder: 'rgba(126,109,169,0.14)',
      chromeTabItemActive: createAccentSoft(accent, 0.14),
    },
    shadows: {
      sm: { color: '#2C2248', opacity: 0.11, radius: 12, offsetY: 4, elevation: 3 },
      md: { color: '#2C2248', opacity: 0.16, radius: 22, offsetY: 6, elevation: 6 },
      lg: { color: '#2C2248', opacity: 0.2, radius: 28, offsetY: 10, elevation: 10 },
      xl: { color: '#2C2248', opacity: 0.24, radius: 36, offsetY: 14, elevation: 14 },
      glow: { color: accent, opacity: 0.22, radius: 26, offsetY: 0, elevation: 0 },
      soft: {
        shadowColor: '#2C2248',
        shadowOpacity: 0.12,
        shadowRadius: 14,
        shadowOffset: { width: 0, height: 5 },
        elevation: 5,
      },
      inset: {
        shadowColor: '#2C2248',
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
      drawerHeader: ['#EDE9FF', '#FFF5FB'] as const,
      profileHero: ['#EDE9FF', '#FFF5FB', '#FCF8FB'] as const,
      avatar: [lighten(accent, 0.12), accent] as const,
      aiOrbNormal: [orbLilac, lighten(accent, 0.08), orbPeri] as const,
      aiOrbUrgent: ['#FECACA', lighten('#FB7185', 0.08), '#E11D48'] as const,
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

  if (
    _currentTheme.mode === next.mode &&
    _currentTheme.schoolId === next.schoolId &&
    _currentTheme.colors.accent === next.colors.accent
  ) {
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
