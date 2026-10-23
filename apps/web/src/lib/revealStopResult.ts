const VIEW_MARGIN_PX = 24;
const STICKY_GAP_PX = 8;

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function scrollBehavior(): ScrollBehavior {
  return prefersReducedMotion() ? 'auto' : 'smooth';
}

function stickyCoverTop(): number {
  if (typeof document === 'undefined' || typeof window.getComputedStyle !== 'function') {
    return VIEW_MARGIN_PX;
  }
  let cover = 0;
  for (const node of document.querySelectorAll('[data-sticky-cover="true"]')) {
    if (!(node instanceof HTMLElement)) continue;
    const style = window.getComputedStyle(node);
    if (style.position !== 'sticky' && style.position !== 'fixed') continue;
    const height = node.getBoundingClientRect().height;
    if (height <= 0) continue;
    const stuckTop = Number.parseFloat(style.top);
    const top = Number.isFinite(stuckTop) ? stuckTop : 0;
    cover = Math.max(cover, top + height);
  }
  return cover > 0 ? cover + STICKY_GAP_PX : VIEW_MARGIN_PX;
}

function currentScrollY(): number {
  return window.scrollY || window.pageYOffset || 0;
}

/**
 * 點站牌或展開班次後，把結果停在畫面可見區上方。
 * 必須用 getBoundingClientRect（視覺位置），不能只靠 scrollIntoView：
 * 手機 CSS 把 .arrivals 排到清單前面，DOM 卻仍在清單後面，scrollIntoView
 * 會依 DOM 順序超捲，把站名與班次標題捲出視窗。
 * 黏住的站牌線／方向列高度要算進去，避免被點的列躲到黏層後面。
 * 用 scrollTo 絕對位置，避免連續兩次平滑捲動把標題超捲出畫面。
 */
export function revealStopResult(node: HTMLElement | null) {
  if (!node) return;
  const clearance = stickyCoverTop();
  const delta = node.getBoundingClientRect().top - clearance;
  if (Math.abs(delta) >= 1) {
    const top = Math.max(0, currentScrollY() + delta);
    if (typeof window.scrollTo === 'function') {
      window.scrollTo({ top, left: 0, behavior: scrollBehavior() });
    } else if (typeof window.scrollBy === 'function') {
      window.scrollBy({ top: delta, left: 0, behavior: scrollBehavior() });
    }
  }
  if (typeof node.focus === 'function') {
    node.focus({ preventScroll: true });
  }
}
