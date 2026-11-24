const CLIPPING_OVERFLOWS = ['auto', 'scroll', 'hidden', 'clip'];
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

function horizontalClipBounds(element: HTMLElement) {
  let left = -Infinity;
  let right = Infinity;
  for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
    const { overflowX } = getComputedStyle(ancestor);
    if (!CLIPPING_OVERFLOWS.includes(overflowX)) continue;
    const clipLeft = ancestor.getBoundingClientRect().left + ancestor.clientLeft;
    left = Math.max(left, clipLeft);
    right = Math.min(right, clipLeft + ancestor.clientWidth);
  }
  return { left, right };
}

function horizontalVisibleBounds(element: HTMLElement) {
  const visible = visibleViewport();
  const clip = horizontalClipBounds(element);
  return { left: Math.max(visible.left, clip.left), right: Math.min(visible.right, clip.right) };
}

function fitsVisibleAxis(start: number, end: number, min: number, max: number) {
  // An oversized control at high zoom can only show its leading edge.
  return end > start && max > min && start >= min && start < max &&
    (end <= max || end - start > max - min);
}

export function isHorizontallyVisible(element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  const { left, right } = horizontalVisibleBounds(element);
  return rect.width > 0 && rect.left >= left && rect.right <= right;
}

function verticalVisibleBounds(insets: ReturnType<typeof measureStickyInsets>) {
  const visible = visibleViewport();
  return { top: visible.top + insets.top, bottom: visible.bottom - insets.bottom };
}

export function isVisible(element: HTMLElement, insets = measureStickyInsets()) {
  const { top, bottom } = verticalVisibleBounds(insets);
  const { left, right } = horizontalVisibleBounds(element);
  const rect = element.getBoundingClientRect();
  return fitsVisibleAxis(rect.top, rect.bottom, top, bottom) &&
    fitsVisibleAxis(rect.left, rect.right, left, right);
}

function nearestScrollDistance(start: number, end: number, min: number, max: number) {
  if (end <= start || max <= min || fitsVisibleAxis(start, end, min, max)) return 0;
  if (start < min || end - start > max - min) return Math.floor(start - min);
  return Math.max(0, Math.ceil(end - max));
}

function horizontalScrollDistance(element: HTMLElement, { left, right }: { left: number; right: number }) {
  const rect = element.getBoundingClientRect();
  return nearestScrollDistance(rect.left, rect.right, left, right);
}

export function revealForFocus(element: HTMLElement, horizontalContainer?: HTMLElement) {
  const maxScroll = horizontalContainer
    ? horizontalContainer.scrollWidth - horizontalContainer.clientWidth
    : 0;
  if (horizontalContainer && maxScroll > 0) {
    const bounds = horizontalVisibleBounds(element);
    // Bring the target inside its scrollport first when the visual viewport is disjoint.
    const scrollBounds = bounds.right > bounds.left ? bounds : horizontalClipBounds(element);
    const target = Math.max(0, Math.min(
      maxScroll, horizontalContainer.scrollLeft + horizontalScrollDistance(element, scrollBounds),
    ));
    if (target !== horizontalContainer.scrollLeft) horizontalContainer.scrollLeft = target;
  }

  const insets = measureStickyInsets();
  applyScrollMargins(element, insets);
  const bounds = horizontalVisibleBounds(element);
  const needsHorizontalReveal =
    bounds.right <= bounds.left || horizontalScrollDistance(element, bounds) !== 0;
  const nativeScroll = () => {
    // Native scrolling can pan the visual viewport even when the layout viewport cannot scroll.
    const rect = element.getBoundingClientRect();
    const { left, right } = horizontalVisibleBounds(element);
    const { top, bottom } = verticalVisibleBounds(measureStickyInsets());
    element.scrollIntoView?.({
      block: rect.height > bottom - top ? 'start' : 'nearest',
      inline: rect.width > right - left ? 'start' : 'nearest',
      behavior: 'instant',
    });
  };
  if (needsHorizontalReveal) nativeScroll();

  const { top, bottom } = verticalVisibleBounds(needsHorizontalReveal ? measureStickyInsets() : insets);
  const rect = element.getBoundingClientRect();
  const horizontalBounds = horizontalVisibleBounds(element);
  // Page scrolling can move a disjoint scrollport into view along with its target.
  const x = horizontalScrollDistance(
    element,
    horizontalBounds.right > horizontalBounds.left ? horizontalBounds : visibleViewport(),
  );
  const y = nearestScrollDistance(rect.top, rect.bottom, top, bottom);
  if (x || y) window.scrollBy({ left: x, top: y, behavior: 'instant' });

  if (isVisible(element)) return true;
  if (needsHorizontalReveal || !window.visualViewport) return false;
  nativeScroll();
  return isVisible(element);
}

function applyScrollMargins(element: HTMLElement, { top, bottom }: ReturnType<typeof measureStickyInsets>) {
  document.documentElement.style.setProperty('--calendar-sticky-header-height', `${top}px`);
  document.documentElement.style.setProperty('--calendar-sticky-footer-height', `${bottom}px`);
  element.style.scrollMarginTop = `${top}px`;
  element.style.scrollMarginBottom = `${bottom}px`;
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
  applyScrollMargins(element, insets);

  const rect = element.getBoundingClientRect();
  if (rect.height <= 0) return;
  const { top: visibleTop, bottom: visibleBottom } = verticalVisibleBounds(insets);
  // Round toward visibility when the browser scrolls in whole CSS pixels.
  const distance =
    align === 'start'
      ? Math.floor(rect.top - visibleTop)
      : nearestScrollDistance(rect.top, rect.bottom, visibleTop, visibleBottom);
  if (distance !== 0) window.scrollBy({ left: 0, top: distance, behavior: 'instant' });
}
