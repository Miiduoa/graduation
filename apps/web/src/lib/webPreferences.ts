export type ThemePreference = "system" | "light" | "dark";
export type FontSizePreference = "small" | "medium" | "large";
export type LanguagePreference = "zh-TW" | "en-US";

export type WebGeneralPreferences = {
  autoSync: boolean;
  language: LanguagePreference;
};

export type WebAppearancePreferences = {
  theme: ThemePreference;
  fontSize: FontSizePreference;
  themeColor: string;
  compactMode: boolean;
  animations: boolean;
};

export type WebPrivacyPreferences = {
  showProfile: boolean;
  showActivity: boolean;
  analytics: boolean;
};

export type StoredWebPreferences = {
  general: WebGeneralPreferences;
  appearance: WebAppearancePreferences;
  privacy: WebPrivacyPreferences;
};

export const webPreferencesStorageKey = "campus-web-preferences";
export const defaultThemeColor = "#2563EB";

export const defaultWebPreferences: StoredWebPreferences = {
  general: {
    autoSync: true,
    language: "zh-TW",
  },
  appearance: {
    theme: "system",
    fontSize: "medium",
    themeColor: defaultThemeColor,
    compactMode: false,
    animations: true,
  },
  privacy: {
    showProfile: true,
    showActivity: false,
    analytics: true,
  },
};

const fontScaleMap: Record<
  FontSizePreference,
  {
    body: string;
    bodySm: string;
    h1: string;
    h2: string;
    h3: string;
    label: string;
    labelSm: string;
  }
> = {
  small: {
    body: "14px",
    bodySm: "12px",
    h1: "22px",
    h2: "18px",
    h3: "16px",
    label: "12px",
    labelSm: "10px",
  },
  medium: {
    body: "15px",
    bodySm: "13px",
    h1: "24px",
    h2: "20px",
    h3: "17px",
    label: "13px",
    labelSm: "11px",
  },
  large: {
    body: "17px",
    bodySm: "15px",
    h1: "26px",
    h2: "22px",
    h3: "19px",
    label: "14px",
    labelSm: "12px",
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeTheme(value: unknown): ThemePreference {
  return value === "light" || value === "dark" || value === "system"
    ? value
    : defaultWebPreferences.appearance.theme;
}

function normalizeFontSize(value: unknown): FontSizePreference {
  return value === "small" || value === "medium" || value === "large"
    ? value
    : defaultWebPreferences.appearance.fontSize;
}

function normalizeLanguage(value: unknown): LanguagePreference {
  return value === "en-US" || value === "zh-TW"
    ? value
    : defaultWebPreferences.general.language;
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeHexColor(value: unknown): string {
  if (typeof value !== "string") {
    return defaultThemeColor;
  }

  const normalized = value.trim().toUpperCase();
  if (/^#[0-9A-F]{6}$/.test(normalized)) {
    return normalized;
  }

  return defaultThemeColor;
}

function hexToRgb(color: string): { r: number; g: number; b: number } {
  const normalized = normalizeHexColor(color).slice(1);
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
  };
}

function toHex(value: number): string {
  return Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0");
}

function mixHex(color: string, weight: number): string {
  const { r, g, b } = hexToRgb(color);
  const mix = (channel: number) => channel + (255 - channel) * weight;
  return `#${toHex(mix(r))}${toHex(mix(g))}${toHex(mix(b))}`.toUpperCase();
}

export function deriveSecondaryThemeColor(color: string): string {
  return mixHex(color, 0.32);
}

export function resolveStoredWebPreferences(value: unknown): StoredWebPreferences {
  const input = isRecord(value) ? value : {};
  const general = isRecord(input.general) ? input.general : {};
  const appearance = isRecord(input.appearance) ? input.appearance : {};
  const privacy = isRecord(input.privacy) ? input.privacy : {};

  return {
    general: {
      autoSync: normalizeBoolean(general.autoSync, defaultWebPreferences.general.autoSync),
      language: normalizeLanguage(general.language),
    },
    appearance: {
      theme: normalizeTheme(appearance.theme),
      fontSize: normalizeFontSize(appearance.fontSize),
      themeColor: normalizeHexColor(appearance.themeColor),
      compactMode: normalizeBoolean(appearance.compactMode, defaultWebPreferences.appearance.compactMode),
      animations: normalizeBoolean(appearance.animations, defaultWebPreferences.appearance.animations),
    },
    privacy: {
      showProfile: normalizeBoolean(privacy.showProfile, defaultWebPreferences.privacy.showProfile),
      showActivity: normalizeBoolean(privacy.showActivity, defaultWebPreferences.privacy.showActivity),
      analytics: normalizeBoolean(privacy.analytics, defaultWebPreferences.privacy.analytics),
    },
  };
}

export function readStoredWebPreferences(storage?: Pick<Storage, "getItem">): StoredWebPreferences {
  if (!storage) {
    return defaultWebPreferences;
  }

  try {
    const raw = storage.getItem(webPreferencesStorageKey);
    if (!raw) {
      return defaultWebPreferences;
    }

    return resolveStoredWebPreferences(JSON.parse(raw) as unknown);
  } catch {
    return defaultWebPreferences;
  }
}

export function writeStoredWebPreferences(
  storage: Pick<Storage, "setItem"> | undefined,
  prefs: StoredWebPreferences
) {
  if (!storage) {
    return;
  }

  storage.setItem(webPreferencesStorageKey, JSON.stringify(prefs));
}

export function applyWebAppearancePreferences(
  doc: Pick<Document, "documentElement">,
  appearance: WebAppearancePreferences
) {
  const root = doc.documentElement;
  const themeColor = normalizeHexColor(appearance.themeColor);
  const secondaryThemeColor = deriveSecondaryThemeColor(themeColor);
  const fontScale = fontScaleMap[appearance.fontSize];

  if (appearance.theme === "system") {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", appearance.theme);
  }

  root.setAttribute("data-density", appearance.compactMode ? "compact" : "comfortable");
  root.setAttribute("data-reduced-motion", appearance.animations ? "false" : "true");
  root.style.setProperty("--brand", themeColor);
  root.style.setProperty("--brand2", secondaryThemeColor);
  root.style.setProperty("--font-body-size", fontScale.body);
  root.style.setProperty("--font-body-sm-size", fontScale.bodySm);
  root.style.setProperty("--font-h1-size", fontScale.h1);
  root.style.setProperty("--font-h2-size", fontScale.h2);
  root.style.setProperty("--font-h3-size", fontScale.h3);
  root.style.setProperty("--font-label-size", fontScale.label);
  root.style.setProperty("--font-label-sm-size", fontScale.labelSm);
}
