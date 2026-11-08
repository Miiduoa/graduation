import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import BuildingPlanTracer from './BuildingPlanTracer';
import { prepareBuildingPlanReference } from './buildingPlanReference';

vi.mock('./buildingPlanReference', () => ({ prepareBuildingPlanReference: vi.fn() }));
const props = { schoolId: 'pu', buildingId: 'test-building', buildingName: '測試館', onComplete: vi.fn(), onCancel: vi.fn() };
const prepared = (name = 'floor.png') => ({ blob: new Blob(['safe pixels'], { type: 'image/png' }), width: 1000, height: 500, name });

beforeEach(() => {
  vi.restoreAllMocks();
  props.onComplete.mockReset();
  props.onCancel.mockReset();
  vi.mocked(prepareBuildingPlanReference).mockReset().mockImplementation(async file => prepared(file.name));
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

it('clears the old image and geometry on replacement and ignores late decodes', async () => {
  render(<BuildingPlanTracer {...props} />);
  await openImage();
  outline();
  let resolveOld!: (value: ReturnType<typeof prepared>) => void;
  vi.mocked(prepareBuildingPlanReference).mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
  chooseFile('slow.png');
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:trace-1');
  expect(screen.queryByRole('group', { name: '圖片描圖區' })).toBeNull();
  chooseFile('latest.png');
  const canvas = await screen.findByRole('group', { name: '圖片描圖區' });
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

it('shows a failed decode without restoring the previous drawing', async () => {
  render(<BuildingPlanTracer {...props} />);
  await openImage();
  outline();
  vi.mocked(prepareBuildingPlanReference).mockRejectedValueOnce(new Error('請選 PNG、JPEG 或 WebP 圖片。'));
  chooseFile('bad.png');
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('請選 PNG'));
  expect(screen.queryByRole('group', { name: '圖片描圖區' })).toBeNull();
  expect(screen.queryByRole('button', { name: '建立立體預覽' })).toBeNull();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:trace-1');
});
