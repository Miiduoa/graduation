export function stickyHeaderOffset() {
  let bottom = 0;
  for (const element of document.querySelectorAll('header, [role="banner"], nav, .topbar')) {
    const style = getComputedStyle(element);
    if (style.position !== 'sticky' && style.position !== 'fixed') continue;
    if (style.visibility === 'hidden' || Number(style.opacity) === 0) continue;
    const rect = element.getBoundingClientRect();
    if (rect.bottom <= 0 || rect.width <= 0 || rect.height <= 0) continue;
    if (rect.top <= 1) bottom = Math.max(bottom, rect.bottom);
  }
  return bottom;
}

export function scrollVerticallyIntoView(element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  if (rect.height <= 0) return;
  const top = stickyHeaderOffset();
  document.documentElement.style.setProperty('--calendar-sticky-header-height', `${top}px`);
  element.style.scrollMarginTop = `${top}px`;
  const bottomMargin = 8;
  if (rect.top < top) window.scrollBy(0, rect.top - top);
  else if (rect.bottom > window.innerHeight - bottomMargin)
    window.scrollBy(0, rect.bottom - (window.innerHeight - bottomMargin));
}
