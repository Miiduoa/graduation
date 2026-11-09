import type { BuildingPlan, PlanFloor, PlanPoint } from './buildingPlan';

/** Static, self-contained SVG for reviewing an unverified drawing. No URLs or raster data. */
const escapeXml = (value: string) => value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
})[character]!);

const coord = (value: number) => Number(value.toFixed(3));
const points = (vertices: PlanPoint[], transform: (point: PlanPoint) => PlanPoint) =>
  vertices.map(point => transform(point).map(coord).join(',')).join(' ');

function floorSvg(floor: PlanFloor, index: number): string {
  const heightOffset = 122 + index * 350;
  const xs = floor.outline.map(point => point[0]);
  const ys = floor.outline.map(point => point[1]);
  const minX = Math.min(...xs), minY = Math.min(...ys);
  const width = Math.max(...xs) - minX, height = Math.max(...ys) - minY;
  const scale = Math.min(760 / width, 240 / height);
  const offsetX = 480 - width * scale / 2;
  const offsetY = heightOffset + 57 + (240 - height * scale) / 2;
  const transform = ([x, y]: PlanPoint): PlanPoint => [
    offsetX + (x - minX) * scale, offsetY + (y - minY) * scale,
  ];
  const roomSvg = floor.rooms.map(room => {
    const [left, right] = [Math.min(...room.polygon.map(p => p[0])), Math.max(...room.polygon.map(p => p[0]))];
    const [top, bottom] = [Math.min(...room.polygon.map(p => p[1])), Math.max(...room.polygon.map(p => p[1]))];
    const boundsWidth = (right - left) * scale, boundsHeight = (bottom - top) * scale;
    const [cx, cy] = transform([(left + right) / 2, (top + bottom) / 2]);
    const label = escapeXml(room.name);
    return `<g><title>${label}</title><polygon fill="#dceaf3" stroke="#47677b" stroke-width="1.5" points="${points(room.polygon, transform)}"/>${boundsWidth >= 45 && boundsHeight >= 19 ? `<text x="${coord(cx)}" y="${coord(cy)}" font-size="12" text-anchor="middle" dominant-baseline="middle" fill="#183443">${label}</text>` : ''}</g>`;
  }).join('');
  const walls = floor.walls.map(wall => {
    const [x1, y1] = transform(wall.start), [x2, y2] = transform(wall.end);
    return `<line x1="${coord(x1)}" y1="${coord(y1)}" x2="${coord(x2)}" y2="${coord(y2)}" stroke="#314653" stroke-width="${coord(Math.max(1, wall.thickness * scale))}" stroke-linecap="round"/>`;
  }).join('');
  return `<g><rect x="24" y="${heightOffset}" width="912" height="326" rx="14" fill="#ffffff" stroke="#d8e1e8"/><text x="46" y="${heightOffset + 34}" font-size="20" font-weight="600" fill="#183443">${escapeXml(floor.label)}</text><text x="916" y="${heightOffset + 34}" text-anchor="end" font-size="12" fill="#526879">${floor.rooms.length} 個標記房間</text><polygon fill="#f4f7f9" stroke="#243d4b" stroke-width="2" points="${points(floor.outline, transform)}"/>${roomSvg}${walls}</g>`;
}

/** Export the already-validated in-memory plan, never a campus-authoritative map. */
export function exportBuildingPlanSvg(plan: BuildingPlan, floorId: string | null = null): string {
  const floors = floorId ? plan.floors.filter(floor => floor.id === floorId) : plan.floors;
  if (floors.length === 0) throw new Error('找不到所選樓層。');
  const height = 138 + floors.length * 350;
  const caution = plan.units === 'relative'
    ? '未校正比例／示意單位，不能用於實際尺寸量測或室內導航。'
    : '圖面比例與樓高尚待現場核對，不能用於室內導航。';
  const title = escapeXml(plan.name);
  const source = escapeXml(plan.source?.label || '使用者提供的圖面');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="${height}" viewBox="0 0 960 ${height}" role="img" aria-labelledby="plan-title plan-description"><title id="plan-title">${title} · 待核對平面圖</title><desc id="plan-description">${escapeXml(caution)} 來源：${source}。</desc><rect width="960" height="${height}" fill="#eef3f6"/><text x="32" y="42" font-family="system-ui, sans-serif" font-size="26" font-weight="700" fill="#153241">${title}</text><text x="32" y="72" font-family="system-ui, sans-serif" font-size="15" fill="#a34231">待核對圖面 · ${escapeXml(caution)}</text><text x="32" y="100" font-family="system-ui, sans-serif" font-size="13" fill="#526879">來源：${source}</text><g font-family="system-ui, sans-serif">${floors.map(floorSvg).join('')}</g><text x="32" y="${height - 16}" font-family="system-ui, sans-serif" font-size="12" fill="#526879">此圖由使用者提供資料繪製，未驗證校方建築或通行資訊。小型房間名稱請以原圖面清單核對。</text></svg>`;
}
