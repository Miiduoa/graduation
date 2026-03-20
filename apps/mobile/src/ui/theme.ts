export type ThemeMode = "dark" | "light";

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
  gradientStart: string;
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
  /** 成就/獎勵（暖琥珀）— Variable Reward + Competence */
  achievement: string;
  achievementSoft: string;
  /** 連續打卡 Streak（活力橘紅）— Habit Loop + Loss Aversion */
  streak: string;
  streakSoft: string;
  /** 成長/完成（森林綠）— Growth Mindset + Competence */
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
  /** 社交互動（紫）— Creativity + Social Connection */
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
  shadowColor: string;
  shadowOpacity: number;
  shadowRadius: number;
  shadowOffset: { width: number; height: number };
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
  fontWeight?: "400" | "500" | "600" | "700" | "800" | "900";
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
  lg: 20,
  md: 14,
  sm: 10,
  xs: 8,
};

const sharedSpace: ThemeSpace = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 16,   // Gestalt Proximity: 調整為 16，讓相關元素更緊密
  lg: 24,
  xl: 32,
  xxl: 48,
  xxxl: 64,
  section: 40, // 區塊間心理分離感
};

const sharedTypography: ThemeTypography = {
  // 認知流暢性：從 40px 降至 34px，避免過大文字降低閱讀效率
  hero: {
    fontSize: 34,
    lineHeight: 42,
    letterSpacing: -1,
    fontWeight: "900",
  },
  display: {
    fontSize: 28,
    lineHeight: 36,
    letterSpacing: -0.6,
    fontWeight: "800",
  },
  h1: {
    fontSize: 24,
    lineHeight: 32,
    letterSpacing: -0.4,
    fontWeight: "700",
  },
  h2: {
    fontSize: 20,
    lineHeight: 28,
    letterSpacing: -0.3,
    fontWeight: "700",
  },
  h3: {
    fontSize: 17,
    lineHeight: 24,
    letterSpacing: -0.1,
    fontWeight: "600",
  },
  // 閱讀心理學：1.6x 行高是最佳可讀性
  body: {
    fontSize: 15,
    lineHeight: 24,
    fontWeight: "400",
  },
  bodySmall: {
    fontSize: 13,
    lineHeight: 20,
    fontWeight: "400",
  },
  label: {
    fontSize: 14,
    lineHeight: 18,
    letterSpacing: 0.1,
    fontWeight: "600",
  },
  labelSmall: {
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.2,
    fontWeight: "600",
  },
  caption: {
    fontSize: 11,
    lineHeight: 15,
    letterSpacing: 0.3,
    fontWeight: "500",
  },
  // 新增 overline: 用於區塊 eyebrow 標籤
  overline: {
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 1.5,
    fontWeight: "700",
  },
};

const sharedAnimation: ThemeAnimation = {
  fast: 150,
  normal: 250,
  slow: 450,
  spring: { friction: 8, tension: 65 },
};

// 新主色：靛藍 #2563EB — 藍色在教育情境中最能引發信任與專注 (Mehta & Zhu, 2009)
const DEFAULT_ACCENT = "#2563EB";

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
  if (!rgb) return `rgba(37,99,235,${opacity})`;
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
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

