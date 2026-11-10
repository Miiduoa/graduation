const encoder = new TextEncoder();

function filenamePart(value: string, byteLimit: number, fallback: string): string {
  // Keep readable Unicode words; omit path punctuation, controls and bidi overrides.
  const cleaned = value.normalize('NFC')
    .replace(/[^\p{L}\p{N}\p{M} ._()（）·・-]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .replace(/^[. ]+|[. ]+$/gu, '');
  let result = '';
  let bytes = 0;
  for (const character of cleaned) {
    const size = encoder.encode(character).length;
    if (bytes + size > byteLimit) break;
    result += character;
    bytes += size;
  }
  result = result.replace(/[. ]+$/gu, '');
  return /[\p{L}\p{N}]/u.test(result) ? result : fallback;
}

/** Deterministic suggested name, at most 150 UTF-8 bytes including the SVG extension.
 * Only display names are accepted; source URLs and account/scope metadata stay out.
 */
export function getBuildingPlanSvgFilename(planName: string, floorLabel: string | null = null): string {
  const plan = filenamePart(planName, 80, '未命名圖面');
  // The fixed prefix also avoids Windows reserved device basenames.
  const selection = floorLabel === null ? '全部樓層' : '單層-' + filenamePart(floorLabel, 48, '未命名樓層');
  return '平面圖-' + plan + '-' + selection + '.svg';
}
