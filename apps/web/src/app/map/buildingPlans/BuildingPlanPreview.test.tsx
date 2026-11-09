import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import BuildingPlanPreview from './BuildingPlanPreview';
import { createExampleBuildingPlan, MAX_BUILDING_PLAN_BYTES } from './buildingPlan';
import type { BuildingPlanProjectDraft, BuildingPlanProjectReference } from './buildingPlanProject';

const scene = vi.hoisted(() => ({ create: vi.fn(), setView: vi.fn(), setActive: vi.fn(), dispose: vi.fn() }));
const tracer = vi.hoisted(() => ({ render: vi.fn() }));
const projects = vi.hoisted(() => ({ import: vi.fn() }));
vi.mock('./buildingPlanScene', () => ({ createBuildingPlanScene: scene.create }));
vi.mock('./BuildingPlanTracer', () => ({ default: tracer.render }));
vi.mock('./buildingPlanProject', () => ({ importBuildingPlanProject: projects.import }));
const scope = { schoolId: 'pu', buildingId: 'test-building' };
const props = { ...scope, buildingName: '測試館', onClose: vi.fn() };
let intersection: IntersectionObserverCallback | null = null;
const disconnect = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  scene.create.mockImplementation(() => scene);
  projects.import.mockImplementation(async () => savedProject());
  tracer.render.mockImplementation(({ schoolId, buildingId, onComplete, onCancel }) => <section aria-label="測試描圖工作區">
    <input aria-label="測試描圖備註" />
    <button type="button" onClick={() => onComplete({ ...createExampleBuildingPlan({ schoolId, buildingId }),
      name: '描圖草稿', units: 'relative', source: { label: '底圖.png' } })}>完成測試描圖</button>
    <button type="button" onClick={onCancel}>取消測試描圖</button>
  </section>);
  intersection = null;
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.setAttribute('open', ''); } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value() { this.removeAttribute('open'); } });
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: IntersectionObserverCallback) { intersection = callback; }
    observe() {}
    disconnect = disconnect;
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); document.documentElement.removeAttribute('data-theme'); });

function planJson(name = '匯入圖面') {
  return JSON.stringify({ ...createExampleBuildingPlan(scope), name, verified: true, source: { label: '圖面來源', url: 'https://www.pu.edu.tw/plan' } });
}
function fileWithText(text: string | Promise<string>, name = 'plan.json') {
  const file = new File(['drawing'], name, { type: 'application/json' });
  Object.defineProperty(file, 'text', { value: vi.fn(() => Promise.resolve(text)) });
  return file;
}
function upload(file: File) { fireEvent.change(screen.getByLabelText('匯入 JSON 圖面'), { target: { files: [file] } }); }
function openProject(file = fileWithText('{}', 'building-plan-project.json')) {
  fireEvent.change(screen.getByLabelText('開啟編輯檔'), { target: { files: [file] } });
}
function savedProject(): { draft: BuildingPlanProjectDraft; reference: BuildingPlanProjectReference } {
  return {
    draft: { name: '還原圖面', floorLabel: '1F', sourceLabel: '底圖', sourceUrl: '', outline: [], rooms: [], mode: 'outline', points: [[0.1, 0.1]], roomName: '', calibration: null, metres: '', floorHeight: '', x: '10', y: '10' },
    reference: { blob: new Blob(['image'], { type: 'image/png' }), width: 600, height: 400, name: 'floor.png' },
  };
}
function loadExample() { fireEvent.click(screen.getByRole('button', { name: '載入示意範例' })); }
async function open3d() {
  loadExample();
  fireEvent.click(screen.getByRole('button', { name: '立體' }));
  await waitFor(() => expect(scene.create).toHaveBeenCalledTimes(1));
}

it('starts empty, labels the example as fictional and keeps graphics unloaded until requested', () => {
  render(<BuildingPlanPreview {...props} />);
  expect(screen.getByRole('dialog', { name: '平面圖建模預覽' })).toBeTruthy();
  expect(screen.getByText('尚未載入圖面')).toBeTruthy();
  expect(scene.create).not.toHaveBeenCalled();
  loadExample();
  expect(screen.getByText('示意範例，不代表測試館')).toBeTruthy();
  expect(screen.queryByText('待核對圖面')).toBeNull();
  expect(screen.getByRole('region', { name: '平面圖' })).toBeTruthy();
  expect(scene.create).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '關閉視窗' }));
  expect(props.onClose).toHaveBeenCalledTimes(1);
});

