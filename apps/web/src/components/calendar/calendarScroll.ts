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
  let found = false;
  for (const element of document.querySelectorAll(FOOTER_SELECTORS)) {
    if (!isOccluding(element, 'bottom')) continue;
    found = true;
    top = Math.min(top, element.getBoundingClientRect().top);
  }
  return found ? Math.max(0, window.innerHeight - top) : 8;
}

export function scrollVerticallyIntoView(element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  if (rect.height <= 0) return;
  const top = stickyHeaderOffset();
  const bottom = stickyFooterOffset();
  document.documentElement.style.setProperty('--calendar-sticky-header-height', `${top}px`);
  document.documentElement.style.setProperty('--calendar-sticky-footer-height', `${bottom}px`);
  element.style.scrollMarginTop = `${top}px`;
  element.style.scrollMarginBottom = `${bottom}px`;
  if (rect.top < top) window.scrollBy(0, rect.top - top);
  else if (rect.bottom > window.innerHeight - bottom)
    window.scrollBy(0, rect.bottom - (window.innerHeight - bottom));
}
