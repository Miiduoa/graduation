import { afterEach, expect, it, vi } from 'vitest';
import { revealStopResult } from './revealStopResult';

afterEach(() => {
  vi.unstubAllGlobals();
});

it('scrolls the stop result to the start of the viewport', () => {
  const node = document.createElement('section');
  const scrollIntoView = vi.fn();
  node.scrollIntoView = scrollIntoView;
  revealStopResult(node);
  expect(scrollIntoView).toHaveBeenCalledWith({
    block: 'start',
    inline: 'nearest',
    behavior: 'smooth',
  });
});

it('uses instant scrolling when the user prefers reduced motion', () => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('prefers-reduced-motion'),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  const node = document.createElement('section');
  const scrollIntoView = vi.fn();
  node.scrollIntoView = scrollIntoView;
  revealStopResult(node);
  expect(scrollIntoView).toHaveBeenCalledWith({
    block: 'start',
    inline: 'nearest',
    behavior: 'auto',
  });
});

it('ignores a missing node instead of throwing', () => {
  expect(() => revealStopResult(null)).not.toThrow();
});
