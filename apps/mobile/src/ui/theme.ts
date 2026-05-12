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
  typography: ThemeTypography;
  animation: ThemeAnimation;
  schoolId?: string;
  brand?: SchoolBrand;
};

const sharedRadius: ThemeRadius = {
  full: 9999,
  xl: 24,
  lg: 18,
  md: 14,
  sm: 10,
  xs: 6,
};

const sharedSpace: ThemeSpace = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
  xxxl: 64,
  section: 40,
};

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
    lineHeight: 24,
    letterSpacing: 0.1,
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
  return {
    mode: 'dark',
    colors: {
      bg: '#0C0A13',
      background: '#0C0A13',
      surface: '#1A1625',
      surface2: '#241F33',
      surface3: '#2E2841',
      surfaceElevated: '#2A2440',
      surfaceInteractive: '#241F33',
      surfaceInteractiveStrong: '#342D4D',
      border: '#332B4D',
      separator: '#2A2440',
      text: '#F5F3FF',
      textSecondary: '#A8A0C0',
      muted: '#7C7496',
      accent,
      accentSoft: createAccentSoft(accent, 0.18),
      accentHover: lighten(accent, 0.16),
      accentStrong: lighten(accent, 0.28),
      gold,
      goldSoft: rgba(gold, 0.18),
      gradientStart: accent,
      gradientMid: '#7C3AED',
      gradientEnd: lighten(accent, 0.3),
      success: '#34D399',
      successSoft: 'rgba(52,211,153,0.16)',
      danger: '#FB7185',
      error: '#FB7185',
      dangerSoft: 'rgba(251,113,133,0.16)',
      warning: '#FBBF24',
      warningSoft: 'rgba(251,191,36,0.16)',
      info: '#818CF8',
      infoSoft: 'rgba(129,140,248,0.16)',
      focusRing: rgba(accent, 0.45),
      overlay: 'rgba(12,10,19,0.80)',
      disabledBg: 'rgba(255,255,255,0.06)',
      disabledText: 'rgba(255,255,255,0.22)',
      cardShadow: 'rgba(0,0,0,0.55)',
      shimmer: 'rgba(255,255,255,0.04)',
      achievement: gold,
      achievementSoft: rgba(gold, 0.18),
      streak: '#FB7185',
      streakSoft: 'rgba(251,113,133,0.16)',
      growth: '#34D399',
      growthSoft: 'rgba(52,211,153,0.16)',
      calm: '#818CF8',
      calmSoft: 'rgba(129,140,248,0.16)',
      gentleWarn: '#FBBF24',
      gentleWarnSoft: 'rgba(251,191,36,0.16)',
      urgent: '#FB7185',
      urgentSoft: 'rgba(251,113,133,0.16)',
      fresh: '#818CF8',
      freshSoft: 'rgba(129,140,248,0.16)',
      social: '#A78BFA',
      socialSoft: 'rgba(167,139,250,0.18)',
      confidenceHigh: '#34D399',
      confidenceHighSoft: 'rgba(52,211,153,0.16)',
      confidenceMedium: '#FBBF24',
      confidenceMediumSoft: 'rgba(251,191,36,0.16)',
      confidenceLow: '#FB7185',
      confidenceLowSoft: 'rgba(251,113,133,0.16)',
      roleStudent: accent,
      roleStudentSoft: createAccentSoft(accent, 0.18),
      roleTeacher: '#34D399',
      roleTeacherSoft: 'rgba(52,211,153,0.16)',
      roleAdmin: gold,
      roleAdminSoft: rgba(gold, 0.18),
      focusSurface: rgba(accent, 0.16),
    },
    shadows: {
      sm: { color: '#0C0A13', opacity: 0.24, radius: 8, offsetY: 2, elevation: 2 },
      md: { color: '#0C0A13', opacity: 0.32, radius: 16, offsetY: 4, elevation: 5 },
      lg: { color: '#0C0A13', opacity: 0.4, radius: 24, offsetY: 8, elevation: 8 },
      xl: { color: '#0C0A13', opacity: 0.5, radius: 36, offsetY: 12, elevation: 14 },
      glow: { color: accent, opacity: 0.3, radius: 24, offsetY: 0, elevation: 0 },
      soft: {
        shadowColor: '#0C0A13',
        shadowOpacity: 0.24,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 3 },
        elevation: 3,
      },
      inset: {
        shadowColor: '#0C0A13',
        shadowOpacity: 0.14,
        shadowRadius: 4,
        shadowOffset: { width: 0, height: 1 },
        elevation: 0,
      },
    },
    radius: sharedRadius,
    space: sharedSpace,
    typography: sharedTypography,
    animation: sharedAnimation,
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
  return {
    mode: 'light',
    colors: {
      bg: '#FAF9FC',
      background: '#FAF9FC',
      surface: '#FFFFFF',
      surface2: '#F3F1F8',
      surface3: '#EBE8F3',
      surfaceElevated: '#FFFFFF',
      surfaceInteractive: '#F3F1F8',
      surfaceInteractiveStrong: '#EBE8F3',
      border: '#E2DFF0',
      separator: '#EBE8F3',
      text: '#1A1333',
      textSecondary: '#5B5270',
      muted: '#9490A8',
      accent,
      accentSoft: createAccentSoft(accent, 0.1),
      accentHover: lighten(accent, 0.12),
      accentStrong: lighten(accent, 0.22),
      gold,
      goldSoft: rgba(gold, 0.12),
      gradientStart: accent,
      gradientMid: '#7C3AED',
      gradientEnd: '#A78BFA',
      success: '#10B981',
      successSoft: 'rgba(16,185,129,0.10)',
      danger: '#EF4444',
      error: '#EF4444',
      dangerSoft: 'rgba(239,68,68,0.10)',
      warning: '#F59E0B',
      warningSoft: 'rgba(245,158,11,0.10)',
      info: '#6366F1',
      infoSoft: 'rgba(99,102,241,0.10)',
      focusRing: rgba(accent, 0.25),
      overlay: 'rgba(26,19,51,0.40)',
      disabledBg: 'rgba(148,144,168,0.12)',
      disabledText: 'rgba(148,144,168,0.55)',
      cardShadow: 'rgba(91,33,182,0.06)',
      shimmer: 'rgba(255,255,255,0.85)',
      achievement: gold,
      achievementSoft: rgba(gold, 0.12),
      streak: '#EF4444',
      streakSoft: 'rgba(239,68,68,0.10)',
      growth: '#10B981',
      growthSoft: 'rgba(16,185,129,0.10)',
      calm: '#6366F1',
      calmSoft: 'rgba(99,102,241,0.10)',
      gentleWarn: '#F59E0B',
      gentleWarnSoft: 'rgba(245,158,11,0.10)',
      urgent: '#EF4444',
      urgentSoft: 'rgba(239,68,68,0.10)',
      fresh: '#6366F1',
      freshSoft: 'rgba(99,102,241,0.10)',
      social: '#7C3AED',
      socialSoft: 'rgba(124,58,237,0.10)',
      confidenceHigh: '#10B981',
      confidenceHighSoft: 'rgba(16,185,129,0.10)',
      confidenceMedium: '#F59E0B',
      confidenceMediumSoft: 'rgba(245,158,11,0.10)',
      confidenceLow: '#EF4444',
      confidenceLowSoft: 'rgba(239,68,68,0.10)',
      roleStudent: accent,
      roleStudentSoft: createAccentSoft(accent, 0.1),
      roleTeacher: '#10B981',
      roleTeacherSoft: 'rgba(16,185,129,0.10)',
      roleAdmin: gold,
      roleAdminSoft: rgba(gold, 0.12),
      focusSurface: rgba(accent, 0.08),
    },
    shadows: {
      sm: { color: '#1A1333', opacity: 0.05, radius: 8, offsetY: 2, elevation: 2 },
      md: { color: '#1A1333', opacity: 0.08, radius: 16, offsetY: 4, elevation: 5 },
      lg: { color: '#1A1333', opacity: 0.1, radius: 24, offsetY: 8, elevation: 8 },
      xl: { color: '#1A1333', opacity: 0.12, radius: 32, offsetY: 12, elevation: 12 },
      glow: { color: accent, opacity: 0.2, radius: 24, offsetY: 0, elevation: 0 },
      soft: {
        shadowColor: '#1A1333',
        shadowOpacity: 0.06,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 3 },
        elevation: 3,
      },
      inset: {
        shadowColor: '#1A1333',
        shadowOpacity: 0.04,
        shadowRadius: 3,
        shadowOffset: { width: 0, height: 1 },
        elevation: 0,
      },
    },
    radius: sharedRadius,
    space: sharedSpace,
    typography: sharedTypography,
    animation: sharedAnimation,
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
