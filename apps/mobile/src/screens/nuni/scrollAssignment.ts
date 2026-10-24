type MeasureCallback = (
  x: number,
  y: number,
  width: number,
  height: number,
  pageX: number,
  pageY: number,
) => void;

export type AssignmentScrollHost = {
  measure?(callback: MeasureCallback): void;
  scrollTo?(options: { x?: number; y?: number; animated?: boolean }): void;
};

export type RevealAssignmentOptions = {
  /** Current ScrollView contentOffset.y; pageY delta alone is viewport-relative. */
  contentOffsetY?: number;
  /** Checked before every async measure callback and before scrollTo. */
  isActive?: () => boolean;
};

const LANDING_TOP_GAP = 48;

/**
 * Scroll so `target` sits below a top gap.
 * Uses contentOffsetY + (target.pageY - scroll.pageY) because scrollTo expects
 * an absolute content offset, not a viewport-relative delta.
 */
export function revealAssignmentSubmitArea(
  scroll: AssignmentScrollHost | null | undefined,
  target: AssignmentScrollHost | null | undefined,
  options?: RevealAssignmentOptions,
) {
  const measureScroll = scroll?.measure;
  const measureTarget = target?.measure;
  const scrollTo = scroll?.scrollTo;
  if (!scroll || !target || !measureScroll || !measureTarget || !scrollTo) return;
  const contentOffsetY = options?.contentOffsetY ?? 0;
  const isActive = options?.isActive ?? (() => true);
  if (!isActive()) return;
  measureTarget.call(target, (_x, _y, _width, _height, _pageX, pageY) => {
    if (!isActive()) return;
    measureScroll.call(scroll, (_sx, _sy, _sw, _sh, _sPageX, scrollPageY) => {
      if (!isActive()) return;
      const y = contentOffsetY + (pageY - scrollPageY) - LANDING_TOP_GAP;
      if (!Number.isFinite(y)) return;
      if (!isActive()) return;
      scrollTo.call(scroll, { y: Math.max(0, y), animated: false });
    });
  });
}
