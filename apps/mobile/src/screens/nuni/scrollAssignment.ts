type MeasureNode = {
  measure(
    callback: (
      x: number,
      y: number,
      width: number,
      height: number,
      pageX: number,
      pageY: number,
    ) => void,
  ): void;
};

export type AssignmentScrollView = MeasureNode & {
  scrollTo(options: { x?: number; y?: number; animated?: boolean }): void;
};

/** Scroll the course list so the linked assignment submit area sits at the top. */
export function revealAssignmentSubmitArea(
  scroll: AssignmentScrollView | null | undefined,
  target: MeasureNode | null | undefined,
) {
  if (!scroll || !target) return;
  target.measure((_x, _y, _width, _height, _pageX, pageY) => {
    scroll.measure((_sx, _sy, _sw, _sh, _sPageX, scrollPageY) => {
      const y = pageY - scrollPageY;
      if (!Number.isFinite(y)) return;
      scroll.scrollTo({ y: Math.max(0, y), animated: false });
    });
  });
}
