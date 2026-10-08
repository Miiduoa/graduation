import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AppearancePreferences } from './AppearancePreferences';
import { appearanceBootstrap } from '@/lib/appearanceBootstrap';
import { defaultWebPreferences, webPreferencesStorageKey } from '@/lib/webPreferences';

let systemDark = false;
let change: (() => void) | undefined;
const remove = vi.fn();
const setPreferences = (appearance: Record<string, unknown>) =>
  localStorage.setItem(
    webPreferencesStorageKey,
    JSON.stringify({
      ...defaultWebPreferences,
      appearance: { ...defaultWebPreferences.appearance, ...appearance },
    }),
  );
beforeEach(() => {
  systemDark = false;
  change = undefined;
  document.documentElement.removeAttribute('style');
  document.documentElement.removeAttribute('data-theme');
  vi.stubGlobal('matchMedia', () => ({
    get matches() {
      return systemDark;
    },
    addEventListener: (_: string, listener: () => void) => {
      change = listener;
    },
    removeEventListener: remove,
  }));
});
afterEach(() => vi.unstubAllGlobals());
it('restores saved appearance on a direct entry without mounting settings', () => {
  setPreferences({ theme: 'dark', fontSize: 'large', animations: false });
  render(<AppearancePreferences />);
  expect(document.documentElement.dataset.theme).toBe('dark');
  expect(document.documentElement.style.getPropertyValue('--brand')).toBe('');
  expect(document.documentElement.style.getPropertyValue('--font-body-size')).toBe('17px');
  expect(document.documentElement.dataset.reducedMotion).toBe('true');
});
it('updates all open pages after another tab changes or clears preferences', () => {
  render(<AppearancePreferences />);
  act(() => {
    setPreferences({ theme: 'dark', compactMode: true });
    window.dispatchEvent(new StorageEvent('storage', { key: webPreferencesStorageKey }));
  });
  expect(document.documentElement.dataset.theme).toBe('dark');
  act(() => {
    localStorage.clear();
    window.dispatchEvent(new StorageEvent('storage', { key: null }));
  });
  expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  expect(document.documentElement.dataset.density).toBe('comfortable');
});
it('recalculates a custom accent when the system theme changes and releases listeners', () => {
  setPreferences({ themeColor: '#FF6B35' });
  const { unmount } = render(<AppearancePreferences />);
  const light = document.documentElement.style.getPropertyValue('--brand');
  act(() => {
    systemDark = true;
    change?.();
  });
  expect(document.documentElement.style.getPropertyValue('--brand')).not.toBe(light);
  unmount();
  expect(remove).toHaveBeenCalledWith('change', expect.any(Function));
});
it('keeps rendering when storage access is denied', () => {
  const storage = Object.getOwnPropertyDescriptor(window, 'localStorage')!;
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    get() {
      throw new Error('denied');
    },
  });
  try {
    expect(() => render(<AppearancePreferences />)).not.toThrow();
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  } finally {
    Object.defineProperty(window, 'localStorage', storage);
  }
});
it('bootstrap applies only a valid saved theme before hydration', () => {
  setPreferences({ theme: 'dark' });
  new Function(appearanceBootstrap)();
  expect(document.documentElement.dataset.theme).toBe('dark');
  document.documentElement.removeAttribute('data-theme');
  localStorage.setItem(webPreferencesStorageKey, 'not json');
  expect(() => new Function(appearanceBootstrap)()).not.toThrow();
  expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
});
