/** 手機第一屏預算：頂欄、精簡標題、搜尋列與底欄；與 map.module.css 的 --map-first-screen-chrome 對齊。 */
export const MAP_FIRST_SCREEN_CHROME_PX = 314;
export const MAP_FIRST_SCREEN_MIN_MAP_PX = 240;
export const MAP_FIRST_SCREEN_BOTTOM_NAV_PX = 72;
export const MAP_FIRST_SCREEN_VIEWPORTS = [
  { name: '390x844', width: 390, height: 844 },
  { name: '350x844', width: 350, height: 844 },
] as const;

export function mapFirstScreenMetrics(viewportHeight: number) {
  const mapHeight = Math.max(
    MAP_FIRST_SCREEN_MIN_MAP_PX,
    viewportHeight - MAP_FIRST_SCREEN_CHROME_PX,
  );
  const mapTop = MAP_FIRST_SCREEN_CHROME_PX - MAP_FIRST_SCREEN_BOTTOM_NAV_PX;
  const visibleBottom = viewportHeight - MAP_FIRST_SCREEN_BOTTOM_NAV_PX;
  return {
    mapHeight,
    mapTop,
    visibleMapPx: Math.max(0, Math.min(mapHeight, visibleBottom - mapTop)),
  };
}

export function mapFitsFirstScreen(viewportHeight: number) {
  const { mapTop, visibleMapPx } = mapFirstScreenMetrics(viewportHeight);
  return mapTop >= 0 && mapTop < viewportHeight && visibleMapPx >= MAP_FIRST_SCREEN_MIN_MAP_PX;
}
