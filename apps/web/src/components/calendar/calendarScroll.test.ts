import { afterEach, expect, it, vi } from 'vitest';
import { onVisibleViewportChange, scrollVerticallyIntoView, stickyFooterOffset, stickyHeaderOffset } from './calendarScroll';

afterEach(() => {
  document.body.innerHTML = '';
  document.documentElement.style.removeProperty('--calendar-sticky-header-height');
  document.documentElement.style.removeProperty('--calendar-sticky-footer-height');
  Reflect.deleteProperty(window, 'visualViewport');
  vi.restoreAllMocks();
});

function mockComputed(element: Element, position: string) {
  const previous = window.getComputedStyle;
  vi.spyOn(window, 'getComputedStyle').mockImplementation((current: Element) => {
    if (current === element) {
      return { position, visibility: 'visible', opacity: '1' } as CSSStyleDeclaration;
    }
    return previous.call(window, current);
  });
}

it('sets scroll-margin-top to the sticky header height before scrolling', () => {
  const header = document.createElement('header');
  document.body.append(header);
  const target = document.createElement('button');
  document.body.append(target);
  mockComputed(header, 'sticky');
  vi.spyOn(header, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 320, 80));
  vi.spyOn(target, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 8, 100, 40));
  const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => {});
  expect(stickyHeaderOffset()).toBe(80);
  scrollVerticallyIntoView(target);
  expect(target.style.scrollMarginTop).toBe('80px');
  expect(document.documentElement.style.getPropertyValue('--calendar-sticky-header-height')).toBe(
    '80px',
  );
  expect(scrollBy).toHaveBeenCalledWith({ left: 0, top: 8 - 80, behavior: 'instant' });
});

it('keeps focus above a fixed bottom navigation bar', () => {
  vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(640);
  const nav = document.createElement('nav');
  nav.className = 'nav';
  document.body.append(nav);
  const target = document.createElement('button');
  document.body.append(target);
  mockComputed(nav, 'fixed');
  vi.spyOn(nav, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 568, 320, 72));
  vi.spyOn(target, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 580, 100, 40));
  const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => {});
  expect(stickyFooterOffset()).toBe(72);
  scrollVerticallyIntoView(target);
  expect(target.style.scrollMarginBottom).toBe('72px');
  expect(document.documentElement.style.getPropertyValue('--calendar-sticky-footer-height')).toBe(
    '72px',
  );
  expect(scrollBy).toHaveBeenCalledWith({ left: 0, top: 580 + 40 - (640 - 72), behavior: 'instant' });
});

it('uses the full viewport height when there is no sticky footer', () => {
  const target = document.createElement('button');
  vi.spyOn(target, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(0, window.innerHeight - 40, 100, 40),
  );
  const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => {});

  expect(stickyFooterOffset()).toBe(0);
  scrollVerticallyIntoView(target);
  expect(target.style.scrollMarginBottom).toBe('0px');
  expect(scrollBy).not.toHaveBeenCalled();
});

function mockVisualViewport(height: number, offsetTop = 0, width = 320, offsetLeft = 0) {
  const viewport = {
    height,
    width,
    offsetTop,
    offsetLeft,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  Object.defineProperty(window, 'visualViewport', {
    configurable: true,
    writable: true,
    value: viewport,
  });
  return viewport;
}

it('keeps the start of an agenda visible at a fractional scroll position', () => {
  const target = document.createElement('section');
  vi.spyOn(target, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 120.75, 100, 400));
  const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => {});

  scrollVerticallyIntoView(target, { align: 'start' });

  expect(scrollBy).toHaveBeenCalledWith({ left: 0, top: 120, behavior: 'instant' });
});

it('scrolls a title covered only after the soft keyboard shrinks the visual viewport', () => {
  vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(640);
  const viewport = mockVisualViewport(400);
  const target = document.createElement('input');
  document.body.append(target);
  vi.spyOn(target, 'getBoundingClientRect').mockReturnValue(new DOMRect(20, 500, 100, 40));
  const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => {});

  expect(stickyFooterOffset()).toBe(0);
  scrollVerticallyIntoView(target);
  expect(scrollBy).toHaveBeenCalledWith({ left: 0, top: 500 + 40 - 400, behavior: 'instant' });
  expect(viewport.height).toBe(400);
});

it('remeasures when the visual viewport later shrinks', () => {
  vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(640);
  const viewport = mockVisualViewport(640);
  const target = document.createElement('input');
  document.body.append(target);
  vi.spyOn(target, 'getBoundingClientRect').mockReturnValue(new DOMRect(20, 500, 100, 40));
  const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => {});

  scrollVerticallyIntoView(target);
  expect(scrollBy).not.toHaveBeenCalled();

  const listener = vi.fn(() => scrollVerticallyIntoView(target));
  const stop = onVisibleViewportChange(listener);
  viewport.height = 400;
  const resize = viewport.addEventListener.mock.calls.find(([name]) => name === 'resize');
  expect(resize).toBeTruthy();
  resize![1]();
  expect(listener).toHaveBeenCalled();
  expect(scrollBy).toHaveBeenCalledWith({ left: 0, top: 500 + 40 - 400, behavior: 'instant' });
  stop();
  expect(viewport.removeEventListener).toHaveBeenCalled();
});
