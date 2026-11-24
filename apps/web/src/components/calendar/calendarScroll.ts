const HEADER_SELECTORS = 'header, [role="banner"], nav, .topbar';
const FOOTER_SELECTORS = 'footer, nav, [role="navigation"], [role="tablist"], .nav, .tabbar, .bottom-nav';

export function visibleViewport() {
  const viewport = window.visualViewport;
  if (!viewport) {
    return {
      top: 0,
      left: 0,
      bottom: window.innerHeight,
      right: window.innerWidth,
      height: window.innerHeight,
      width: window.innerWidth,
    };
  }
  return {
    top: viewport.offsetTop,
    left: viewport.offsetLeft,
    bottom: viewport.offsetTop + viewport.height,
    right: viewport.offsetLeft + viewport.width,
    height: viewport.height,
    width: viewport.width,
  };
}

export function onVisibleViewportChange(listener: () => void) {
  const viewport = window.visualViewport;
  window.addEventListener('resize', listener);
  viewport?.addEventListener('resize', listener);
  viewport?.addEventListener('scroll', listener);
  return () => {
    window.removeEventListener('resize', listener);
    viewport?.removeEventListener('resize', listener);
    viewport?.removeEventListener('scroll', listener);
  };
}

function isOccluding(element: Element, edge: 'top' | 'bottom') {
  const style = getComputedStyle(element);
  if (style.position !== 'sticky' && style.position !== 'fixed') return false;
  if (style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  const visible = visibleViewport();
  if (edge === 'top') return rect.top <= visible.top + 1 && rect.bottom > visible.top;
  return rect.bottom >= visible.bottom - 1 && rect.top < visible.bottom;
}

export function stickyHeaderOffset() {
  const visible = visibleViewport();
  let bottom = visible.top;
  for (const element of document.querySelectorAll(HEADER_SELECTORS)) {
    if (!isOccluding(element, 'top')) continue;
    bottom = Math.max(bottom, element.getBoundingClientRect().bottom);
  }
  return Math.max(0, bottom - visible.top);
}

export function stickyFooterOffset() {
  const visible = visibleViewport();
  let top = visible.bottom;
  for (const element of document.querySelectorAll(FOOTER_SELECTORS)) {
    if (!isOccluding(element, 'bottom')) continue;
    top = Math.min(top, element.getBoundingClientRect().top);
  }
  return Math.max(0, visible.bottom - top);
}

export function measureStickyInsets() {
  return { top: stickyHeaderOffset(), bottom: stickyFooterOffset() };
}

export function isHorizontallyVisible(element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0) return false;
  const visible = visibleViewport();
  let left = visible.left;
  let right = visible.right;
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
  const visible = visibleViewport();
  const visibleTop = visible.top + top;
  const visibleBottom = visible.bottom - bottom;
  const distance =
    align === 'start' || rect.top < visibleTop
      ? rect.top - visibleTop
      : Math.max(0, rect.bottom - visibleBottom);
  if (distance !== 0) window.scrollBy({ left: 0, top: distance, behavior: 'instant' });
}