it('lets keyboard users select rooms in the SVG and change between one floor and all floors', () => {
  render(<BuildingPlanPreview {...props} />);
  loadExample();
  fireEvent.keyDown(screen.getByRole('button', { name: '平面圖 2F 範例教室 201' }), { key: 'Enter' });
  expect(screen.getByText('已選取：2F · 範例教室 201')).toBeTruthy();
  expect((screen.getByRole('combobox', { name: '樓層' }) as HTMLSelectElement).value).toBe('example-2');
  expect(screen.queryByRole('button', { name: '平面圖 1F 範例教室 101' })).toBeNull();
  fireEvent.change(screen.getByRole('combobox', { name: '樓層' }), { target: { value: '' } });
  fireEvent.click(within(screen.getByRole('region', { name: '房間清單' })).getByRole('button', { name: '1F 範例教室 101' }));
  expect(screen.getByText('已選取：1F · 範例教室 101')).toBeTruthy();
});

it('lists same-name rooms across floors and changes the existing scene only after choosing a candidate', async () => {
  const drawing = createExampleBuildingPlan(scope);
  drawing.floors.forEach(floor => { floor.rooms[0].name = '共同教室'; });
  render(<BuildingPlanPreview {...props} />);
  upload(fileWithText(JSON.stringify(drawing)));
  await screen.findByText('待核對圖面');
  fireEvent.click(screen.getByRole('button', { name: '立體' }));
  await waitFor(() => expect(scene.create).toHaveBeenCalledTimes(1));
  const floor = screen.getByRole('combobox', { name: '樓層' }) as HTMLSelectElement;
  fireEvent.change(floor, { target: { value: 'example-1' } });
  const search = screen.getByRole('searchbox', { name: '搜尋圖面房間' });
  search.focus();
  fireEvent.change(search, { target: { value: '共同教室' } });
  const rooms = within(screen.getByRole('region', { name: '房間清單' }));
  expect(rooms.getAllByRole('button', { name: /共同教室$/ })).toHaveLength(2);
  expect(rooms.getByRole('button', { name: '1F 共同教室' })).toBeTruthy();
  const secondFloor = rooms.getByRole('button', { name: '2F 共同教室' });
  expect(rooms.getByText('找到 2 個房間，請選擇。')).toBeTruthy();
  fireEvent.keyDown(search, { key: 'Enter' });
  expect(floor.value).toBe('example-1');
  expect(scene.setView).toHaveBeenLastCalledWith(expect.objectContaining({ floorId: 'example-1', roomId: null }));
  expect(document.activeElement).toBe(search);
  secondFloor.focus();
  fireEvent.click(secondFloor);
  expect(floor.value).toBe('example-2');
  expect(screen.getByText('已選取：2F · 共同教室')).toBeTruthy();
  expect(scene.setView).toHaveBeenLastCalledWith(expect.objectContaining({ floorId: 'example-2', roomId: 'example-2-a' }));
  expect(scene.create).toHaveBeenCalledTimes(1);
  expect(document.activeElement).toBe(secondFloor);
  expect((search as HTMLInputElement).value).toBe('共同教室');
  expect(rooms.getAllByRole('button', { name: /共同教室$/ })).toHaveLength(2);
});

it('finds rooms by floor text and combined room terms with full-width input and spacing', () => {
  render(<BuildingPlanPreview {...props} />);
  loadExample();
  const search = screen.getByRole('searchbox', { name: '搜尋圖面房間' });
  const rooms = within(screen.getByRole('region', { name: '房間清單' }));
  fireEvent.change(search, { target: { value: '　２ｆ　２０１　' } });
  expect(rooms.getByRole('button', { name: '2F 範例教室 201' })).toBeTruthy();
  expect(rooms.getAllByRole('button', { name: /範例/ })).toHaveLength(1);
  expect((screen.getByRole('combobox', { name: '樓層' }) as HTMLSelectElement).value).toBe('');
  fireEvent.change(search, { target: { value: '2f' } });
  expect(rooms.getAllByRole('button', { name: /^2F / })).toHaveLength(3);
  expect(rooms.queryByRole('button', { name: /^1F / })).toBeNull();
});

