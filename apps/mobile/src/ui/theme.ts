export type ThemeMode = "dark" | "light";

export type ThemeColors = {
  bg: string;
  background: string;
  surface: string;
  surface2: string;
  surfaceElevated: string;
  border: string;
  separator: string;
  text: string;
  textSecondary: string;
  muted: string;
  accent: string;
  accentSoft: string;
  accentHover: string;
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
};

export type ThemeShadow = {
  color: string;
  opacity: number;
  radius: number;
  offsetY: number;
  elevation: number;
};

/** Bilateral Soft UI shadow expressed as two shadow layers */
export type SoftShadow = {
  /** Dark face */
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
  /** Soft UI bilateral raised shadow (for cards) */
  soft: SoftShadow;
  /** Soft UI inset pressed shadow (for inputs) */
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
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
  xxxl: 64,
};

const sharedTypography: ThemeTypography = {
  hero: {
    fontSize: 40,
    lineHeight: 48,
    letterSpacing: -1,
    fontWeight: "900",
  },
  display: {
    fontSize: 32,
    lineHeight: 40,
    letterSpacing: -0.6,
    fontWeight: "800",
  },
  h1: {
    fontSize: 26,
    lineHeight: 34,
    letterSpacing: -0.4,
    fontWeight: "700",
  },
  h2: {
    fontSize: 21,
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
  body: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "400",
  },
  bodySmall: {
    fontSize: 13,
    lineHeight: 19,
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
    lineHeight: 14,
    letterSpacing: 0.3,
    fontWeight: "500",
  },
};

const sharedAnimation: ThemeAnimation = {
  fast: 150,
  normal: 300,
  slow: 500,
  spring: { friction: 8, tension: 65 },
};

const DEFAULT_ACCENT = "#5E6AD2";

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
  if (!rgb) return `rgba(99,102,241,${opacity})`;
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
      bg: "#1C1C1E",
      background: "#1C1C1E",
      surface: "#2C2C2E",
      surface2: "#3A3A3C",
      surfaceElevated: "#48484A",
      border: "#38383A",
      separator: "#38383A",
      text: "#F2F2F7",
      textSecondary: "#EBEBF5CC",
      muted: "#8E8E93",
      accent,
      accentSoft: createAccentSoft(accent, 0.18),
      accentHover: lighten(accent, 0.12),
      gradientStart: accent,
      gradientEnd: lighten(accent, 0.24),
      success: "#30D158",
      successSoft: "rgba(48,209,88,0.16)",
      danger: "#FF453A",
      error: "#FF453A",
      dangerSoft: "rgba(255,69,58,0.18)",
      warning: "#FF9F0A",
      warningSoft: "rgba(255,159,10,0.16)",
      info: "#0A84FF",
      infoSoft: "rgba(10,132,255,0.16)",
      focusRing: rgba(accent, 0.42),
      overlay: "rgba(0,0,0,0.62)",
      disabledBg: "rgba(255,255,255,0.08)",
      disabledText: "rgba(255,255,255,0.28)",
      cardShadow: "rgba(0,0,0,0.4)",
      shimmer: "rgba(255,255,255,0.06)",
    },
    shadows: {
      sm: { color: "#000", opacity: 0.24, radius: 8, offsetY: 2, elevation: 2 },
      md: { color: "#000", opacity: 0.32, radius: 16, offsetY: 4, elevation: 5 },
      lg: { color: "#000", opacity: 0.40, radius: 28, offsetY: 8, elevation: 9 },
      xl: { color: "#000", opacity: 0.48, radius: 36, offsetY: 14, elevation: 13 },
      glow: { color: accent, opacity: 0.26, radius: 16, offsetY: 0, elevation: 0 },
      soft: {
        shadowColor: "#000",
        shadowOpacity: 0.28,
        shadowRadius: 10,
        shadowOffset: { width: 3, height: 3 },
        elevation: 4,
      },
      inset: {
        shadowColor: "#000",
        shadowOpacity: 0.22,
        shadowRadius: 6,
        shadowOffset: { width: 2, height: 2 },
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
      bg: "#F2F2F7",
      background: "#F2F2F7",
      surface: "#FFFFFF",
      surface2: "#F2F2F7",
      surfaceElevated: "#FFFFFF",
      border: "#E5E5EA",
      separator: "#C6C6C8",
      text: "#1C1C1E",
      textSecondary: "#3C3C43",
      muted: "#8E8E93",
      accent,
      accentSoft: createAccentSoft(accent, 0.10),
      accentHover: lighten(accent, 0.08),
      gradientStart: accent,
      gradientEnd: lighten(accent, 0.28),
      success: "#34C759",
      successSoft: "rgba(52,199,89,0.12)",
      danger: "#FF3B30",
      error: "#FF3B30",
      dangerSoft: "rgba(255,59,48,0.12)",
      warning: "#FF9500",
      warningSoft: "rgba(255,149,0,0.12)",
      info: "#007AFF",
      infoSoft: "rgba(0,122,255,0.12)",
      focusRing: rgba(accent, 0.24),
      overlay: "rgba(0,0,0,0.36)",
      disabledBg: "rgba(142,142,147,0.12)",
      disabledText: "rgba(142,142,147,0.55)",
      cardShadow: "rgba(174,174,192,0.28)",
      shimmer: "rgba(255,255,255,0.72)",
    },
    shadows: {
      sm: { color: "#AEAEC0", opacity: 0.28, radius: 8, offsetY: 4, elevation: 2 },
      md: { color: "#AEAEC0", opacity: 0.38, radius: 14, offsetY: 6, elevation: 4 },
      lg: { color: "#AEAEC0", opacity: 0.48, radius: 20, offsetY: 10, elevation: 7 },
      xl: { color: "#AEAEC0", opacity: 0.56, radius: 28, offsetY: 14, elevation: 10 },
      glow: { color: accent, opacity: 0.20, radius: 16, offsetY: 0, elevation: 0 },
      soft: {
        shadowColor: "#AEAEC0",
        shadowOpacity: 0.32,
        shadowRadius: 8,
        shadowOffset: { width: 4, height: 4 },
        elevation: 3,
      },
      inset: {
        shadowColor: "#AEAEC0",
        shadowOpacity: 0.24,
        shadowRadius: 5,
        shadowOffset: { width: 2, height: 2 },
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
