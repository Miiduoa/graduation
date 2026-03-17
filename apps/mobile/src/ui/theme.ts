export type ThemeMode = "dark" | "light";

export type ThemeColors = {
  bg: string;
  background: string;
  surface: string;
  surface2: string;
  surfaceElevated: string;
  border: string;
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

export type ThemeShadows = {
  sm: ThemeShadow;
  md: ThemeShadow;
  lg: ThemeShadow;
  xl: ThemeShadow;
  glow: ThemeShadow;
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
  xl: 32,
  lg: 24,
  md: 18,
  sm: 14,
  xs: 10,
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

const DEFAULT_ACCENT = "#5B8CFF";

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
      bg: "#0D1420",
      background: "#0D1420",
      surface: "#172131",
      surface2: "#202C40",
      surfaceElevated: "rgba(23,33,49,0.94)",
      border: "rgba(203,217,255,0.08)",
      text: "#F7FAFF",
      textSecondary: "#D5E2F4",
      muted: "#93A2B8",
      accent,
      accentSoft: createAccentSoft(accent, 0.18),
      accentHover: lighten(accent, 0.12),
      gradientStart: accent,
      gradientEnd: lighten(accent, 0.24),
      success: "#32D74B",
      successSoft: "rgba(50,215,75,0.16)",
      danger: "#FF6961",
      error: "#FF6961",
      dangerSoft: "rgba(255,105,97,0.16)",
      warning: "#FFB340",
      warningSoft: "rgba(255,179,64,0.16)",
      info: "#64D2FF",
      infoSoft: "rgba(100,210,255,0.16)",
      focusRing: rgba(accent, 0.6),
      overlay: "rgba(6,10,18,0.62)",
      disabledBg: "rgba(144,159,185,0.12)",
      disabledText: "rgba(144,159,185,0.6)",
      cardShadow: "rgba(0,0,0,0.4)",
      shimmer: "rgba(255,255,255,0.05)",
    },
    shadows: {
      sm: { color: "#000", opacity: 0.18, radius: 10, offsetY: 3, elevation: 3 },
      md: { color: "#000", opacity: 0.22, radius: 18, offsetY: 8, elevation: 6 },
      lg: { color: "#000", opacity: 0.26, radius: 28, offsetY: 12, elevation: 10 },
      xl: { color: "#000", opacity: 0.32, radius: 36, offsetY: 18, elevation: 14 },
      glow: { color: accent, opacity: 0.24, radius: 18, offsetY: 0, elevation: 0 },
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
      bg: "#EEF3F9",
      background: "#EEF3F9",
      surface: "#F8FBFF",
      surface2: "#E7EEF7",
      surfaceElevated: "rgba(255,255,255,0.9)",
      border: "rgba(126,150,184,0.16)",
      text: "#172033",
      textSecondary: "#31415F",
      muted: "#7D8AA1",
      accent,
      accentSoft: createAccentSoft(accent, 0.12),
      accentHover: lighten(accent, -0.08),
      gradientStart: lighten(accent, 0.3),
      gradientEnd: lighten(accent, 0.72),
      success: "#34C759",
      successSoft: "rgba(52,199,89,0.12)",
      danger: "#FF3B30",
      error: "#FF3B30",
      dangerSoft: "rgba(255,59,48,0.12)",
      warning: "#FF9500",
      warningSoft: "rgba(255,149,0,0.12)",
      info: "#5AC8FA",
      infoSoft: "rgba(90,200,250,0.12)",
      focusRing: rgba(accent, 0.4),
      overlay: "rgba(13,20,32,0.26)",
      disabledBg: "rgba(125,138,161,0.12)",
      disabledText: "rgba(125,138,161,0.56)",
      cardShadow: "rgba(101,129,170,0.12)",
      shimmer: "rgba(255,255,255,0.38)",
    },
    shadows: {
      sm: { color: "#6D86A8", opacity: 0.08, radius: 10, offsetY: 4, elevation: 2 },
      md: { color: "#6D86A8", opacity: 0.12, radius: 18, offsetY: 8, elevation: 4 },
      lg: { color: "#6D86A8", opacity: 0.14, radius: 28, offsetY: 12, elevation: 7 },
      xl: { color: "#6D86A8", opacity: 0.16, radius: 36, offsetY: 18, elevation: 10 },
      glow: { color: accent, opacity: 0.16, radius: 18, offsetY: 0, elevation: 0 },
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