it('announces no matches and clearing restores the selected floor list and keyboard focus', () => {
  render(<BuildingPlanPreview {...props} />);
  loadExample();
  const rooms = within(screen.getByRole('region', { name: '房間清單' }));
  fireEvent.click(rooms.getByRole('button', { name: '1F 範例教室 101' }));
  const search = screen.getByRole('searchbox', { name: '搜尋圖面房間' }) as HTMLInputElement;
  fireEvent.change(search, { target: { value: '不存在的房間' } });
  expect(rooms.getByRole('status').textContent).toContain('找不到符合的房間');
  expect(rooms.queryByRole('button', { name: /範例/ })).toBeNull();
  expect(screen.getByText('已選取：1F · 範例教室 101')).toBeTruthy();
  const clear = rooms.getByRole('button', { name: '清除搜尋' });
  clear.focus();
  fireEvent.click(clear);
  expect(search.value).toBe('');
  expect(document.activeElement).toBe(search);
  expect(rooms.queryByRole('button', { name: '清除搜尋' })).toBeNull();
  expect(rooms.getAllByRole('button', { name: /^1F / })).toHaveLength(3);
  expect(rooms.queryByRole('button', { name: /^2F / })).toBeNull();
  expect(rooms.getByRole('button', { name: '1F 範例教室 101' }).getAttribute('aria-pressed')).toBe('true');
});

it.each(['json', 'example', 'tracing', 'scope'] as const)('clears the old room query when %s replaces the drawing', async replacement => {
  const view = render(<BuildingPlanPreview {...props} />);
  loadExample();
  fireEvent.change(screen.getByRole('searchbox', { name: '搜尋圖面房間' }), { target: { value: '201' } });
  if (replacement === 'json') {
    upload(fileWithText(planJson()));
    await screen.findByText('待核對圖面');
  } else if (replacement === 'example') {
    loadExample();
  } else if (replacement === 'tracing') {
    fireEvent.click(screen.getByRole('button', { name: '從圖片建立圖面' }));
    fireEvent.click(screen.getByRole('button', { name: '完成測試描圖' }));
    await waitFor(() => expect(scene.create).toHaveBeenCalledTimes(1));
  } else {
    view.rerender(<BuildingPlanPreview {...props} schoolId="another-school" buildingId="new-building" />);
    expect(screen.queryByRole('searchbox')).toBeNull();
    loadExample();
  }
  expect((screen.getByRole('searchbox', { name: '搜尋圖面房間' }) as HTMLInputElement).value).toBe('');
  expect(within(screen.getByRole('region', { name: '房間清單' })).getAllByRole('button', { name: /範例/ })).toHaveLength(6);
});

it('treats imported data as pending review despite a verified field and preserves its safe source and scope', async () => {
  render(<BuildingPlanPreview {...props} />);
  upload(fileWithText(planJson()));
  expect(await screen.findByText('待核對圖面')).toBeTruthy();
  expect(screen.getByText('圖面範圍：測試館（pu / test-building）')).toBeTruthy();
  const link = screen.getByRole('link', { name: '圖面來源 ↗' });
  expect(link.getAttribute('href')).toBe('https://www.pu.edu.tw/plan');
  expect(link.getAttribute('rel')).toBe('noreferrer');
  expect(screen.queryByText(/已驗證/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '立體' }));
  await waitFor(() => expect(scene.create).toHaveBeenCalledTimes(1));
  expect(scene.create.mock.calls[0][1]).not.toHaveProperty('verified');
});

it('preserves the old drawing on a failing import and rejects oversized or non-JSON files without reading them', async () => {
  render(<BuildingPlanPreview {...props} />);
  loadExample();
  upload(fileWithText('{broken'));
  expect(screen.getByText('示意範例，不代表測試館')).toBeTruthy();
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.queryByText('尚未載入圖面')).toBeNull();
  const image = fileWithText(planJson(), 'plan.png');
  upload(image);
  expect(image.text).not.toHaveBeenCalled();
  expect(screen.getByRole('alert').textContent).toBe('請選擇 .json 圖面檔案。');
  const large = fileWithText(planJson());
  Object.defineProperty(large, 'size', { value: MAX_BUILDING_PLAN_BYTES + 1 });
  upload(large);
  expect(large.text).not.toHaveBeenCalled();
  expect(screen.getByRole('alert').textContent).toBe('圖面檔案不可超過 256 KB。');
});

