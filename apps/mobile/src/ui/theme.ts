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
  /** 用於獎勵與重點標示 */
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
  /** 狀態、進度與提醒 */
  /** 成就／獎勵 */
  achievement: string;
  achievementSoft: string;
  /** 連續打卡 */
  streak: string;
  streakSoft: string;
  /** 成長／完成 */
  growth: string;
  growthSoft: string;
  /** 一般提醒 */
  calm: string;
  calmSoft: string;
  /** 非緊急警示 */
  gentleWarn: string;
  gentleWarnSoft: string;
  urgent: string;
  urgentSoft: string;
  fresh: string;
  freshSoft: string;
  /** 社交互動 */
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
  /** 實心狀態標籤上的文字與圖示 */
  onDanger: string;
  onSuccess: string;
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

/** 共用陰影，保留舊元件支援的屬性。 */
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
  /** 區塊間分隔 */
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
  xl: 12,
  lg: 8,
  md: 6,
  sm: 4,
  xs: 3,
};

const sharedSpace: ThemeSpace = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 16,
  lg: 22,
  xl: 30,
  xxl: 40,
  xxxl: 56,
  section: 32,
};

const sharedLayout: ThemeLayout = {
  screenPadding: 20,
  screenHorizontalPadding: 20,
  sectionGap: sharedSpace.lg,
  sectionGapLarge: sharedSpace.section,
  cardPadding: sharedSpace.md,
  listItemVertical: 13,
  listSeparatorGap: sharedSpace.sm,
  contentPaddingTop: sharedSpace.md,
  fabOffset: 18,
  scrollBottomInset: 96,
};

/**
 * Tab Bar 留白：source of truth 在 `./navigationTheme.ts`。
 * 這裡保留 re-export shim 給可能還在使用舊路徑的 bundle / stale Metro cache，
 * 避免 _theme.tabBarExtraScrollPadding undefined 的 runtime crash。
 *
 * 用普通 const + 普通 function（不再用 sharedLayout）確保不會 circular。
 */
export const TAB_BAR_SCROLL_BOTTOM_PADDING = 96;

export function tabBarExtraScrollPadding(insetsBottom: number): number {
  return Math.max(0, insetsBottom - 8);
}

const sharedTypography: ThemeTypography = {
  hero: {
    fontSize: 26,
    lineHeight: 33,
    letterSpacing: -0.4,
    fontWeight: '700',
  },
  display: {
    fontSize: 23,
    lineHeight: 30,
    letterSpacing: -0.3,
    fontWeight: '700',
  },
  h1: {
    fontSize: 20,
    lineHeight: 26,
    letterSpacing: -0.2,
    fontWeight: '700',
  },
  h2: {
    fontSize: 17,
    lineHeight: 23,
    letterSpacing: -0.15,
    fontWeight: '600',
  },
  h3: {
    fontSize: 15,
    lineHeight: 21,
    letterSpacing: -0.1,
    fontWeight: '600',
  },
  body: {
    fontSize: 15,
    lineHeight: 22,
    letterSpacing: 0,
    fontWeight: '400',
  },
  bodySmall: {
    fontSize: 13,
    lineHeight: 19,
    letterSpacing: 0,
    fontWeight: '400',
  },
  label: {
    fontSize: 13,
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
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0,
    fontWeight: '500',
  },
  overline: {
    fontSize: 11,
    lineHeight: 15,
    letterSpacing: 0.6,
    fontWeight: '600',
  },
};

const sharedAnimation: ThemeAnimation = {
  fast: 120,
  normal: 220,
  slow: 400,
  spring: { friction: 7, tension: 80 },
};

