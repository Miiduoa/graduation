export function restorePanelFocus(panel: HTMLElement, trigger?: HTMLElement | null) {
  if (!panel.contains(document.activeElement) && document.activeElement !== document.body) return;
  if (trigger?.isConnected && trigger !== document.body) {
    trigger.focus({ preventScroll: true });
    if (document.activeElement === trigger) return;
  }

  const main = document.querySelector<HTMLElement>('main');
  if (!main || panel.contains(main)) return;
  if (!main.hasAttribute('tabindex')) main.tabIndex = -1;
  main.focus({ preventScroll: true });
}