it('discards a slower upload when a newer file or example replaces it', async () => {
  let finishOld!: (text: string) => void;
  const old = new Promise<string>(resolve => { finishOld = resolve; });
  render(<BuildingPlanPreview {...props} />);
  upload(fileWithText(old));
  upload(fileWithText(planJson('最新圖面')));
  expect(await screen.findByRole('heading', { name: '最新圖面' })).toBeTruthy();
  await act(async () => finishOld(planJson('過期圖面')));
  expect(screen.queryByRole('heading', { name: '過期圖面' })).toBeNull();
  let finishNext!: (text: string) => void;
  upload(fileWithText(new Promise<string>(resolve => { finishNext = resolve; })));
  loadExample();
  await act(async () => finishNext(planJson('不應覆蓋範例')));
  expect(screen.getByText('示意範例，不代表測試館')).toBeTruthy();
  expect(screen.queryByText('不應覆蓋範例')).toBeNull();
});

it('drops imported and pending data when the building scope changes and ignores late results after unmount', async () => {
  let finish!: (text: string) => void;
  const view = render(<BuildingPlanPreview {...props} />);
  loadExample();
  upload(fileWithText(new Promise<string>(resolve => { finish = resolve; })));
  view.rerender(<BuildingPlanPreview {...props} schoolId="another-school" buildingId="other" buildingName="新館" />);
  await act(async () => finish(planJson('舊館圖面')));
  expect(screen.getByText('尚未載入圖面')).toBeTruthy();
  expect(screen.queryByText('舊館圖面')).toBeNull();
  let afterClose!: (text: string) => void;
  upload(fileWithText(new Promise<string>(resolve => { afterClose = resolve; })));
  view.unmount();
  await act(async () => afterClose(planJson()));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(scene.create).not.toHaveBeenCalled();
});

it('controls the existing scene, resolves scene room picks to floors and keeps the SVG available', async () => {
  render(<BuildingPlanPreview {...props} />);
  await open3d();
  fireEvent.click(screen.getByRole('button', { name: '向右旋轉' }));
  fireEvent.click(screen.getByRole('button', { name: '放大' }));
  fireEvent.click(screen.getByRole('button', { name: '俯視' }));
  fireEvent.click(screen.getByRole('button', { name: '組合樓層' }));
  expect(scene.setView).toHaveBeenLastCalledWith(expect.objectContaining({ bearing: 15, zoom: 1.25, overhead: true, exploded: false }));
  act(() => scene.create.mock.calls[0][2].onSelect('example-2-b'));
  expect(screen.getByText('已選取：2F · 範例教室 202')).toBeTruthy();
  expect(screen.getByRole('button', { name: '平面圖 2F 範例教室 202' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '重設視角' }));
  expect(scene.setView).toHaveBeenLastCalledWith(expect.objectContaining({ floorId: 'example-2', roomId: 'example-2-b', bearing: 0, zoom: 1, overhead: false, exploded: true }));
  expect(scene.create).toHaveBeenCalledTimes(1);
});

it('retains an operable floor plan after graphics failure and retries with the latest room selection', async () => {
  scene.create.mockImplementationOnce(() => { throw new Error('WebGL unavailable'); });
  render(<BuildingPlanPreview {...props} />);
  await open3d();
  expect(await screen.findByText(/目前無法顯示立體圖面/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '平面圖 1F 範例教室 101' }));
  fireEvent.click(screen.getByRole('button', { name: '重試立體預覽' }));
  await waitFor(() => expect(scene.create).toHaveBeenCalledTimes(2));
  expect(scene.setView).toHaveBeenLastCalledWith(expect.objectContaining({ floorId: 'example-1', roomId: 'example-1-a' }));
  expect(document.querySelector('[data-building-plan-state="ready"]')).toBeTruthy();
  act(() => scene.create.mock.calls[1][2].onError());
  expect(scene.dispose).toHaveBeenCalledTimes(1);
  expect(screen.getByText('已選取：1F · 範例教室 101')).toBeTruthy();
});

