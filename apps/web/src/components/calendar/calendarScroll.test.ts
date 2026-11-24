import { afterEach, expect, it, vi } from 'vitest';
import { scrollVerticallyIntoView, stickyHeaderOffset } from './calendarScroll';

afterEach(() => {
  document.body.innerHTML = '';
  document.documentElement.style.removeProperty('--calendar-sticky-header-height');
  vi.restoreAllMocks();
});

it('sets scroll-margin-top to the sticky header height before scrolling', () => {
  const header = document.createElement('header');
  header.style.position = 'sticky';
  document.body.append(header);
  const target = document.createElement('button');
  document.body.append(target);
  const computed = (element: Element) =>
    ({
      position: element === header ? 'sticky' : 'static',
      visibility: 'visible',
      opacity: '1',
    }) as CSSStyleDeclaration;
  vi.spyOn(window, 'getComputedStyle').mockImplementation(computed);
  vi.spyOn(header, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 320, 80));
  vi.spyOn(target, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 8, 100, 40));
  const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => {});
  expect(stickyHeaderOffset()).toBe(80);
  scrollVerticallyIntoView(target);
  expect(target.style.scrollMarginTop).toBe('80px');
  expect(document.documentElement.style.getPropertyValue('--calendar-sticky-header-height')).toBe(
    '80px',
  );
  expect(scrollBy).toHaveBeenCalledWith(0, 8 - 80);
});
