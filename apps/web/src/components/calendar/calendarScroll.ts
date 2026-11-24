const HEADER_SELECTORS = 'header, [role="banner"], nav, .topbar';
const FOOTER_SELECTORS = 'footer, nav, [role="navigation"], [role="tablist"], .nav, .tabbar, .bottom-nav';

function isOccluding(element: Element, edge: 'top' | 'bottom') {
  const style = getComputedStyle(element);
  if (style.position !== 'sticky' && style.position !== 'fixed') return false;
  if (style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  if (edge === 'top') return rect.top <= 1 && rect.bottom > 0;
  return rect.bottom >= window.innerHeight - 1 && rect.top < window.innerHeight;
}

export function stickyHeaderOffset() {
  let bottom = 0;
  for (const element of document.querySelectorAll(HEADER_SELECTORS)) {
    if (!isOccluding(element, 'top')) continue;
    bottom = Math.max(bottom, element.getBoundingClientRect().bottom);
  }
  return bottom;
}

export function stickyFooterOffset() {
  let top = window.innerHeight;
  for (const element of document.querySelectorAll(FOOTER_SELECTORS)) {
    if (!isOccluding(element, 'bottom')) continue;
    top = Math.min(top, element.getBoundingClientRect().top);
  }
  return Math.max(0, window.innerHeight - top);
}

export function measureStickyInsets() {
  return { top: stickyHeaderOffset(), bottom: stickyFooterOffset() };
}

export function isHorizontallyVisible(element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0) return false;
  let left = 0;
  let right = window.innerWidth;
  for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
    const { overflowX } = getComputedStyle(ancestor);
    if (!['auto', 'scroll', 'hidden', 'clip'].includes(overflowX)) continue;
    const clipLeft = ancestor.getBoundingClientRect().left + ancestor.clientLeft;
    left = Math.max(left, clipLeft);
    right = Math.min(right, clipLeft + ancestor.clientWidth);
  }
  return rect.left >= left && rect.right <= right;
}

export function scrollVerticallyIntoView(
  element: HTMLElement,
  {
    align = 'nearest',
    insets = measureStickyInsets(),
  }: {
    align?: 'start' | 'nearest';
    insets?: ReturnType<typeof measureStickyInsets>;
  } = {},
) {
  const { top, bottom } = insets;
  document.documentElement.style.setProperty('--calendar-sticky-header-height', `${top}px`);
  document.documentElement.style.setProperty('--calendar-sticky-footer-height', `${bottom}px`);
  element.style.scrollMarginTop = `${top}px`;
  element.style.scrollMarginBottom = `${bottom}px`;

  const rect = element.getBoundingClientRect();
  if (rect.height <= 0) return;
  const visibleBottom = window.innerHeight - bottom;
  const distance =
    align === 'start' || rect.top < top
      ? rect.top - top
      : Math.max(0, rect.bottom - visibleBottom);
  if (distance !== 0) window.scrollBy({ left: 0, top: distance, behavior: 'instant' });
}