it('disposes a scene that reports failure while being constructed exactly once', async () => {
  scene.create.mockImplementationOnce((_host, _plan, callbacks) => { callbacks.onError(); return scene; });
  const view = render(<BuildingPlanPreview {...props} />);
  await open3d();
  expect(await screen.findByText(/目前無法顯示立體圖面/)).toBeTruthy();
  expect(scene.dispose).toHaveBeenCalledTimes(1);
  expect(scene.setView).not.toHaveBeenCalled();
  view.unmount();
  expect(scene.dispose).toHaveBeenCalledTimes(1);
});

it('pauses hidden graphics, follows theme changes and disposes when returning to the flat view', async () => {
  render(<BuildingPlanPreview {...props} />);
  await open3d();
  expect(scene.setActive).toHaveBeenLastCalledWith(true);
  act(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect(scene.setActive).toHaveBeenLastCalledWith(false);
  act(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    intersection?.([{ isIntersecting: false }] as IntersectionObserverEntry[], {} as IntersectionObserver);
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect(scene.setActive).toHaveBeenLastCalledWith(false);
  act(() => intersection?.([{ isIntersecting: true }] as IntersectionObserverEntry[], {} as IntersectionObserver));
  expect(scene.setActive).toHaveBeenLastCalledWith(true);
  await act(async () => { document.documentElement.dataset.theme = 'dark'; });
  expect(scene.setView).toHaveBeenLastCalledWith(expect.objectContaining({ dark: true }));
  fireEvent.click(screen.getByRole('button', { name: '平面' }));
  expect(scene.dispose).toHaveBeenCalledTimes(1);
  expect(disconnect).toHaveBeenCalledTimes(1);
});

it('does not construct graphics if the user closes before the lazy import resolves', async () => {
  const view = render(<BuildingPlanPreview {...props} />);
  loadExample();
  fireEvent.click(screen.getByRole('button', { name: '立體' }));
  view.unmount();
  await act(async () => {});
  expect(scene.create).not.toHaveBeenCalled();
});

it('downloads a self-contained SVG for all or just the selected floor', async () => {
  const createUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:floor-print');
  const revokeUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  render(<BuildingPlanPreview {...props} />);
  loadExample();

  const download = screen.getByRole('button', { name: '下載平面圖 SVG' });
  fireEvent.click(download);
  const read = (blob: Blob) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsText(blob);
  });
  const all = await read(createUrl.mock.calls[0][0] as Blob);
  expect(all).toContain('範例教室 101');
  expect(all).toContain('範例教室 201');
  expect(all).toContain('待核對圖面');
  expect((createUrl.mock.calls[0][0] as Blob).type).toBe('image/svg+xml;charset=utf-8');

  fireEvent.change(screen.getByRole('combobox', { name: '樓層' }), { target: { value: 'example-2' } });
  fireEvent.click(download);
  const oneFloor = await read(createUrl.mock.calls[1][0] as Blob);
  expect(oneFloor).toContain('範例教室 201');
  expect(oneFloor).not.toContain('範例教室 101');
  expect(click).toHaveBeenCalledTimes(2);
  await waitFor(() => expect(revokeUrl).toHaveBeenCalledWith('blob:floor-print'), { timeout: 2_000 });
});

it('downloads a scoped fictional template and revokes its temporary URL', async () => {
  const createUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:plan-template');
  const revokeUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  render(<BuildingPlanPreview {...props} />);
  fireEvent.click(screen.getByRole('button', { name: '下載圖面範本' }));
  const blob = createUrl.mock.calls[0][0] as Blob;
  const contents = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsText(blob);
  });
  expect(JSON.parse(contents)).toMatchObject({ ...scope, units: 'm', source: { label: expect.stringContaining('虛構範例') } });
  expect(click).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(revokeUrl).toHaveBeenCalledWith('blob:plan-template'), { timeout: 2_000 });
  expect(screen.getByText('尚未載入圖面')).toBeTruthy();
});