export function createDarkTheme(accent: string = DEFAULT_ACCENT, schoolId?: string, brand?: SchoolBrand): Theme {
  return {
    mode: "dark",
    colors: {
      bg: "#0F1117",
      background: "#0F1117",
      surface: "#1A1D27",
      surface2: "#222535",
      surface3: "#2A2E40",
      surfaceElevated: "#30344A",
      surfaceInteractive: "#1E2233",
      surfaceInteractiveStrong: "#1A2B5E",
      border: "#2A2E40",
      separator: "#2A2E40",
      text: "#F0F2FF",
      textSecondary: "#B0B8D4",
      muted: "#6B7399",
      accent,
      accentSoft: createAccentSoft(accent, 0.16),
      accentHover: lighten(accent, 0.14),
      accentStrong: lighten(accent, 0.24),
      gradientStart: accent,
      gradientEnd: lighten(accent, 0.26),
      success: "#34D399",
      successSoft: "rgba(52,211,153,0.15)",
      danger: "#F87171",
      error: "#F87171",
      dangerSoft: "rgba(248,113,113,0.15)",
      warning: "#FBBF24",
      warningSoft: "rgba(251,191,36,0.15)",
      info: "#60A5FA",
      infoSoft: "rgba(96,165,250,0.15)",
      focusRing: rgba(accent, 0.40),
      overlay: "rgba(0,0,0,0.70)",
      disabledBg: "rgba(255,255,255,0.06)",
      disabledText: "rgba(255,255,255,0.24)",
      cardShadow: "rgba(0,0,0,0.50)",
      shimmer: "rgba(255,255,255,0.05)",
      achievement: "#FBBF24",
      achievementSoft: "rgba(251,191,36,0.16)",
      streak: "#FB7185",
      streakSoft: "rgba(251,113,133,0.16)",
      growth: "#34D399",
      growthSoft: "rgba(52,211,153,0.15)",
      calm: "#60A5FA",
      calmSoft: "rgba(96,165,250,0.15)",
      gentleWarn: "#FCD34D",
      gentleWarnSoft: "rgba(252,211,77,0.15)",
      urgent: "#FB923C",
      urgentSoft: "rgba(251,146,60,0.16)",
      fresh: "#22D3EE",
      freshSoft: "rgba(34,211,238,0.15)",
      social: "#38BDF8",
      socialSoft: "rgba(56,189,248,0.16)",
      confidenceHigh: "#34D399",
      confidenceHighSoft: "rgba(52,211,153,0.16)",
      confidenceMedium: "#FCD34D",
      confidenceMediumSoft: "rgba(252,211,77,0.15)",
      confidenceLow: "#F87171",
      confidenceLowSoft: "rgba(248,113,113,0.15)",
      roleStudent: "#60A5FA",
      roleStudentSoft: "rgba(96,165,250,0.15)",
      roleTeacher: "#2DD4BF",
      roleTeacherSoft: "rgba(45,212,191,0.16)",
      roleAdmin: "#FBBF24",
      roleAdminSoft: "rgba(251,191,36,0.16)",
      focusSurface: rgba(accent, 0.14),
    },
    shadows: {
      sm: { color: "#000", opacity: 0.20, radius: 6, offsetY: 2, elevation: 2 },
      md: { color: "#000", opacity: 0.28, radius: 12, offsetY: 4, elevation: 4 },
      lg: { color: "#000", opacity: 0.36, radius: 20, offsetY: 6, elevation: 8 },
      xl: { color: "#000", opacity: 0.44, radius: 32, offsetY: 10, elevation: 12 },
      glow: { color: accent, opacity: 0.28, radius: 20, offsetY: 0, elevation: 0 },
      // Calm Clarity: 單向輕陰影，取代 Neumorphic 雙向陰影
      soft: {
        shadowColor: "#000",
        shadowOpacity: 0.20,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 2 },
        elevation: 3,
      },
      inset: {
        shadowColor: "#000",
        shadowOpacity: 0.12,
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

export function createLightTheme(accent: string = DEFAULT_ACCENT, schoolId?: string, brand?: SchoolBrand): Theme {
  return {
    mode: "light",
    colors: {
      // 暖白背景：比 #F2F2F7 更溫暖，色彩心理學：暖色調增加信任感
      bg: "#F8F9FC",
      background: "#F8F9FC",
      surface: "#FFFFFF",
      surface2: "#F3F4F8",
      surface3: "#EAECF3",
      surfaceElevated: "#FFFFFF",
      surfaceInteractive: "#EEF2FF",
      surfaceInteractiveStrong: "#DBEAFE",
      border: "#E4E7F0",
      separator: "#D0D5E8",
      text: "#111827",
      textSecondary: "#374151",
      muted: "#9CA3AF",
      accent,
      accentSoft: createAccentSoft(accent, 0.08),
      accentHover: lighten(accent, 0.10),
      accentStrong: lighten(accent, 0.20),
      gradientStart: accent,
      gradientEnd: lighten(accent, 0.30),
      success: "#10B981",
      successSoft: "rgba(16,185,129,0.10)",
      danger: "#EF4444",
      error: "#EF4444",
      dangerSoft: "rgba(239,68,68,0.10)",
      warning: "#F59E0B",
      warningSoft: "rgba(245,158,11,0.10)",
      info: "#3B82F6",
      infoSoft: "rgba(59,130,246,0.10)",
      focusRing: rgba(accent, 0.22),
      overlay: "rgba(0,0,0,0.32)",
      disabledBg: "rgba(156,163,175,0.12)",
      disabledText: "rgba(156,163,175,0.60)",
      cardShadow: "rgba(17,25,60,0.08)",
      shimmer: "rgba(255,255,255,0.80)",
      achievement: "#D97706",
      achievementSoft: "rgba(217,119,6,0.10)",
      streak: "#E11D48",
      streakSoft: "rgba(225,29,72,0.10)",
      growth: "#059669",
      growthSoft: "rgba(5,150,105,0.10)",
      calm: "#2563EB",
      calmSoft: "rgba(37,99,235,0.10)",
      gentleWarn: "#D97706",
      gentleWarnSoft: "rgba(217,119,6,0.10)",
      urgent: "#EA580C",
      urgentSoft: "rgba(234,88,12,0.10)",
      fresh: "#0891B2",
      freshSoft: "rgba(8,145,178,0.10)",
      social: "#0EA5E9",
      socialSoft: "rgba(14,165,233,0.10)",
      confidenceHigh: "#059669",
      confidenceHighSoft: "rgba(5,150,105,0.10)",
      confidenceMedium: "#D97706",
      confidenceMediumSoft: "rgba(217,119,6,0.10)",
      confidenceLow: "#DC2626",
      confidenceLowSoft: "rgba(220,38,38,0.10)",
      roleStudent: "#2563EB",
      roleStudentSoft: "rgba(37,99,235,0.10)",
      roleTeacher: "#0F766E",
      roleTeacherSoft: "rgba(15,118,110,0.10)",
      roleAdmin: "#B45309",
      roleAdminSoft: "rgba(180,83,9,0.10)",
      focusSurface: rgba(accent, 0.08),
    },
    shadows: {
      sm: { color: "#111827", opacity: 0.06, radius: 6, offsetY: 2, elevation: 2 },
      md: { color: "#111827", opacity: 0.10, radius: 12, offsetY: 4, elevation: 4 },
      lg: { color: "#111827", opacity: 0.12, radius: 20, offsetY: 6, elevation: 7 },
      xl: { color: "#111827", opacity: 0.14, radius: 28, offsetY: 10, elevation: 10 },
      glow: { color: accent, opacity: 0.18, radius: 20, offsetY: 0, elevation: 0 },
      // Calm Clarity: 單向輕陰影
      soft: {
        shadowColor: "#111827",
        shadowOpacity: 0.08,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 2 },
        elevation: 2,
      },
      inset: {
        shadowColor: "#111827",
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

export function getTheme(mode: ThemeMode, accent?: string, schoolId?: string, brand?: SchoolBrand): Theme {
  return mode === "light" 
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
  fallbackAccent: string = DEFAULT_ACCENT
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
      console.warn("[theme] Listener error:", e);
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
    next = mode === "light" ? lightTheme : darkTheme;
  }
  
  if (_currentTheme.mode === next.mode && 
      _currentTheme.schoolId === next.schoolId &&
      _currentTheme.colors.accent === next.colors.accent) {
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
    shadowColor: shadow.shadowColor,
    shadowOpacity: shadow.shadowOpacity,
    shadowRadius: shadow.shadowRadius,
    shadowOffset: shadow.shadowOffset,
    elevation: shadow.elevation,
  };
}
