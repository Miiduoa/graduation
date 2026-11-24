import { afterEach, expect, it, vi } from 'vitest';
import { preferredScrollBehavior } from './scrollBehavior';

afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute('data-reduced-motion');
  document.documentElement.style.removeProperty('scroll-behavior');
});

it('keeps smooth positioning when both preferences allow animation', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  expect(preferredScrollBehavior()).toBe('smooth');
  document.documentElement.dataset.reducedMotion = 'false';
  expect(preferredScrollBehavior()).toBe('smooth');
});

it('reads the site preference again on the next action', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  expect(preferredScrollBehavior()).toBe('smooth');
  document.documentElement.dataset.reducedMotion = 'true';
  expect(preferredScrollBehavior()).toBe('instant');
  document.documentElement.dataset.reducedMotion = 'false';
  expect(preferredScrollBehavior()).toBe('smooth');
});

it('uses instant even if CSS requests smooth scrolling and the site allows animation', () => {
  document.documentElement.style.scrollBehavior = 'smooth';
  document.documentElement.dataset.reducedMotion = 'false';
  let reduce = true;
  const matchMedia = vi.fn(() => ({ matches: reduce }));
  vi.stubGlobal('matchMedia', matchMedia);
  expect(preferredScrollBehavior()).toBe('instant');
  expect(matchMedia).toHaveBeenLastCalledWith('(prefers-reduced-motion: reduce)');
  reduce = false;
  expect(preferredScrollBehavior()).toBe('smooth');
  reduce = true;
  expect(preferredScrollBehavior()).toBe('instant');
});

it('honors the site preference without a matchMedia implementation', () => {
  vi.stubGlobal('matchMedia', undefined);
  expect(preferredScrollBehavior()).toBe('smooth');
  document.documentElement.dataset.reducedMotion = 'true';
  expect(preferredScrollBehavior()).toBe('instant');
});

it.each(['window', 'document'])('can be evaluated without %s during server rendering', (name) => {
  vi.stubGlobal(name, undefined);
  try {
    expect(preferredScrollBehavior()).toBe('instant');
  } finally {
    vi.unstubAllGlobals();
  }
});
