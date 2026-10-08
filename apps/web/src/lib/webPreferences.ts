export type ThemePreference = 'system' | 'light' | 'dark';
export type FontSizePreference = 'small' | 'medium' | 'large';
export type LanguagePreference = 'zh-TW' | 'en-US';

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

export const webPreferencesStorageKey = 'campus-web-preferences';
export const defaultThemeColor = '#314D40';

export const defaultWebPreferences: StoredWebPreferences = {
  general: {
    autoSync: true,
    language: 'zh-TW',
  },
  appearance: {
    theme: 'system',
    fontSize: 'medium',
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
    body: '14px',
    bodySm: '12px',
    h1: '22px',
    h2: '18px',
    h3: '16px',
    label: '12px',
    labelSm: '10px',
  },
  medium: {
    body: '15px',
    bodySm: '13px',
    h1: '24px',
    h2: '20px',
    h3: '17px',
    label: '13px',
    labelSm: '11px',
  },
  large: {
    body: '17px',
    bodySm: '15px',
    h1: '26px',
    h2: '22px',
    h3: '19px',
    label: '14px',
    labelSm: '12px',
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeTheme(value: unknown): ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system'
    ? value
    : defaultWebPreferences.appearance.theme;
}

function normalizeFontSize(value: unknown): FontSizePreference {
  return value === 'small' || value === 'medium' || value === 'large'
    ? value
    : defaultWebPreferences.appearance.fontSize;
}

function normalizeLanguage(value: unknown): LanguagePreference {
  return value === 'en-US' || value === 'zh-TW' ? value : defaultWebPreferences.general.language;
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function normalizeHexColor(value: unknown): string {
  if (typeof value !== 'string') {
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
  return Math.max(0, Math.min(255, Math.round(value)))
    .toString(16)
    .padStart(2, '0');
}

function mixHex(color: string, weight: number): string {
  const { r, g, b } = hexToRgb(color);
  const mix = (channel: number) => channel + (255 - channel) * weight;
  return `#${toHex(mix(r))}${toHex(mix(g))}${toHex(mix(b))}`.toUpperCase();
}

export function deriveSecondaryThemeColor(color: string): string {
  return mixHex(color, 0.32);
}

function luminance(color: string): number {
  const { r, g, b } = hexToRgb(color);
  const linear = (channel: number) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

export function colorContrast(first: string, second: string): number {
  const a = luminance(first);
  const b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

// An accent is also used for text links. Keep it readable on the page and
// choose its button foreground independently from the selected color scheme.
export function resolveAccentPalette(color: string, dark: boolean) {
  const background = dark ? '#202B24' : '#FFFFFF';
  const source = hexToRgb(color);
  let brand = normalizeHexColor(color);
  for (let step = 1; colorContrast(brand, background) < 4.5 && step <= 100; step++) {
    const mix = (channel: number) => channel + (((dark ? 255 : 0) - channel) * step) / 100;
    brand = `#${toHex(mix(source.r))}${toHex(mix(source.g))}${toHex(mix(source.b))}`.toUpperCase();
  }
  const onBrand =
    colorContrast(brand, '#17291D') >= colorContrast(brand, '#FFFFFF') ? '#17291D' : '#FFFFFF';
  const secondary = deriveSecondaryThemeColor(brand);
  const brand2 = colorContrast(secondary, onBrand) >= 4.5 ? secondary : brand;
  return { brand, brand2, onBrand };
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
      compactMode: normalizeBoolean(
        appearance.compactMode,
        defaultWebPreferences.appearance.compactMode,
      ),
      animations: normalizeBoolean(
        appearance.animations,
        defaultWebPreferences.appearance.animations,
      ),
    },
    privacy: {
      showProfile: normalizeBoolean(privacy.showProfile, defaultWebPreferences.privacy.showProfile),
      showActivity: normalizeBoolean(
        privacy.showActivity,
        defaultWebPreferences.privacy.showActivity,
      ),
      analytics: normalizeBoolean(privacy.analytics, defaultWebPreferences.privacy.analytics),
    },
  };
}

export function readStoredWebPreferences(storage?: Pick<Storage, 'getItem'>): StoredWebPreferences {
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
  storage: Pick<Storage, 'setItem'> | undefined,
  prefs: StoredWebPreferences,
) {
  if (!storage) {
    return;
  }

  storage.setItem(webPreferencesStorageKey, JSON.stringify(prefs));
}

export function applyWebAppearancePreferences(
  doc: Pick<Document, 'documentElement'>,
  appearance: WebAppearancePreferences,
  systemDark = typeof window !== 'undefined' &&
    !!window.matchMedia?.('(prefers-color-scheme: dark)').matches,
) {
  const root = doc.documentElement;
  const themeColor = normalizeHexColor(appearance.themeColor);
  const fontScale = fontScaleMap[appearance.fontSize];

  if (appearance.theme === 'system') {
    root.removeAttribute('data-theme');
  } else {
    root.setAttribute('data-theme', appearance.theme);
  }

  root.setAttribute('data-density', appearance.compactMode ? 'compact' : 'comfortable');
  root.setAttribute('data-reduced-motion', appearance.animations ? 'false' : 'true');
  if (themeColor === defaultThemeColor) {
    // Let the shared light/dark stylesheet own the Campus One palette.
    for (const token of ['--brand', '--brand2', '--on-brand']) root.style.removeProperty(token);
  } else {
    const dark = appearance.theme === 'dark' || (appearance.theme === 'system' && systemDark);
    const palette = resolveAccentPalette(themeColor, dark);
    root.style.setProperty('--brand', palette.brand);
    root.style.setProperty('--brand2', palette.brand2);
    root.style.setProperty('--on-brand', palette.onBrand);
  }
  root.style.setProperty('--font-body-size', fontScale.body);
  root.style.setProperty('--font-body-sm-size', fontScale.bodySm);
  root.style.setProperty('--font-h1-size', fontScale.h1);
  root.style.setProperty('--font-h2-size', fontScale.h2);
  root.style.setProperty('--font-h3-size', fontScale.h3);
  root.style.setProperty('--font-label-size', fontScale.label);
  root.style.setProperty('--font-label-sm-size', fontScale.labelSm);
}
