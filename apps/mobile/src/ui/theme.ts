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
  sm: 10,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 44,
  xxxl: 64,
  section: 40,
};

const sharedLayout: ThemeLayout = {
  screenPadding: 22,
  screenHorizontalPadding: 22,
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
    fontSize: 28,
    lineHeight: 38,
    letterSpacing: 0,
    fontWeight: '600',
  },
  display: {
    fontSize: 25,
    lineHeight: 32,
    letterSpacing: 0,
    fontWeight: '600',
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

// Product controls share one palette; school identity remains available as brand metadata.
const DEFAULT_ACCENT = '#314D40';
const DEFAULT_ACCENT_DARK = '#A9C6A3';
const DEFAULT_GOLD = '#8B631E';
const DEFAULT_GOLD_DARK = '#DEC080';

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
  const orbLilac = lighten(accent, 0.42);
  const orbPeri = lighten(accent, 0.12);
  return {
    mode: 'dark',
    colors: {
      bg: '#171F1B',
      background: '#171F1B',
      surface: '#202B24',
      surface2: '#273229',
      surface3: '#344036',
      surfaceElevated: '#273229',
      surfaceInteractive: '#273229',
      surfaceInteractiveStrong: '#344036',
      surfaceMuted: '#202B24',
      border: '#3B473D',
      separator: '#3B473D',
      text: '#EDF2E9',
      textSecondary: '#C5D0C4',
      muted: '#A5B2A6',
      accent,
      accentSoft: createAccentSoft(accent, 0.2),
      accentHover: lighten(accent, 0.16),
      accentStrong: lighten(accent, 0.28),
      gold,
      goldSoft: rgba(gold, 0.2),
      gradientStart: '#273229',
      gradientMid: '#202B24',
      gradientEnd: '#171F1B',
      // Status labels
      success: '#A6CA9E',
      successSoft: 'rgba(166,202,158,0.16)',
      danger: '#EFAC9A',
      error: '#EFAC9A',
      dangerSoft: 'rgba(239,172,154,0.16)',
      warning: '#DEC080',
      warningSoft: 'rgba(222,192,128,0.16)',
      info: '#A7C7CA',
      infoSoft: 'rgba(167,199,202,0.16)',
      focusRing: rgba(accent, 0.45),
      overlay: 'rgba(0,0,0,0.6)',
      disabledBg: 'rgba(255,255,255,0.07)',
      disabledText: 'rgba(255,255,255,0.24)',
      cardShadow: 'rgba(0,0,0,0.5)',
      shimmer: 'rgba(255,255,255,0.05)',
      achievement: gold,
      achievementSoft: rgba(gold, 0.2),
      streak: '#DEC080',
      streakSoft: 'rgba(222,192,128,0.16)',
      growth: '#A6CA9E',
      growthSoft: 'rgba(166,202,158,0.16)',
      calm: '#A7C7CA',
      calmSoft: 'rgba(167,199,202,0.16)',
      gentleWarn: '#DEC080',
      gentleWarnSoft: 'rgba(222,192,128,0.16)',
      urgent: '#EFAC9A',
      urgentSoft: 'rgba(239,172,154,0.16)',
      fresh: '#A7C7CA',
      freshSoft: 'rgba(167,199,202,0.16)',
      // Social labels
      social: '#CFB5C9',
      socialSoft: 'rgba(207,181,201,0.16)',
      confidenceHigh: '#A6CA9E',
      confidenceHighSoft: 'rgba(166,202,158,0.16)',
      confidenceMedium: '#DEC080',
      confidenceMediumSoft: 'rgba(222,192,128,0.16)',
      confidenceLow: '#EFAC9A',
      confidenceLowSoft: 'rgba(239,172,154,0.16)',
      roleStudent: accent,
      roleStudentSoft: createAccentSoft(accent, 0.2),
      roleTeacher: accent,
      roleTeacherSoft: createAccentSoft(accent, 0.2),
      roleAdmin: gold,
      roleAdminSoft: rgba(gold, 0.2),
      focusSurface: rgba(accent, 0.18),
      primary: accent,
      secondary: gold,
      card: '#202B24',
      onAccent: '#17251C',
      onDanger: '#17251C',
      onSuccess: '#17251C',
      // iOS Tab Bar：blur + translucent
      // iOS Tab Bar：半透明使 BlurView 玻璃磨砂可見（與 expo-blur intensity 配合）
      chromeTabBar: 'rgba(32,43,36,0.96)',
      chromeTabBorder: 'rgba(255,255,255,0.10)',
      chromeTabItemActive: createAccentSoft(accent, 0.22),
    },
    shadows: {
      sm: { color: '#000000', opacity: 0.22, radius: 10, offsetY: 3, elevation: 2 },
      md: { color: '#000000', opacity: 0.3, radius: 18, offsetY: 5, elevation: 5 },
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
      drawerHeader: ['#273229', '#202B24'] as const,
      profileHero: ['#273229', '#202B24', '#171F1B'] as const,
      avatar: [lighten(accent, 0.22), accent] as const,
      aiOrbNormal: [orbLilac, lighten(accent, 0.12), orbPeri] as const,
      aiOrbUrgent: ['#FF6961', '#EFAC9A', '#D70015'] as const,
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
      bg: '#F8F7F3',
      background: '#F8F7F3',
      surface: '#FFFFFF',
      surface2: '#EEEEE8',
      surface3: '#E2E7DD',
      surfaceElevated: '#FFFFFF',
      surfaceInteractive: '#EEEEE8',
      surfaceInteractiveStrong: '#E2E7DD',
      surfaceMuted: '#F0F1EB',
      border: '#DDDEDA',
      separator: '#DDDEDA',
      text: '#243B35',
      textSecondary: '#526750',
      muted: '#626E67',
      accent,
      accentSoft: accent === DEFAULT_ACCENT ? '#E6ECE5' : createAccentSoft(accent, 0.12),
      accentHover: lighten(accent, 0.12),
      accentStrong: lighten(accent, 0.22),
      gold,
      goldSoft: rgba(gold, 0.14),
      /** iOS：大面積漸層用 system 中性灰，accent 僅限按鈕等小面積 */
      gradientStart: '#E6ECE5',
      gradientMid: '#F0F1EB',
      gradientEnd: '#F8F7F3',
      // Status labels
      success: '#386146',
      successSoft: '#E6EEE4',
      danger: '#983F32',
      error: '#983F32',
      dangerSoft: '#F7E9E3',
      warning: '#8B631E',
      warningSoft: '#F6EEDA',
      info: '#41646A',
      infoSoft: '#E6EEEE',
      focusRing: rgba(accent, 0.28),
      overlay: 'rgba(0,0,0,0.36)',
      disabledBg: 'rgba(142,142,147,0.12)',
      disabledText: 'rgba(142,142,147,0.55)',
      cardShadow: 'rgba(0,0,0,0.08)',
      shimmer: 'rgba(255,255,255,0.9)',
      achievement: gold,
      achievementSoft: rgba(gold, 0.14),
      streak: '#A54C2B',
      streakSoft: '#F7E9E3',
      growth: '#386146',
      growthSoft: '#E6EEE4',
      calm: '#41646A',
      calmSoft: '#E6EEEE',
      gentleWarn: '#8B631E',
      gentleWarnSoft: '#F6EEDA',
      urgent: '#983F32',
      urgentSoft: '#F7E9E3',
      fresh: '#41646A',
      freshSoft: '#E6EEEE',
      // Social labels
      social: '#765B72',
      socialSoft: '#F0E9EE',
      confidenceHigh: '#386146',
      confidenceHighSoft: '#E6EEE4',
      confidenceMedium: '#8B631E',
      confidenceMediumSoft: '#F6EEDA',
      confidenceLow: '#983F32',
      confidenceLowSoft: '#F7E9E3',
      roleStudent: accent,
      roleStudentSoft: createAccentSoft(accent, 0.12),
      roleTeacher: accent,
      roleTeacherSoft: createAccentSoft(accent, 0.12),
      roleAdmin: gold,
      roleAdminSoft: rgba(gold, 0.14),
      focusSurface: '#E6ECE5',
      primary: accent,
      secondary: gold,
      card: '#FFFFFF',
      onAccent: '#FFFFFF',
      onDanger: '#FFFFFF',
      onSuccess: '#FFFFFF',
      // iOS Tab Bar：blur + translucent white
      // iOS Tab Bar：半透明使 BlurView 玻璃磨砂可見（與 expo-blur intensity 配合）
      chromeTabBar: 'rgba(255,255,255,0.96)',
      chromeTabBorder: '#DDDEDA',
      chromeTabItemActive: createAccentSoft(accent, 0.1),
    },
    shadows: {
      sm: { color: '#000000', opacity: 0.06, radius: 10, offsetY: 2, elevation: 2 },
      md: { color: '#000000', opacity: 0.08, radius: 18, offsetY: 5, elevation: 5 },
      lg: { color: '#000000', opacity: 0.1, radius: 24, offsetY: 9, elevation: 9 },
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
      drawerHeader: ['#E6ECE5', '#F8F7F3'] as const,
      profileHero: ['#E6ECE5', '#F0F1EB', '#F8F7F3'] as const,
      avatar: [lighten(accent, 0.12), accent] as const,
      aiOrbNormal: [orbTint, orbMid, accent] as const,
      aiOrbUrgent: ['#FFD2D0', '#FF6961', '#983F32'] as const,
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
