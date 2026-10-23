function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** 點站牌後把班次結果捲到畫面上方，避免手機還停在清單底部。 */
export function revealStopResult(node: HTMLElement | null) {
  if (!node || typeof node.scrollIntoView !== 'function') return;
  node.scrollIntoView({
    block: 'start',
    inline: 'nearest',
    behavior: prefersReducedMotion() ? 'auto' : 'smooth',
  });
}