it('opens a traced plan in 3D, retains its draft for editing and returns focus when cancelling edits', async () => {
  render(<BuildingPlanPreview {...props} />);
  fireEvent.click(screen.getByRole('button', { name: '從圖片建立圖面' }));
  fireEvent.change(screen.getByLabelText('測試描圖備註'), { target: { value: '保留描點' } });
  fireEvent.click(screen.getByRole('button', { name: '完成測試描圖' }));
  await waitFor(() => expect(scene.create).toHaveBeenCalledTimes(1));
  expect(scene.create.mock.calls[0][1]).toMatchObject({ ...scope, units: 'relative' });
  expect(screen.getByText('待核對圖面')).toBeTruthy();
  expect(screen.getByText(/未校正比例：使用示意單位/)).toBeTruthy();
  expect(document.activeElement).toBe(document.querySelector('[data-building-plan-state]'));
  expect(screen.queryByRole('region', { name: '測試描圖工作區' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '返回圖面編輯' }));
  expect((screen.getByLabelText('測試描圖備註') as HTMLInputElement).value).toBe('保留描點');
  expect(scene.dispose).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: '取消測試描圖' }));
  expect(screen.getByRole('heading', { name: '描圖草稿' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: '返回圖面編輯' })).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole('combobox', { name: '樓層' }));
});

it('exports the current unscaled plan and discards stale file reads or drawing drafts when replaced', async () => {
  const createUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:current-plan');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  let finish!: (text: string) => void;
  const view = render(<BuildingPlanPreview {...props} />);
  upload(fileWithText(new Promise<string>(resolve => { finish = resolve; })));
  fireEvent.click(screen.getByRole('button', { name: '從圖片建立圖面' }));
  fireEvent.click(screen.getByRole('button', { name: '完成測試描圖' }));
  await act(async () => finish(planJson('晚到的 JSON')));
  expect(screen.queryByRole('heading', { name: '晚到的 JSON' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '下載目前圖面' }));
  const blob = createUrl.mock.calls[0][0] as Blob;
  const contents = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsText(blob);
  });
  const exported = JSON.parse(contents);
  expect(exported).toMatchObject({ ...scope, name: '描圖草稿', units: 'relative', source: { label: '底圖.png' } });
  expect(exported).not.toHaveProperty('image');
  expect(exported).not.toHaveProperty('verified');
  loadExample();
  expect(screen.queryByRole('button', { name: '返回圖面編輯' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '從圖片建立圖面' }));
  view.rerender(<BuildingPlanPreview {...props} schoolId="other" buildingId="other-building" />);
  expect(screen.queryByRole('region', { name: '測試描圖工作區' })).toBeNull();
  expect(screen.getByText('尚未載入圖面')).toBeTruthy();
});

it('keeps the current plan and query until an editing file has been validated successfully', async () => {
  let reject!: (error: Error) => void;
  projects.import.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
  render(<BuildingPlanPreview {...props} />);
  loadExample();
  const search = screen.getByRole('searchbox', { name: '搜尋圖面房間' }) as HTMLInputElement;
  fireEvent.change(search, { target: { value: '201' } });
  const file = fileWithText('{}', 'wrong-scope-project.json');
  openProject(file);
  expect(screen.getByText('正在開啟編輯檔…')).toBeTruthy();
  expect(screen.getByText('示意範例，不代表測試館')).toBeTruthy();
  expect(search.value).toBe('201');
  expect(projects.import).toHaveBeenCalledWith(file, scope, expect.any(AbortSignal));
  await act(async () => reject(new Error('編輯檔的建築範圍不符。')));
  expect(screen.getByRole('alert').textContent).toBe('編輯檔的建築範圍不符。');
  expect(screen.getByRole('searchbox', { name: '搜尋圖面房間' })).toBe(search);
  expect(search.value).toBe('201');
  expect(screen.queryByText('正在開啟編輯檔…')).toBeNull();
  openProject();
  expect(await screen.findByRole('region', { name: '測試描圖工作區' })).toBeTruthy();
  expect(screen.queryByText('示意範例，不代表測試館')).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '完成測試描圖' }));
  await waitFor(() => expect(scene.create).toHaveBeenCalledTimes(1));
  expect((screen.getByRole('searchbox', { name: '搜尋圖面房間' }) as HTMLInputElement).value).toBe('');
});

