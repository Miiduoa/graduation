import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { StrictMode } from 'react';
import BuildingPlanTracer from './BuildingPlanTracer';
import { prepareBuildingPlanReference } from './buildingPlanReference';
import { exportBuildingPlanProject, type BuildingPlanProjectDraft } from './buildingPlanProject';

vi.mock('./buildingPlanReference', () => ({ prepareBuildingPlanReference: vi.fn() }));
vi.mock('./buildingPlanProject', () => ({ exportBuildingPlanProject: vi.fn() }));
const props = { schoolId: 'pu', buildingId: 'test-building', buildingName: '測試館', onComplete: vi.fn(), onCancel: vi.fn() };
const prepared = (name = 'floor.png') => ({ blob: new Blob(['safe pixels'], { type: 'image/png' }), width: 1000, height: 500, name });

beforeEach(() => {
  vi.restoreAllMocks();
  props.onComplete.mockReset();
  props.onCancel.mockReset();
  vi.mocked(prepareBuildingPlanReference).mockReset().mockImplementation(async file => prepared(file.name));
  vi.mocked(exportBuildingPlanProject).mockReset().mockResolvedValue(new Blob(['project'], { type: 'application/json' }));
  let sequence = 0;
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:trace-${++sequence}`);
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

function chooseFile(name = 'floor.png') {
  const file = new File(['pixels'], name, { type: 'image/png' });
  fireEvent.change(screen.getByLabelText('選擇圖面圖片'), { target: { files: [file] } });
  return file;
}
async function openImage() {
  chooseFile();
  return screen.findByRole('group', { name: '圖片描圖區' });
}
function point(x: number, y: number) {
  fireEvent.change(screen.getByLabelText('水平位置（%）'), { target: { value: String(x) } });
  fireEvent.change(screen.getByLabelText('垂直位置（%）'), { target: { value: String(y) } });
  fireEvent.click(screen.getByRole('button', { name: '加入描點' }));
}
function outline() {
  point(5, 5); point(95, 5); point(95, 95); point(5, 95);
  fireEvent.click(screen.getByRole('button', { name: '完成外框' }));
}
function room(name: string, left = 10) {
  fireEvent.click(screen.getByRole('button', { name: '新增房間' }));
  point(left, 20); point(left + 20, 20); point(left + 20, 40); point(left, 40);
  fireEvent.change(screen.getByLabelText('新房間名稱'), { target: { value: name } });
  fireEvent.click(screen.getByRole('button', { name: '完成房間' }));
}

it('creates an uncalibrated outline-only plan without inventing rooms and retains the editor until unmount', async () => {
  const view = render(<BuildingPlanTracer {...props} />);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(prepareBuildingPlanReference).not.toHaveBeenCalled();
  const canvas = await openImage();
  expect(screen.getByText(/未校正比例／示意單位/)).toBeTruthy();
  outline();
  fireEvent.click(screen.getByRole('button', { name: '建立立體預覽' }));
  expect(props.onComplete).toHaveBeenCalledTimes(1);
  expect(props.onComplete.mock.calls[0][0]).toMatchObject({
    schoolId: 'pu', buildingId: 'test-building', units: 'relative',
    floors: [{ height: 3, rooms: [], outline: [[0, 0], [expect.closeTo(18, 8), 0], [expect.closeTo(18, 8), expect.closeTo(9, 8)], [0, expect.closeTo(9, 8)]] }],
    source: { label: 'floor.png' },
  });
  expect(canvas.querySelector('image')?.getAttribute('href')).toBe('blob:trace-1');
  expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  view.unmount();
  expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:trace-1');
});

it('supports keyboard drawing, undo and cancellation without trapping ordinary Tab navigation', async () => {
  render(<BuildingPlanTracer {...props} />);
  const canvas = await openImage();
  fireEvent.keyDown(canvas, { key: 'ArrowLeft', shiftKey: true });
  fireEvent.keyDown(canvas, { key: 'ArrowUp' });
  expect((screen.getByLabelText('水平位置（%）') as HTMLInputElement).value).toBe('45');
  expect((screen.getByLabelText('垂直位置（%）') as HTMLInputElement).value).toBe('49');
  fireEvent.keyDown(canvas, { key: 'Enter' });
  expect(screen.getByText('樓層外框描點：1 / 64')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '上一步' }));
  expect(screen.getByText('樓層外框描點：0 / 64')).toBeTruthy();
  point(10, 10);
  fireEvent.click(screen.getByRole('button', { name: '取消目前描點' }));
  expect(screen.getByText('樓層外框描點：0 / 64')).toBeTruthy();
  const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
  act(() => canvas.dispatchEvent(tab));
  expect(tab.defaultPrevented).toBe(false);
});

it('maps pointer coordinates through the SVG transform and ignores taps outside the image', async () => {
  render(<BuildingPlanTracer {...props} />);
  const canvas = await openImage();
  // 1000×500 image fitted into a 400×400 viewport, with a 1px border.
  const inverse = { a: 2.5, d: 2.5, e: -2.5, f: -252.5 };
  Object.defineProperty(canvas, 'getScreenCTM', { value: () => ({ inverse: () => inverse }) });
  Object.defineProperty(canvas, 'createSVGPoint', { value: () => {
    const point = { x: 0, y: 0, matrixTransform: (matrix: typeof inverse) => ({ x: point.x * matrix.a + matrix.e, y: point.y * matrix.d + matrix.f }) };
    return point;
  } });
  fireEvent.click(canvas, { clientX: 201, clientY: 51 });
  expect(screen.getByText('樓層外框描點：0 / 64')).toBeTruthy();
  fireEvent.click(canvas, { clientX: 101, clientY: 151 });
  expect((screen.getByLabelText('水平位置（%）') as HTMLInputElement).value).toBe('25');
  expect((screen.getByLabelText('垂直位置（%）') as HTMLInputElement).value).toBe('25');
  expect(screen.getByText('樓層外框描點：1 / 64')).toBeTruthy();
});

it('rejects crossed outlines and out-of-bound rooms while keeping the points available to repair', async () => {
  render(<BuildingPlanTracer {...props} />);
  await openImage();
  point(5, 5); point(95, 95); point(95, 5); point(5, 95);
  fireEvent.click(screen.getByRole('button', { name: '完成外框' }));
  expect(screen.getByRole('alert').textContent).toContain('交錯');
  expect(screen.getByText('樓層外框描點：4 / 64')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '取消目前描點' }));
  outline();
  fireEvent.click(screen.getByRole('button', { name: '新增房間' }));
  point(0, 0); point(20, 0); point(20, 20); point(0, 20);
  fireEvent.change(screen.getByLabelText('新房間名稱'), { target: { value: '外框之外' } });
  fireEvent.click(screen.getByRole('button', { name: '完成房間' }));
  expect(screen.getByRole('alert').textContent).toContain('超出');
  expect(props.onComplete).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '取消目前描點' }));
  expect(screen.queryByLabelText('房間 1 名稱')).toBeNull();
});

it('allows duplicate room names with unique ids and supports renaming and removal', async () => {
  render(<BuildingPlanTracer {...props} />);
  await openImage();
  outline();
  room('討論室'); room('討論室', 50);
  fireEvent.click(screen.getByRole('button', { name: '建立立體預覽' }));
  const rooms = props.onComplete.mock.calls[0][0].floors[0].rooms;
  expect(rooms.map((item: { name: string }) => item.name)).toEqual(['討論室', '討論室']);
  expect(new Set(rooms.map((item: { id: string }) => item.id)).size).toBe(2);
  fireEvent.change(screen.getByLabelText('房間 2 名稱'), { target: { value: '閱覽室' } });
  fireEvent.click(screen.getByRole('button', { name: '移除房間 1 討論室' }));
  fireEvent.click(screen.getByRole('button', { name: '建立立體預覽' }));
  expect(props.onComplete.mock.calls[1][0].floors[0].rooms).toMatchObject([{ name: '閱覽室' }]);
  expect(props.onComplete.mock.calls[1][0].floors[0].rooms).toHaveLength(1);
});

it('requires a known distance and floor height before creating a calibrated metre plan', async () => {
  render(<BuildingPlanTracer {...props} />);
  await openImage();
  outline();
  fireEvent.click(screen.getByRole('button', { name: '選兩點校正比例' }));
  point(5, 5); point(95, 5);
  fireEvent.change(screen.getByLabelText('兩點實際距離（公尺）'), { target: { value: '9' } });
  fireEvent.click(screen.getByRole('button', { name: '套用比例' }));
  expect(screen.getByRole('alert').textContent).toContain('樓高');
  fireEvent.change(screen.getByLabelText('樓高（公尺）'), { target: { value: '3.2' } });
  fireEvent.click(screen.getByRole('button', { name: '套用比例' }));
  fireEvent.click(screen.getByRole('button', { name: '建立立體預覽' }));
  expect(props.onComplete.mock.calls[0][0]).toMatchObject({ units: 'm', floors: [{ height: 3.2, outline: [[0, 0], [9, 0], [9, 4.5], [0, 4.5]] }] });
  fireEvent.click(screen.getByRole('button', { name: '移除比例校正' }));
  fireEvent.click(screen.getByRole('button', { name: '建立立體預覽' }));
  expect(props.onComplete.mock.calls[1][0].units).toBe('relative');
});

it('validates edited provenance before completing and never trusts it as verification', async () => {
  render(<BuildingPlanTracer {...props} />);
  await openImage();
  outline();
  fireEvent.change(screen.getByLabelText('來源名稱'), { target: { value: '使用者提供的圖面' } });
  fireEvent.change(screen.getByLabelText('來源網址（選填，HTTPS）'), { target: { value: 'javascript:alert(1)' } });
  fireEvent.click(screen.getByRole('button', { name: '建立立體預覽' }));
  expect(props.onComplete).not.toHaveBeenCalled();
  expect(screen.getByRole('alert').textContent).toContain('HTTPS');
  fireEvent.change(screen.getByLabelText('來源網址（選填，HTTPS）'), { target: { value: 'https://www.pu.edu.tw/floor' } });
  fireEvent.click(screen.getByRole('button', { name: '建立立體預覽' }));
  expect(props.onComplete.mock.calls[0][0].source).toEqual({ label: '使用者提供的圖面', url: 'https://www.pu.edu.tw/floor' });
  expect(screen.getByText(/仍為待核對圖面/)).toBeTruthy();
});

it('keeps the old image and geometry until replacement succeeds and ignores late decodes', async () => {
  render(<BuildingPlanTracer {...props} />);
  await openImage();
  outline();
  let resolveOld!: (value: ReturnType<typeof prepared>) => void;
  vi.mocked(prepareBuildingPlanReference).mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
  chooseFile('slow.png');
  expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  expect(screen.getByRole('group', { name: '圖片描圖區' }).querySelector('polygon')).toBeTruthy();
  chooseFile('latest.png');
  await waitFor(() => expect((screen.getByLabelText('來源名稱') as HTMLInputElement).value).toBe('latest.png'));
  const canvas = screen.getByRole('group', { name: '圖片描圖區' });
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:trace-1');
  await act(async () => resolveOld(prepared('slow.png')));
  expect(canvas.querySelector('image')?.getAttribute('href')).toBe('blob:trace-2');
  expect((screen.getByLabelText('來源名稱') as HTMLInputElement).value).toBe('latest.png');
  expect(screen.getByText('樓層外框描點：0 / 64')).toBeTruthy();
  expect(URL.createObjectURL).toHaveBeenCalledTimes(2);
  expect(vi.mocked(prepareBuildingPlanReference).mock.calls[1][1]?.aborted).toBe(true);
});

it('aborts a pending decode on scope changes or unmount and releases an installed image on cancel', async () => {
  let finish!: (value: ReturnType<typeof prepared>) => void;
  vi.mocked(prepareBuildingPlanReference).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const view = render(<BuildingPlanTracer {...props} />);
  chooseFile();
  const signal = vi.mocked(prepareBuildingPlanReference).mock.calls[0][1];
  view.rerender(<BuildingPlanTracer {...props} buildingId="other-building" />);
  expect(signal?.aborted).toBe(true);
  await act(async () => finish(prepared()));
  expect(URL.createObjectURL).not.toHaveBeenCalled();
  await openImage();
  fireEvent.click(screen.getByRole('button', { name: '取消描圖' }));
  expect(props.onCancel).toHaveBeenCalledTimes(1);
  expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:trace-1');
  vi.mocked(prepareBuildingPlanReference).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  chooseFile();
  const lastSignal = vi.mocked(prepareBuildingPlanReference).mock.calls.at(-1)![1];
  view.unmount();
  await act(async () => finish(prepared('late.png')));
  expect(lastSignal?.aborted).toBe(true);
  expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
});

it('preserves the reference, rooms and unfinished draft when a replacement image fails to decode', async () => {
  const draft = restoredDraft();
  const reference = prepared();
  render(<BuildingPlanTracer {...props} initialProject={{ draft, reference }} />);
  const canvas = screen.getByRole('group', { name: '圖片描圖區' });
  const drawing = canvas.innerHTML;
  vi.mocked(prepareBuildingPlanReference).mockRejectedValueOnce(new Error('圖片無法解碼。'));
  chooseFile('bad.png');
  await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('圖片無法解碼。'));
  expect(screen.getByRole('group', { name: '圖片描圖區' })).toBe(canvas);
  expect(canvas.innerHTML).toBe(drawing);
  expect((screen.getByLabelText('房間 1 名稱') as HTMLInputElement).value).toBe('討論室');
  expect((screen.getByLabelText('新房間名稱') as HTMLInputElement).value).toBe('自習室');
  expect(screen.getByText('房間描點：2 / 64')).toBeTruthy();
  expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  fireEvent.click(screen.getByRole('button', { name: '下載編輯檔' }));
  await waitFor(() => expect(exportBuildingPlanProject).toHaveBeenCalledWith(
    { schoolId: props.schoolId, buildingId: props.buildingId }, draft, reference, expect.any(AbortSignal),
  ));
});

function restoredDraft(): BuildingPlanProjectDraft {
  return {
    name: '可續編的二樓', floorLabel: '2F', sourceLabel: '自有圖面', sourceUrl: '',
    outline: [[0.05, 0.05], [0.95, 0.05], [0.95, 0.95], [0.05, 0.95]],
    rooms: [
      { id: 'traced-room-1', name: '討論室', polygon: [[0.1, 0.2], [0.3, 0.2], [0.3, 0.4], [0.1, 0.4]] },
      { id: 'traced-room-3', name: '閱覽區', polygon: [[0.1, 0.5], [0.3, 0.5], [0.3, 0.7], [0.1, 0.7]] },
    ],
    mode: 'room', points: [[0.5, 0.2], [0.7, 0.2]], roomName: '自習室',
    calibration: [[0.05, 0.05], [0.95, 0.05]], metres: '9', floorHeight: '3.2', x: '70', y: '20',
  };
}

it('resumes a pending room with its reference and calibration without reusing a removed room id', () => {
  const view = render(<BuildingPlanTracer {...props} initialProject={{ draft: restoredDraft(), reference: prepared() }} />);
  const canvas = screen.getByRole('group', { name: '圖片描圖區' });
  expect(prepareBuildingPlanReference).not.toHaveBeenCalled();
  expect(canvas.querySelector('image')?.getAttribute('href')).toBe('blob:trace-1');
  expect((screen.getByLabelText('圖面名稱') as HTMLInputElement).value).toBe('可續編的二樓');
  expect((screen.getByLabelText('樓層名稱') as HTMLInputElement).value).toBe('2F');
  expect((screen.getByLabelText('新房間名稱') as HTMLInputElement).value).toBe('自習室');
  expect((screen.getByLabelText('兩點實際距離（公尺）') as HTMLInputElement).value).toBe('9');
  expect((screen.getByLabelText('樓高（公尺）') as HTMLInputElement).value).toBe('3.2');
  expect(screen.getByText('房間描點：2 / 64')).toBeTruthy();
  expect(props.onComplete).not.toHaveBeenCalled();
  point(70, 40); point(50, 40);
  fireEvent.click(screen.getByRole('button', { name: '完成房間' }));
  fireEvent.click(screen.getByRole('button', { name: '建立立體預覽' }));
  const plan = props.onComplete.mock.calls[0][0];
  expect(plan).toMatchObject({ name: '可續編的二樓', units: 'm', floors: [{ label: '2F', height: 3.2 }] });
  expect(plan.floors[0].rooms.map((item: { id: string }) => item.id)).toEqual(['traced-room-1', 'traced-room-3', 'traced-room-4']);
  expect(plan.floors[0].rooms[2].name).toBe('自習室');
  view.unmount();
  expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:trace-1');
});

it('downloads the complete editable snapshot even before the outline is finished', async () => {
  const downloads: Array<{ href: string; name: string }> = [];
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    downloads.push({ href: this.href, name: this.download });
  });
  render(<BuildingPlanTracer {...props} />);
  await openImage();
  point(10, 20); point(80, 20);
  fireEvent.click(screen.getByRole('button', { name: '下載編輯檔' }));
  await waitFor(() => expect(downloads).toEqual([{ href: 'blob:trace-2', name: 'building-plan-project.json' }]));
  expect(exportBuildingPlanProject).toHaveBeenCalledTimes(1);
  const [scope, draft, reference, signal] = vi.mocked(exportBuildingPlanProject).mock.calls[0];
  expect(scope).toEqual({ schoolId: 'pu', buildingId: 'test-building' });
  expect(draft).toMatchObject({ mode: 'outline', outline: [], points: [[0.1, 0.2], [0.8, 0.2]], x: '80', y: '20' });
  expect(reference).toMatchObject({ width: 1000, height: 500, name: 'floor.png' });
  expect(reference.blob.type).toBe('image/png');
  expect(reference).not.toHaveProperty('url');
  expect(signal?.aborted).toBe(false);
  expect(screen.getByText('樓層外框描點：2 / 64')).toBeTruthy();
  expect(screen.getByText('編輯檔已準備下載，內含底圖與目前描點。')).toBeTruthy();
  expect(props.onComplete).not.toHaveBeenCalled();
});

it('preserves the editable image and points when exporting fails', async () => {
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  vi.mocked(exportBuildingPlanProject).mockRejectedValueOnce(new Error('編輯檔底圖不可超過 10 MiB。'));
  render(<BuildingPlanTracer {...props} />);
  const canvas = await openImage();
  point(10, 20);
  fireEvent.click(screen.getByRole('button', { name: '下載編輯檔' }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('10 MiB'));
  expect(canvas.querySelector('image')?.getAttribute('href')).toBe('blob:trace-1');
  expect(screen.getByText('樓層外框描點：1 / 64')).toBeTruthy();
  expect(click).not.toHaveBeenCalled();
  expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  expect((screen.getByRole('button', { name: '下載編輯檔' }) as HTMLButtonElement).disabled).toBe(false);
});

it.each(['replace', 'scope', 'cancel', 'unmount'] as const)('does not download an old snapshot after %s', async action => {
  let finish!: (blob: Blob) => void;
  vi.mocked(exportBuildingPlanProject).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  const view = render(<BuildingPlanTracer {...props} />);
  await openImage();
  point(10, 20);
  fireEvent.click(screen.getByRole('button', { name: '下載編輯檔' }));
  const signal = vi.mocked(exportBuildingPlanProject).mock.calls[0][3];
  if (action === 'replace') {
    chooseFile('replacement.png');
    await screen.findByRole('group', { name: '圖片描圖區' });
  } else if (action === 'scope') view.rerender(<BuildingPlanTracer {...props} schoolId="another-school" />);
  else if (action === 'cancel') fireEvent.click(screen.getByRole('button', { name: '取消描圖' }));
  else view.unmount();
  expect(signal?.aborted).toBe(true);
  await act(async () => finish(new Blob(['late project'])));
  expect(click).not.toHaveBeenCalled();
  expect(URL.createObjectURL).toHaveBeenCalledTimes(action === 'replace' ? 2 : 1);
});

it('keeps the active reference URL valid during StrictMode and releases it on unmount', () => {
  const view = render(<StrictMode><BuildingPlanTracer {...props} initialProject={{ draft: restoredDraft(), reference: prepared() }} /></StrictMode>);
  const href = screen.getByRole('group', { name: '圖片描圖區' }).querySelector('image')?.getAttribute('href');
  expect(href).toMatch(/^blob:trace-/);
  expect(vi.mocked(URL.revokeObjectURL).mock.calls.flat()).not.toContain(href);
  view.unmount();
  expect(vi.mocked(URL.revokeObjectURL).mock.calls.flat().filter(value => value === href)).toHaveLength(1);
});

it('clears old scale calibration when redrawing the outline', () => {
  const draft = restoredDraft();
  draft.mode = null; draft.points = []; draft.roomName = '';
  render(<BuildingPlanTracer {...props} initialProject={{ draft, reference: prepared() }} />);
  fireEvent.click(screen.getByRole('button', { name: '重畫外框與房間' }));
  expect(screen.queryByLabelText('兩點實際距離（公尺）')).toBeNull();
  expect(screen.getByText(/未校正比例／示意單位/)).toBeTruthy();
  outline();
  fireEvent.click(screen.getByRole('button', { name: '建立立體預覽' }));
  expect(props.onComplete.mock.calls[0][0]).toMatchObject({ units: 'relative', floors: [{ height: 3, rooms: [] }] });
});
