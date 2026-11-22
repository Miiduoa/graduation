/** Reveal a readable slice without moving the page, textarea caret or inner scroll. */
function revealMultilineInput(dialog: HTMLDialogElement, field: HTMLTextAreaElement) {
  const view = dialog.ownerDocument.defaultView;
  if (!view || !dialog.open || !dialog.isConnected || dialog.ownerDocument.activeElement !== field)
    return;
  const panel = dialog.getBoundingClientRect();
  const box = field.getBoundingClientRect();
  const visual = view.visualViewport;
  const top = Math.max(panel.top + dialog.clientTop, visual?.offsetTop ?? 0, 0);
  const bottom = Math.min(
    panel.top + dialog.clientTop + dialog.clientHeight,
    view.innerHeight,
    visual ? visual.offsetTop + visual.height : view.innerHeight,
  );
  const available = bottom - top;
  if (available <= 0 || box.height <= 0 || dialog.clientHeight <= 0) return;

  const style = view.getComputedStyle(field);
  const pixels = (value: string) => Number.parseFloat(value) || 0;
  const lineHeight = pixels(style.lineHeight) || pixels(style.fontSize) * 1.2;
  const edges =
    pixels(style.paddingTop) +
    pixels(style.paddingBottom) +
    pixels(style.borderTopWidth) +
    pixels(style.borderBottomWidth);
  const required = Math.min(box.height, available, 2 * lineHeight + edges);
  const visible = Math.max(0, Math.min(box.bottom, bottom) - Math.max(box.top, top));
  if (required <= 0 || visible >= required - 0.5) return;

  // Leave a small focus-ring gutter when possible. A keyboard can shrink the
  // visual viewport below two lines; use only the space that actually exists.
  const gutter = Math.min(8, Math.max(0, (available - required) / 2));
  const delta =
    box.top >= top ? box.top + required - bottom + gutter : box.bottom - required - top - gutter;
  const maximum = Math.max(0, dialog.scrollHeight - dialog.clientHeight);
  const next = Math.max(0, Math.min(maximum, dialog.scrollTop + delta));
  if (Math.abs(next - dialog.scrollTop) > 0.5) dialog.scrollTop = next;
}

/** Native Tab stays in charge of focus; only its clipped multiline result is adjusted. */
export function keepModalTextareasReadable(dialog: HTMLDialogElement) {
  const view = dialog.ownerDocument.defaultView;
  if (!view?.requestAnimationFrame) return () => {};
  let tabbing = false;
  let intentFrame: number | null = null;
  let revealFrame: number | null = null;

  function cancelIntent() {
    tabbing = false;
    if (intentFrame !== null) view!.cancelAnimationFrame(intentFrame);
    intentFrame = null;
  }
  function cancelReveal() {
    if (revealFrame !== null) view!.cancelAnimationFrame(revealFrame);
    revealFrame = null;
  }
  function cancel() {
    cancelIntent();
    cancelReveal();
  }
  function onKeyDown(event: KeyboardEvent) {
    cancel();
    if (
      event.key !== 'Tab' ||
      event.defaultPrevented ||
      event.isComposing ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey
    )
      return;
    tabbing = true;
    intentFrame = view!.requestAnimationFrame(() => {
      intentFrame = null;
      tabbing = false;
    });
  }
  function onFocus(event: FocusEvent) {
    const fromTab = tabbing;
    cancel();
    const target = event.target;
    if (!fromTab || !(target instanceof HTMLTextAreaElement) || target.closest('dialog') !== dialog)
      return;
    // Let native focus/caret scrolling finish first. No focus(), scrollIntoView
    // or smooth animation: the dialog is the only scroll container we change.
    revealFrame = view!.requestAnimationFrame(() => {
      revealFrame = null;
      revealMultilineInput(dialog, target);
    });
  }
  dialog.addEventListener('keydown', onKeyDown);
  dialog.addEventListener('focusin', onFocus);
  dialog.addEventListener('focusout', cancelReveal);
  dialog.addEventListener('pointerdown', cancel, true);
  return () => {
    cancel();
    dialog.removeEventListener('keydown', onKeyDown);
    dialog.removeEventListener('focusin', onFocus);
    dialog.removeEventListener('focusout', cancelReveal);
    dialog.removeEventListener('pointerdown', cancel, true);
  };
}
