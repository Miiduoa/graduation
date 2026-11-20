import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createExampleBuildingPlan } from './buildingPlan';
import { exportBuildingPlanPng, getBuildingPlanPngSize } from './buildingPlanPng';

const plan = () => createExampleBuildingPlan({ schoolId: 'pu', buildingId: 'test-building' });

class TestImage {
  static instances: TestImage[] = [];
  onload: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  naturalWidth = 960;
  naturalHeight = 488;
  src = '';
  constructor() { TestImage.instances.push(this); }
  removeAttribute(name: string) { if (name === 'src') this.src = ''; }
  load() { this.onload?.(new Event('load')); }
}

let canvases: HTMLCanvasElement[];
let encode: BlobCallback;
const drawImage = vi.fn();
const fillRect = vi.fn();
let context: { fillStyle: string; drawImage: typeof drawImage; fillRect: typeof fillRect };
const png = () => new Blob(['mock PNG pixels'], { type: 'image/png' });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  TestImage.instances = [];
  canvases = [];
  context = { fillStyle: '', drawImage, fillRect };
  drawImage.mockReset();
  fillRect.mockReset();
  vi.stubGlobal('Image', TestImage);
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:png-source');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    canvases.push(this);
    return context as unknown as CanvasRenderingContext2D;
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(callback => { encode = callback; });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const image = () => TestImage.instances.at(-1)!;
const read = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(reader.error);
  reader.readAsText(blob);
});
function expectReleased() {
  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:png-source');
  expect(image().src).toBe('');
  expect(image().onload).toBeNull();
  expect(image().onerror).toBeNull();
  for (const canvas of canvases) expect([canvas.width, canvas.height]).toEqual([0, 0]);
  expect(vi.getTimerCount()).toBe(0);
}

describe('building plan PNG dimensions', () => {
  it('uses the chosen floor and resolution', () => {
    expect(getBuildingPlanPngSize(plan(), null)).toEqual({ width: 1920, height: 1676, limited: false });
    expect(getBuildingPlanPngSize(plan(), null, 1)).toEqual({ width: 960, height: 838, limited: false });
    expect(getBuildingPlanPngSize(plan(), 'example-2', 2)).toEqual({ width: 1920, height: 976, limited: false });
    expect(() => getBuildingPlanPngSize(plan(), 'missing')).toThrow(/找不到所選樓層/);
  });
  it('bounds every supported floor count without clipping the drawing aspect ratio', () => {
    for (let count = 1; count <= 12; count++) {
      const drawing = plan();
      drawing.floors = Array.from({ length: count }, (_, i) => ({ ...drawing.floors[0], id: `floor-${i}` }));
      for (const scale of [1, 2] as const) {
        const size = getBuildingPlanPngSize(drawing, null, scale);
        expect(size.width).toBeLessThanOrEqual(4096);
        expect(size.height).toBeLessThanOrEqual(4096);
        expect(size.width * size.height).toBeLessThanOrEqual(4_000_000);
        expect(Math.abs(size.width - size.height * 960 / (138 + count * 350))).toBeLessThan(1);
        expect(size.limited).toBe(count === 12 || (scale === 2 && count >= 3));
      }
    }
  });
});

describe('building plan PNG encoding (mock browser APIs)', () => {
  it('rasterizes only the selected static SVG, preserves viewBox/text, and releases resources', async () => {
    const drawing = plan();
    drawing.name = '中文 <SCRIPT>圖面</SCRIPT>';
    drawing.source = { label: '待核對的虛構來源', url: 'https://example.invalid/private?token=secret' };
    const task = exportBuildingPlanPng(drawing, 'example-2', 2, new AbortController().signal);
    const svg = await read(vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob);
    const root = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;
    expect(root.getAttribute('width')).toBe('1920');
    expect(root.getAttribute('height')).toBe('976');
    expect(root.getAttribute('viewBox')).toBe('0 0 960 488');
    expect(root.querySelector('script')).toBeNull();
    expect(root.textContent).toContain(drawing.name);
    expect(root.textContent).toContain('範例教室 201');
    expect(root.textContent).not.toContain('範例教室 101');
    expect(root.textContent).toContain('待核對的虛構來源');
    expect(root.textContent).toContain('不能用於室內導航');
    expect(svg).not.toContain('example.invalid');
    image().load();
    expect(HTMLCanvasElement.prototype.getContext).toHaveBeenCalledWith('2d', { alpha: false });
    expect(context.fillStyle).toBe('#eef3f6');
    expect(fillRect).toHaveBeenCalledWith(0, 0, 1920, 976);
    expect(drawImage).toHaveBeenCalledWith(image(), 0, 0, 1920, 976);
    expect(HTMLCanvasElement.prototype.toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/png');
    const blob = png();
    encode(blob);
    await expect(task).resolves.toEqual({ blob, width: 1920, height: 976 });
    expectReleased();
  });
  it('does not allocate resources for a cancelled request', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(exportBuildingPlanPng(plan(), null, 1, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(TestImage.instances).toHaveLength(0);
  });
  it.each(['decode', 'encode'] as const)('discards late completion after abort during %s', async phase => {
    const controller = new AbortController();
    const task = exportBuildingPlanPng(plan(), null, 1, controller.signal);
    const rejected = expect(task).rejects.toMatchObject({ name: 'AbortError' });
    const loaded = image().onload!;
    if (phase === 'encode') image().load();
    controller.abort();
    if (phase === 'encode') encode(png());
    else loaded(new Event('load'));
    await rejected;
    expectReleased();
    if (phase === 'decode') expect(drawImage).not.toHaveBeenCalled();
  });
  it('releases the source when decoding fails', async () => {
    const task = exportBuildingPlanPng(plan(), null, 1, new AbortController().signal);
    const rejected = expect(task).rejects.toThrow(/無法讀取平面圖圖片/);
    image().onerror!(new Event('error'));
    await rejected;
    expectReleased();
  });
  it.each(['context', 'draw', 'encode-throw', 'encode-null', 'encode-type'] as const)('releases all resources after %s failure', async failure => {
    if (failure === 'context') vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValueOnce(null);
    if (failure === 'draw') drawImage.mockImplementationOnce(() => { throw new Error('draw failed'); });
    if (failure === 'encode-throw') vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementationOnce(() => { throw new Error('encode failed'); });
    const task = exportBuildingPlanPng(plan(), null, 1, new AbortController().signal);
    const rejected = expect(task).rejects.toThrow();
    image().load();
    if (failure === 'encode-null') encode(null);
    if (failure === 'encode-type') encode(new Blob(['wrong type'], { type: 'image/jpeg' }));
    await rejected;
    expectReleased();
  });
  it.each(['decode', 'encode'] as const)('times out during %s and ignores late callbacks', async phase => {
    const task = exportBuildingPlanPng(plan(), null, 1, new AbortController().signal);
    const rejected = expect(task).rejects.toThrow(/PNG 匯出逾時/);
    const loaded = image().onload!;
    if (phase === 'encode') image().load();
    await vi.advanceTimersByTimeAsync(15_000);
    if (phase === 'encode') encode(png());
    else loaded(new Event('load'));
    await rejected;
    expectReleased();
  });
});
