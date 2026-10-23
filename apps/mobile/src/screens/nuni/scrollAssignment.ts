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

const LANDING_TOP_GAP = 48;

/** Scroll the course list so the linked assignment submit area sits below a top gap. */
export function revealAssignmentSubmitArea(
  scroll: AssignmentScrollHost | null | undefined,
  target: AssignmentScrollHost | null | undefined,
) {
  const measureScroll = scroll?.measure;
  const measureTarget = target?.measure;
  const scrollTo = scroll?.scrollTo;
  if (!scroll || !target || !measureScroll || !measureTarget || !scrollTo) return;
  measureTarget.call(target, (_x, _y, _width, _height, _pageX, pageY) => {
    measureScroll.call(scroll, (_sx, _sy, _sw, _sh, _sPageX, scrollPageY) => {
      const y = pageY - scrollPageY - LANDING_TOP_GAP;
      if (!Number.isFinite(y)) return;
      scrollTo.call(scroll, { y: Math.max(0, y), animated: false });
    });
  });
}
