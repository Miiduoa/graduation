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

function horizontalVisibleBounds(element: HTMLElement) {
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
  return { left, right };
}

export function isHorizontallyVisible(element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  const { left, right } = horizontalVisibleBounds(element);
  return rect.width > 0 && rect.left >= left && rect.right <= right;
}

export function verticalVisibleBounds(insets: ReturnType<typeof measureStickyInsets>) {
  const visible = visibleViewport();
  return { top: visible.top + insets.top, bottom: visible.bottom - insets.bottom };
}

export function scrollHorizontallyIntoView(element: HTMLElement, viewport: HTMLElement) {
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0) return false;
  const { left, right } = horizontalVisibleBounds(element);
  const maxScroll = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
  if (right > left && maxScroll > 0) {
    const distance =
      rect.left < left || rect.width > right - left
        ? Math.floor(rect.left - left)
        : Math.max(0, Math.ceil(rect.right - right));
    const target = Math.max(0, Math.min(maxScroll, viewport.scrollLeft + distance));
    if (target !== viewport.scrollLeft) viewport.scrollLeft = target;
  }

  if (isHorizontallyVisible(element)) return true;
  // At pinch zoom the browser can pan the visual viewport even when the grid fits.
  element.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
  return isHorizontallyVisible(element);
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
  const { top: visibleTop, bottom: visibleBottom } = verticalVisibleBounds(insets);
  // Round toward visibility when the browser scrolls in whole CSS pixels.
  const distance =
    align === 'start' || rect.top < visibleTop
      ? Math.floor(rect.top - visibleTop)
      : Math.max(0, Math.ceil(rect.bottom - visibleBottom));
  if (distance !== 0) window.scrollBy({ left: 0, top: distance, behavior: 'instant' });
}
