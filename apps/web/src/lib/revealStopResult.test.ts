import { afterEach, expect, it, vi } from 'vitest';
import { revealStopResult } from './revealStopResult';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function paneAt(top: number) {
  const node = document.createElement('section');
  node.tabIndex = -1;
  vi.spyOn(node, 'getBoundingClientRect').mockReturnValue({
    x: 0, y: top, top, bottom: top + 400, left: 0, right: 360, width: 360, height: 400, toJSON() { return this; },
  });
  const focus = vi.spyOn(node, 'focus');
  return { node, focus };
}

it('scrolls by the visual offset so CSS order cannot hide the heading', () => {
  const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => {});
  const { node, focus } = paneAt(850);
  revealStopResult(node);
  expect(scrollBy).toHaveBeenCalledWith({ top: 826, left: 0, behavior: 'smooth' });
  expect(focus).toHaveBeenCalledWith({ preventScroll: true });
});

it('uses instant scrolling when the user prefers reduced motion', () => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('prefers-reduced-motion'),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => {});
  const { node } = paneAt(400);
  revealStopResult(node);
  expect(scrollBy).toHaveBeenCalledWith({ top: 376, left: 0, behavior: 'auto' });
});

it('does not move the page when the result is already at the top', () => {
  const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => {});
  const { node } = paneAt(24);
  revealStopResult(node);
  expect(scrollBy).not.toHaveBeenCalled();
});

it('ignores a missing node instead of throwing', () => {
  expect(() => revealStopResult(null)).not.toThrow();
});
