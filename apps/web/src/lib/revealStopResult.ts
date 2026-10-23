const VIEW_MARGIN_PX = 24;

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function scrollBehavior(): ScrollBehavior {
  return prefersReducedMotion() ? 'auto' : 'smooth';
}

/**
 * 點站牌後把班次結果捲到畫面上方。
 * 必須用 getBoundingClientRect（視覺位置），不能只靠 scrollIntoView：
 * 手機 CSS 把 .arrivals 排到清單前面，DOM 卻仍在清單後面，scrollIntoView
 * 會依 DOM 順序超捲，把站名與班次標題捲出視窗。
 */
export function revealStopResult(node: HTMLElement | null) {
  if (!node) return;
  const delta = node.getBoundingClientRect().top - VIEW_MARGIN_PX;
  if (Math.abs(delta) >= 1 && typeof window.scrollBy === 'function') {
    window.scrollBy({ top: delta, left: 0, behavior: scrollBehavior() });
  }
  if (typeof node.focus === 'function') {
    node.focus({ preventScroll: true });
  }
}
