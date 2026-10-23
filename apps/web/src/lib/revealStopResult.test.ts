import { afterEach, expect, it, vi } from 'vitest';
import { revealStopResult } from './revealStopResult';

afterEach(() => {
  document.body.replaceChildren();
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

function stickyCover(options: { testId?: string; top: string; height: number; bottom: number }) {
  const node = document.createElement('div');
  node.dataset.stickyCover = 'true';
  if (options.testId) node.dataset.testid = options.testId;
  node.style.position = 'sticky';
  node.style.top = options.top;
  vi.spyOn(node, 'getBoundingClientRect').mockReturnValue({
    x: 0, y: Number.parseFloat(options.top), top: Number.parseFloat(options.top),
    bottom: options.bottom, left: 0, right: 360, width: 360, height: options.height, toJSON() { return this; },
  });
  document.body.append(node);
  return node;
}

it('scrolls by the visual offset so CSS order cannot hide the heading', () => {
  const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  const { node, focus } = paneAt(850);
  revealStopResult(node);
  expect(scrollTo).toHaveBeenCalledWith({ top: 826, left: 0, behavior: 'smooth' });
  expect(focus).toHaveBeenCalledWith({ preventScroll: true });
});

it('uses instant scrolling when the user prefers reduced motion', () => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('prefers-reduced-motion'),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  const { node } = paneAt(400);
  revealStopResult(node);
  expect(scrollTo).toHaveBeenCalledWith({ top: 376, left: 0, behavior: 'auto' });
});

it('does not move the page when the result is already at the top', () => {
  const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  const { node } = paneAt(24);
  revealStopResult(node);
  expect(scrollTo).not.toHaveBeenCalled();
});

it('ignores a missing node instead of throwing', () => {
  expect(() => revealStopResult(null)).not.toThrow();
});

it('keeps the revealed row below a sticky stop line instead of tucking it underneath', () => {
  vi.spyOn(window, 'scrollY', 'get').mockReturnValue(520);
  stickyCover({ top: '0px', height: 44, bottom: 44 });
  stickyCover({ testId: 'campus-approach', top: '44px', height: 128, bottom: 172 });
  const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  const { node } = paneAt(24);
  revealStopResult(node);
  expect(scrollTo).toHaveBeenCalledWith({ top: 364, left: 0, behavior: 'smooth' });
});

it('brings a heading that sits above the viewport back into view', () => {
  vi.spyOn(window, 'scrollY', 'get').mockReturnValue(900);
  const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  const { node } = paneAt(-350);
  revealStopResult(node);
  expect(scrollTo).toHaveBeenCalledWith({ top: 526, left: 0, behavior: 'smooth' });
});

it('uses an absolute scroll position so a second reveal cannot overshoot', () => {
  let scrollY = 0;
  vi.spyOn(window, 'scrollY', 'get').mockImplementation(() => scrollY);
  const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation((x: number | ScrollToOptions, y?: number) => {
    scrollY = typeof x === 'object' ? Number(x.top) : Number(y);
  });
  const { node } = paneAt(850);
  revealStopResult(node);
  expect(scrollTo).toHaveBeenCalledWith({ top: 826, left: 0, behavior: 'smooth' });
  scrollY = 400;
  vi.mocked(node.getBoundingClientRect).mockReturnValue({
    x: 0, y: 450, top: 450, bottom: 850, left: 0, right: 360, width: 360, height: 400, toJSON() { return this; },
  });
  revealStopResult(node);
  expect(scrollTo).toHaveBeenLastCalledWith({ top: 826, left: 0, behavior: 'smooth' });
});