it('preserves an active draft on a bad editing file and remounts it with the validated project on success', async () => {
  projects.import.mockRejectedValueOnce(new Error('編輯檔內的圖片無法使用。'));
  render(<BuildingPlanPreview {...props} />);
  fireEvent.click(screen.getByRole('button', { name: '從圖片建立圖面' }));
  const original = screen.getByLabelText('測試描圖備註') as HTMLInputElement;
  fireEvent.change(original, { target: { value: '不能遺失的描點' } });
  openProject();
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.getByLabelText('測試描圖備註')).toBe(original);
  expect(original.value).toBe('不能遺失的描點');
  expect(original.closest('[inert]')).toBeNull();
  const restored = savedProject();
  projects.import.mockResolvedValueOnce(restored);
  openProject();
  await waitFor(() => expect(tracer.render.mock.calls.at(-1)?.[0].initialProject).toBe(restored));
  const replacement = screen.getByLabelText('測試描圖備註');
  expect(replacement).not.toBe(original);
  expect(replacement.closest('[inert]')).toBeNull();
  expect(document.activeElement).toBe(replacement.parentElement?.parentElement);
  expect(screen.getByLabelText('開啟編輯檔')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '取消測試描圖' }));
  fireEvent.click(screen.getByRole('button', { name: '從圖片建立圖面' }));
  expect(tracer.render.mock.calls.at(-1)?.[0].initialProject).toBeUndefined();
});

it('pauses the mounted draft during a project read and cancellation resumes it without accepting a late result', async () => {
  let resolve!: (project: ReturnType<typeof savedProject>) => void;
  projects.import.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  render(<BuildingPlanPreview {...props} />);
  fireEvent.click(screen.getByRole('button', { name: '從圖片建立圖面' }));
  const original = screen.getByLabelText('測試描圖備註') as HTMLInputElement;
  fireEvent.change(original, { target: { value: '保留原本描點' } });
  const draft = original.parentElement?.parentElement;
  openProject();
  const signal = projects.import.mock.calls[0][2] as AbortSignal;
  expect(draft?.hasAttribute('inert')).toBe(true);
  expect(draft?.getAttribute('aria-busy')).toBe('true');
  expect(original.isConnected).toBe(true);
  expect(original.value).toBe('保留原本描點');
  const file = screen.getByLabelText('開啟編輯檔');
  const cancel = screen.getByRole('button', { name: '取消開啟' });
  expect(file.closest('[inert]')).toBeNull();
  expect(cancel.closest('[inert]')).toBeNull();
  expect(screen.getByRole('button', { name: '關閉視窗' }).closest('[inert]')).toBeNull();
  cancel.focus();
  fireEvent.click(cancel);
  expect(signal.aborted).toBe(true);
  expect(draft?.hasAttribute('inert')).toBe(false);
  expect(draft?.getAttribute('aria-busy')).toBe('false');
  expect(screen.getByLabelText('測試描圖備註')).toBe(original);
  expect(document.activeElement).toBe(file);
  expect(screen.queryByRole('button', { name: '取消開啟' })).toBeNull();
  fireEvent.change(original, { target: { value: '取消後繼續描點' } });
  await act(async () => resolve(savedProject()));
  expect(screen.getByLabelText('測試描圖備註')).toBe(original);
  expect(original.value).toBe('取消後繼續描點');
  expect(tracer.render.mock.calls.at(-1)?.[0].initialProject).toBeUndefined();
  expect(screen.queryByText('正在開啟編輯檔…')).toBeNull();
});

