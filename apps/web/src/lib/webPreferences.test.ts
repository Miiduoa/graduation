import { describe, expect, it } from 'vitest';

import {
  applyWebAppearancePreferences,
  defaultThemeColor,
  defaultWebPreferences,
  deriveSecondaryThemeColor,
  resolveStoredWebPreferences,
  colorContrast,
  resolveAccentPalette,
} from './webPreferences';

describe('webPreferences', () => {
  it('falls back to defaults when stored values are invalid', () => {
    expect(
      resolveStoredWebPreferences({
        general: {
          autoSync: 'yes',
          language: 'jp',
        },
        appearance: {
          theme: 'night',
          fontSize: 'x-large',
          themeColor: 'blue',
          compactMode: '1',
          animations: null,
        },
        privacy: {
          analytics: 'enabled',
        },
      }),
    ).toEqual(defaultWebPreferences);
  });

  it('applies appearance preferences to the document root', () => {
    applyWebAppearancePreferences(document, {
      theme: 'dark',
      fontSize: 'large',
      themeColor: '#FF6B35',
      compactMode: true,
      animations: false,
    });

    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(document.documentElement.getAttribute('data-density')).toBe('compact');
    expect(document.documentElement.getAttribute('data-reduced-motion')).toBe('true');
    expect(document.documentElement.style.getPropertyValue('--brand')).toBe('#FF6B35');
    expect(document.documentElement.style.getPropertyValue('--brand2')).toBe(
      deriveSecondaryThemeColor('#FF6B35'),
    );
    expect(document.documentElement.style.getPropertyValue('--font-h1-size')).toBe('1.625rem');
    expect(document.documentElement.style.getPropertyValue('--font-body-size')).toBe('1.0625rem');
  });

  it.each([
    {
      fontSize: 'small' as const,
      body: '0.875rem',
      bodySm: '0.75rem',
      h1: '1.375rem',
      h2: '1.125rem',
      h3: '1rem',
      label: '0.75rem',
      labelSm: '0.625rem',
    },
    {
      fontSize: 'medium' as const,
      body: '0.9375rem',
      bodySm: '0.8125rem',
      h1: '1.5rem',
      h2: '1.25rem',
      h3: '1.0625rem',
      label: '0.8125rem',
      labelSm: '0.6875rem',
    },
    {
      fontSize: 'large' as const,
      body: '1.0625rem',
      bodySm: '0.9375rem',
      h1: '1.625rem',
      h2: '1.375rem',
      h3: '1.1875rem',
      label: '0.875rem',
      labelSm: '0.75rem',
    },
  ])('writes rem font tokens for $fontSize preserving the px-equivalent scale', ({
    fontSize,
    body,
    bodySm,
    h1,
    h2,
    h3,
    label,
    labelSm,
  }) => {
    applyWebAppearancePreferences(document, {
      ...defaultWebPreferences.appearance,
      fontSize,
    });

    const root = document.documentElement.style;
    expect(root.getPropertyValue('--font-body-size')).toBe(body);
    expect(root.getPropertyValue('--font-body-sm-size')).toBe(bodySm);
    expect(root.getPropertyValue('--font-h1-size')).toBe(h1);
    expect(root.getPropertyValue('--font-h2-size')).toBe(h2);
    expect(root.getPropertyValue('--font-h3-size')).toBe(h3);
    expect(root.getPropertyValue('--font-label-size')).toBe(label);
    expect(root.getPropertyValue('--font-label-sm-size')).toBe(labelSm);
  });

  it('resets to system theme when requested', () => {
    document.documentElement.setAttribute('data-theme', 'dark');

    applyWebAppearancePreferences(document, {
      ...defaultWebPreferences.appearance,
      theme: 'system',
      themeColor: defaultThemeColor,
    });

    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });
});

describe('accent readability', () => {
  it('keeps custom link and button text readable in both themes', () => {
    for (const dark of [false, true]) {
      for (const color of [
        '#000000',
        '#FFFFFF',
        '#007AFF',
        '#386146',
        '#8B631E',
        '#FF6B35',
        '#BF5AF2',
        '#983F32',
        '#32ADE6',
      ]) {
        const { brand, brand2, onBrand } = resolveAccentPalette(color, dark);
        for (const background of dark ? ['#000000', '#111111', '#232323'] : ['#FFFFFF']) {
          expect(colorContrast(brand, background)).toBeGreaterThanOrEqual(4.5);
        }
        expect(colorContrast(brand, onBrand)).toBeGreaterThanOrEqual(4.5);
        expect(colorContrast(brand2, onBrand)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
  it('restores the shared palette after resetting a custom accent', () => {
    applyWebAppearancePreferences(document, {
      ...defaultWebPreferences.appearance,
      themeColor: '#FF6B35',
    });
    applyWebAppearancePreferences(document, defaultWebPreferences.appearance);
    for (const token of ['--brand', '--brand2', '--on-brand'])
      expect(document.documentElement.style.getPropertyValue(token)).toBe('');
  });
});
