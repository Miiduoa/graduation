import type { BuildingPlan } from './buildingPlan';
import { exportBuildingPlanSvg } from './buildingPlanSvg';

const MAX_PNG_SIDE = 4096;
const MAX_PNG_PIXELS = 4_000_000;
const PNG_TIMEOUT_MS = 15_000;
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

export function getBuildingPlanPngSize(plan: BuildingPlan, floorId: string | null, scale: 1 | 2 = 2):
  { width: number; height: number; limited: boolean } {
  if (plan.floors.length < 1 || plan.floors.length > 12) throw new Error('圖面需包含 1 到 12 個樓層。');
  if (scale !== 1 && scale !== 2) throw new Error('請選擇一般或高解析度 PNG。');
  if (floorId !== null && !plan.floors.some(floor => floor.id === floorId)) throw new Error('找不到所選樓層。');
  const floorCount = floorId === null ? plan.floors.length : 1;
  const width = 960 * scale;
  const height = (138 + floorCount * 350) * scale;
  const ratio = Math.min(1, MAX_PNG_SIDE / width, MAX_PNG_SIDE / height,
    Math.sqrt(MAX_PNG_PIXELS / (width * height)));
  return { width: Math.max(1, Math.floor(width * ratio)), height: Math.max(1, Math.floor(height * ratio)), limited: ratio < 1 };
}

/** Rasterize only the product's static SVG; no imported image or external URL is loaded. */
export async function exportBuildingPlanPng(plan: BuildingPlan, floorId: string | null, scale: 1 | 2, signal: AbortSignal):
  Promise<{ blob: Blob; width: number; height: number }> {
  const abortError = () => new DOMException('已取消 PNG 匯出。', 'AbortError');
  if (signal.aborted) throw abortError();
  const size = getBuildingPlanPngSize(plan, floorId, scale);
  const document = new DOMParser().parseFromString(exportBuildingPlanSvg(plan, floorId), 'image/svg+xml');
  const root = document.documentElement;
  if (document.querySelector('parsererror') || root.localName !== 'svg' || root.namespaceURI !== SVG_NAMESPACE) {
    throw new Error('無法準備平面圖圖片，請改用 SVG 或重新匯出。');
  }
  // Preserve the viewBox and all drawing content while bounding the decoder's raster.
  root.setAttribute('width', String(size.width));
  root.setAttribute('height', String(size.height));
  const svg = new Blob([new XMLSerializer().serializeToString(root)], { type: 'image/svg+xml;charset=utf-8' });

  return new Promise((resolve, reject) => {
    let image: HTMLImageElement | undefined;
    let canvas: HTMLCanvasElement | undefined;
    let url: string | undefined;
    let settled = false;
    const cleanup = () => {
      signal.removeEventListener('abort', abort);
      clearTimeout(timer);
      if (image) { image.onload = null; image.onerror = null; image.removeAttribute('src'); }
      if (url !== undefined) URL.revokeObjectURL(url);
      if (canvas) { canvas.width = 0; canvas.height = 0; }
    };
    const fail = (cause: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(cause instanceof Error || cause instanceof DOMException ? cause : new Error('無法建立 PNG，請改用 SVG 或稍後重試。'));
    };
    const abort = () => fail(abortError());
    const timer = setTimeout(() => fail(new Error('PNG 匯出逾時，請選擇單一樓層或改用 SVG。')), PNG_TIMEOUT_MS);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) { abort(); return; }
    try {
      image = new Image();
      image.onload = () => {
        if (settled) return;
        if (signal.aborted) { abort(); return; }
        try {
          if (!image?.naturalWidth || !image.naturalHeight) throw new Error('無法讀取平面圖圖片，請改用 SVG 或重試。');
          canvas = window.document.createElement('canvas');
          canvas.width = size.width;
          canvas.height = size.height;
          const context = canvas.getContext('2d', { alpha: false });
          if (!context) throw new Error('目前瀏覽器無法建立 PNG，請改用 SVG。');
          context.fillStyle = '#eef3f6';
          context.fillRect(0, 0, size.width, size.height);
          context.drawImage(image, 0, 0, size.width, size.height);
          canvas.toBlob(blob => {
            if (settled) return;
            if (signal.aborted) { abort(); return; }
            if (!blob || blob.type !== 'image/png' || blob.size === 0) {
              fail(new Error('無法建立 PNG，請選擇單一樓層或改用 SVG。'));
              return;
            }
            settled = true;
            cleanup();
            resolve({ blob, width: size.width, height: size.height });
          }, 'image/png');
        } catch (cause) { fail(cause); }
      };
      image.onerror = () => fail(new Error('無法讀取平面圖圖片，請改用 SVG 或重試。'));
      url = URL.createObjectURL(svg);
      image.src = url;
    } catch (cause) { fail(cause); }
  });
}