it.each(['resolve', 'reject'] as const)('discards an older editing file that later %ss after a newer project', async outcome => {
  let resolve!: (project: ReturnType<typeof savedProject>) => void;
  let reject!: (error: Error) => void;
  projects.import.mockImplementationOnce(() => new Promise((done, fail) => { resolve = done; reject = fail; }));
  const latest = savedProject();
  latest.draft.name = '最新編輯檔';
  projects.import.mockResolvedValueOnce(latest);
  render(<BuildingPlanPreview {...props} />);
  openProject();
  const oldSignal = projects.import.mock.calls[0][2] as AbortSignal;
  openProject();
  expect(oldSignal.aborted).toBe(true);
  await waitFor(() => expect(tracer.render.mock.calls.at(-1)?.[0].initialProject).toBe(latest));
  const current = screen.getByLabelText('測試描圖備註');
  await act(async () => {
    if (outcome === 'resolve') resolve(savedProject());
    else reject(new Error('過期檔案錯誤'));
  });
  expect(tracer.render.mock.calls.at(-1)?.[0].initialProject).toBe(latest);
  expect(screen.getByLabelText('測試描圖備註')).toBe(current);
  expect(screen.queryByRole('alert')).toBeNull();
});

it.each(['json', 'example', 'clear', 'trace', 'scope', 'unmount'] as const)('aborts a pending editing file when %s supersedes it', async action => {
  let resolve!: (project: ReturnType<typeof savedProject>) => void;
  projects.import.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const view = render(<BuildingPlanPreview {...props} />);
  loadExample();
  openProject();
  const signal = projects.import.mock.calls[0][2] as AbortSignal;
  if (action === 'json') {
    upload(fileWithText(planJson('新的 JSON 圖面')));
    await screen.findByRole('heading', { name: '新的 JSON 圖面' });
  } else if (action === 'example') loadExample();
  else if (action === 'clear') fireEvent.click(screen.getByRole('button', { name: '清除圖面' }));
  else if (action === 'trace') fireEvent.click(screen.getByRole('button', { name: '從圖片建立圖面' }));
  else if (action === 'scope') view.rerender(<BuildingPlanPreview {...props} buildingId="other-building" />);
  else view.unmount();
  expect(signal.aborted).toBe(true);
  await act(async () => resolve(savedProject()));
  expect(tracer.render.mock.calls.every(([value]) => value.initialProject === undefined)).toBe(true);
  expect(screen.queryByText('正在開啟編輯檔…')).toBeNull();
  if (action === 'trace') expect(screen.getByRole('region', { name: '測試描圖工作區' })).toBeTruthy();
  else expect(screen.queryByRole('region', { name: '測試描圖工作區' })).toBeNull();
  if (action === 'json') expect(screen.getByRole('heading', { name: '新的 JSON 圖面' })).toBeTruthy();
  if (action === 'clear' || action === 'scope') expect(screen.getByText('尚未載入圖面')).toBeTruthy();
});

it.each(['{broken', '{}'])('preserves the plan, view, query and editable draft after invalid JSON: %s', async contents => {
  render(<BuildingPlanPreview {...props} />);
  fireEvent.click(screen.getByRole('button', { name: '從圖片建立圖面' }));
  const draft = screen.getByLabelText('測試描圖備註') as HTMLInputElement;
  fireEvent.change(draft, { target: { value: '尚未下載的描點' } });
  fireEvent.click(screen.getByRole('button', { name: '完成測試描圖' }));
  await waitFor(() => expect(scene.create).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole('button', { name: '平面圖 2F 範例教室 201' }));
  const search = screen.getByRole('searchbox', { name: '搜尋圖面房間' }) as HTMLInputElement;
  fireEvent.change(search, { target: { value: '201' } });
  let finish!: (text: string) => void;
  upload(fileWithText(new Promise(resolve => { finish = resolve; })));
  expect(screen.getByRole('heading', { name: '描圖草稿' })).toBeTruthy();
  expect(search.value).toBe('201');
  expect(draft.isConnected).toBe(true);
  await act(async () => finish(contents));
  expect(screen.getByRole('alert')).toBeTruthy();
  expect(screen.getByRole('heading', { name: '描圖草稿' })).toBeTruthy();
  expect(screen.getByRole('searchbox', { name: '搜尋圖面房間' })).toBe(search);
  expect(search.value).toBe('201');
  expect(screen.getByText('已選取：2F · 範例教室 201')).toBeTruthy();
  expect(screen.getByRole('button', { name: '立體' }).getAttribute('aria-pressed')).toBe('true');
  expect(scene.dispose).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '返回圖面編輯' }));
  expect(screen.getByLabelText('測試描圖備註')).toBe(draft);
  expect(draft.value).toBe('尚未下載的描點');
});