// Product controls share one palette; school identity remains available as brand metadata.
const DEFAULT_ACCENT = '#214C3D';
const DEFAULT_ACCENT_DARK = '#8FC4A3';
const DEFAULT_GOLD = '#7F5512';
const DEFAULT_GOLD_DARK = '#E2C17D';

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
  if (!rgb) return `rgba(40,72,59,${opacity})`;
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
  const gold = brand?.secondary ?? DEFAULT_GOLD_DARK;
  const orbLilac = lighten(accent, 0.36);
  const orbPeri = lighten(accent, 0.1);
  return {
    mode: 'dark',
    colors: {
      bg: '#000000',
      background: '#000000',
      surface: '#111312',
      surface2: '#1A1D1B',
      surface3: '#242826',
      surfaceElevated: '#1A1D1B',
      surfaceInteractive: '#1E2220',
      surfaceInteractiveStrong: '#2A2F2C',
      surfaceMuted: '#0A0B0A',
      border: '#262A28',
      separator: '#262A28',
      text: '#F3F4F2',
      textSecondary: '#C5CBC7',
      muted: '#969E99',
      accent,
      accentSoft: createAccentSoft(accent, 0.14),
      accentHover: lighten(accent, 0.14),
      accentStrong: lighten(accent, 0.24),
      gold,
      goldSoft: rgba(gold, 0.18),
      gradientStart: '#161917',
      gradientMid: '#0D0F0E',
      gradientEnd: '#000000',
      // Status labels
      success: '#93C7A1',
      successSoft: 'rgba(147,199,161,0.16)',
      danger: '#F2A79B',
      error: '#F2A79B',
      dangerSoft: 'rgba(242,167,155,0.16)',
      warning: '#E2C17D',
      warningSoft: 'rgba(226,193,125,0.16)',
      info: '#9AC5CB',
      infoSoft: 'rgba(154,197,203,0.16)',
      focusRing: accent,
      overlay: 'rgba(0,0,0,0.68)',
      disabledBg: 'rgba(255,255,255,0.06)',
      disabledText: 'rgba(255,255,255,0.3)',
      cardShadow: 'rgba(0,0,0,0.4)',
      shimmer: 'rgba(255,255,255,0.05)',
      achievement: gold,
      achievementSoft: rgba(gold, 0.18),
      streak: '#E2C17D',
      streakSoft: 'rgba(226,193,125,0.16)',
      growth: '#93C7A1',
      growthSoft: 'rgba(147,199,161,0.16)',
      calm: '#9AC5CB',
      calmSoft: 'rgba(154,197,203,0.16)',
      gentleWarn: '#E2C17D',
      gentleWarnSoft: 'rgba(226,193,125,0.16)',
      urgent: '#F2A79B',
      urgentSoft: 'rgba(242,167,155,0.16)',
      fresh: '#9AC5CB',
      freshSoft: 'rgba(154,197,203,0.16)',
      // Social labels
      social: '#CEB4C8',
      socialSoft: 'rgba(206,180,200,0.16)',
      confidenceHigh: '#93C7A1',
      confidenceHighSoft: 'rgba(147,199,161,0.16)',
      confidenceMedium: '#E2C17D',
      confidenceMediumSoft: 'rgba(226,193,125,0.16)',
      confidenceLow: '#F2A79B',
      confidenceLowSoft: 'rgba(242,167,155,0.16)',
      roleStudent: accent,
      roleStudentSoft: createAccentSoft(accent, 0.18),
      roleTeacher: accent,
      roleTeacherSoft: createAccentSoft(accent, 0.18),
      roleAdmin: gold,
      roleAdminSoft: rgba(gold, 0.18),
      focusSurface: '#101713',
      primary: accent,
      secondary: gold,
      card: '#111312',
      onAccent: '#0B1610',
      onDanger: '#1A0B09',
      onSuccess: '#0B1610',
      chromeTabBar: '#0D0E0D',
      chromeTabBorder: '#262A28',
      chromeTabItemActive: createAccentSoft(accent, 0.14),
    },
    shadows: {
      sm: { color: '#000000', opacity: 0.08, radius: 2, offsetY: 1, elevation: 0 },
      md: { color: '#000000', opacity: 0.12, radius: 4, offsetY: 1, elevation: 1 },
      lg: { color: '#000000', opacity: 0.16, radius: 8, offsetY: 2, elevation: 2 },
      xl: { color: '#000000', opacity: 0.2, radius: 12, offsetY: 3, elevation: 3 },
      glow: { color: accent, opacity: 0.04, radius: 6, offsetY: 0, elevation: 0 },
      soft: {
        shadowColor: '#000000',
        shadowOpacity: 0.08,
        shadowRadius: 3,
        shadowOffset: { width: 0, height: 1 },
        elevation: 0,
      },
      inset: {
        shadowColor: '#000000',
        shadowOpacity: 0.06,
        shadowRadius: 1,
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
      drawerHeader: ['#111312', '#000000'] as const,
      profileHero: ['#161917', '#0D0F0E', '#000000'] as const,
      avatar: [lighten(accent, 0.18), accent] as const,
      aiOrbNormal: [orbLilac, lighten(accent, 0.1), orbPeri] as const,
      aiOrbUrgent: ['#FF6961', '#F2A79B', '#D70015'] as const,
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
      bg: '#FAF8F2',
      background: '#FAF8F2',
      surface: '#FFFFFF',
      surface2: '#EFECE5',
      surface3: '#E5E2D9',
      surfaceElevated: '#FFFFFF',
      surfaceInteractive: '#EFECE5',
      surfaceInteractiveStrong: '#E5E2D9',
      surfaceMuted: '#F4F3EE',
      border: '#E2E0D8',
      separator: '#E2E0D8',
      text: '#24251F',
      textSecondary: '#44504A',
      muted: '#5C6761',
      accent,
      accentSoft: accent === DEFAULT_ACCENT ? '#E8F0EC' : createAccentSoft(accent, 0.1),
      accentHover: lighten(accent, 0.1),
      accentStrong: lighten(accent, 0.2),
      gold,
      goldSoft: rgba(gold, 0.12),
      /** 大面積背景維持紙感中性灰，accent 留給主行動與關鍵識別 */
      gradientStart: '#F4F3EE',
      gradientMid: '#F7F6F2',
      gradientEnd: '#FAF8F2',
      // Status labels
      success: '#235C3E',
      successSoft: '#E7F1EB',
      danger: '#9E2F26',
      error: '#9E2F26',
      dangerSoft: '#F9EAE8',
      warning: '#7F5512',
      warningSoft: '#F7EFE0',
      info: '#285963',
      infoSoft: '#E7F0F2',
      focusRing: rgba(accent, 0.26),
      overlay: 'rgba(23,30,27,0.42)',
      disabledBg: 'rgba(130,136,132,0.12)',
      disabledText: 'rgba(92,103,97,0.52)',
      cardShadow: 'rgba(23,30,27,0.04)',
      shimmer: 'rgba(255,255,255,0.9)',
      achievement: gold,
      achievementSoft: rgba(gold, 0.12),
      streak: '#9A4322',
      streakSoft: '#F9EAE5',
      growth: '#235C3E',
      growthSoft: '#E7F1EB',
      calm: '#285963',
      calmSoft: '#E7F0F2',
      gentleWarn: '#7F5512',
      gentleWarnSoft: '#F7EFE0',
      urgent: '#9E2F26',
      urgentSoft: '#F9EAE8',
      fresh: '#285963',
      freshSoft: '#E7F0F2',
      // Social labels
      social: '#6B5267',
      socialSoft: '#F1EBF0',
      confidenceHigh: '#235C3E',
      confidenceHighSoft: '#E7F1EB',
      confidenceMedium: '#7F5512',
      confidenceMediumSoft: '#F7EFE0',
      confidenceLow: '#9E2F26',
      confidenceLowSoft: '#F9EAE8',
      roleStudent: accent,
      roleStudentSoft: createAccentSoft(accent, 0.1),
      roleTeacher: accent,
      roleTeacherSoft: createAccentSoft(accent, 0.1),
      roleAdmin: gold,
      roleAdminSoft: rgba(gold, 0.12),
      focusSurface: '#F2F6F4',
      primary: accent,
      secondary: gold,
      card: '#FFFFFF',
      onAccent: '#FFFFFF',
      onDanger: '#FFFFFF',
      onSuccess: '#FFFFFF',
      chromeTabBar: 'rgba(250,249,246,0.96)',
      chromeTabBorder: '#E2E0D8',
      chromeTabItemActive: createAccentSoft(accent, 0.1),
    },
    shadows: {
      sm: { color: '#171E1B', opacity: 0.02, radius: 2, offsetY: 1, elevation: 0 },
      md: { color: '#171E1B', opacity: 0.03, radius: 4, offsetY: 1, elevation: 1 },
      lg: { color: '#171E1B', opacity: 0.04, radius: 8, offsetY: 2, elevation: 2 },
      xl: { color: '#171E1B', opacity: 0.06, radius: 12, offsetY: 3, elevation: 3 },
      glow: { color: accent, opacity: 0.04, radius: 6, offsetY: 0, elevation: 0 },
      soft: {
        shadowColor: '#171E1B',
        shadowOpacity: 0.025,
        shadowRadius: 3,
        shadowOffset: { width: 0, height: 1 },
        elevation: 0,
      },
      inset: {
        shadowColor: '#171E1B',
        shadowOpacity: 0.02,
        shadowRadius: 1,
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
      drawerHeader: ['#F4F3EE', '#FAF8F2'] as const,
      profileHero: ['#F4F3EE', '#F7F6F2', '#FAF8F2'] as const,
      avatar: [lighten(accent, 0.12), accent] as const,
      aiOrbNormal: [orbTint, orbMid, accent] as const,
      aiOrbUrgent: ['#FFD2D0', '#FF6961', '#9E2F26'] as const,
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
  return getTheme(mode, undefined, schoolId, brand);
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
