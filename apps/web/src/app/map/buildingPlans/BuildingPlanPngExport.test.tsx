import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import BuildingPlanPngExport from './BuildingPlanPngExport';
import { createExampleBuildingPlan } from './buildingPlan';
import { exportBuildingPlanPng } from './buildingPlanPng';

vi.mock('./buildingPlanPng', async importOriginal => ({
  ...await importOriginal<typeof import('./buildingPlanPng')>(),
  exportBuildingPlanPng: vi.fn(),
}));
const convert = vi.mocked(exportBuildingPlanPng);
const plan = createExampleBuildingPlan({ schoolId: 'pu', buildingId: 'test-building' });
const png = { blob: new Blob(['mock PNG bytes'], { type: 'image/png' }), width: 1920, height: 1676 };
let filenames: string[];
function deferred() {
  let resolve!: (value: typeof png) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<typeof png>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
beforeEach(() => {
  vi.useFakeTimers();
  convert.mockReset();
  filenames = [];
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:png-download');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    filenames.push(this.download);
  });
});
afterEach(() => { vi.runOnlyPendingTimers(); vi.useRealTimers(); vi.restoreAllMocks(); });

it('shows real pixel dimensions, prevents duplicate work, and only announces a completed handoff', async () => {
  const pending = deferred();
  convert.mockReturnValue(pending.promise);
  render(<BuildingPlanPngExport plan={plan} floorId={null} />);
  expect(screen.getByText('全部樓層 · 1920 × 1676 px')).toBeTruthy();
  const button = screen.getByRole('button', { name: '下載平面圖 PNG' });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(convert).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('status').textContent).toContain('正在產生');
  expect(filenames).toEqual([]);
  expect(screen.getByRole('combobox', { name: 'PNG 畫質' }).hasAttribute('disabled')).toBe(true);
  await act(async () => pending.resolve(png));
  expect(filenames).toEqual(['平面圖-兩層教學空間・示意-全部樓層.png']);
  expect(URL.createObjectURL).toHaveBeenCalledWith(png.blob);
  expect(screen.getByRole('status').textContent).toContain('已交給瀏覽器下載');
  expect(document.querySelector('a[download]')).toBeNull();
  expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(1000));
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:png-download');
});

it('uses the selected floor, quality and safe Unicode filename', async () => {
  const named = { ...plan, name: '教學/館?', floors: plan.floors.map(floor => ({ ...floor, label: '二樓:研究區' })) };
  convert.mockResolvedValue({ ...png, width: 960, height: 488 });
  render(<BuildingPlanPngExport plan={named} floorId="example-2" />);
  fireEvent.change(screen.getByRole('combobox', { name: 'PNG 畫質' }), { target: { value: '1' } });
  expect(screen.getByText('二樓:研究區 · 960 × 488 px')).toBeTruthy();
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '下載平面圖 PNG' })));
  expect(convert).toHaveBeenCalledWith(named, 'example-2', 1, expect.any(AbortSignal));
  expect(filenames).toEqual(['平面圖-教學 館-單層-二樓 研究區.png']);
});

it('shows a conversion failure and allows a successful retry without losing the plan', async () => {
  convert.mockRejectedValueOnce(new Error('mock encoder failure')).mockResolvedValueOnce(png);
  render(<BuildingPlanPngExport plan={plan} floorId={null} />);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '下載平面圖 PNG' })));
  expect(screen.getByRole('alert').textContent).toContain('請重試');
  expect(filenames).toEqual([]);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '下載平面圖 PNG' })));
  expect(screen.queryByRole('alert')).toBeNull();
  expect(filenames).toHaveLength(1);
});

it('cancels immediately and ignores a late result without disrupting a new export', async () => {
  const first = deferred(), second = deferred();
  convert.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  render(<BuildingPlanPngExport plan={plan} floorId={null} />);
  fireEvent.click(screen.getByRole('button', { name: '下載平面圖 PNG' }));
  const signal = convert.mock.calls[0][3];
  fireEvent.click(screen.getByRole('button', { name: '取消 PNG 匯出' }));
  expect(signal.aborted).toBe(true);
  expect(screen.getByRole('status').textContent).toContain('已取消');
  fireEvent.click(screen.getByRole('button', { name: '下載平面圖 PNG' }));
  await act(async () => first.resolve(png));
  expect(filenames).toEqual([]);
  expect(screen.getByRole('status').textContent).toContain('正在產生');
  await act(async () => second.resolve(png));
  expect(filenames).toHaveLength(1);
});

it.each(['floor', 'plan', 'close'] as const)('cancels stale work on %s change', async kind => {
  const pending = deferred();
  convert.mockReturnValue(pending.promise);
  const view = render(<BuildingPlanPngExport plan={plan} floorId={null} />);
  fireEvent.click(screen.getByRole('button', { name: '下載平面圖 PNG' }));
  const signal = convert.mock.calls[0][3];
  if (kind === 'close') view.unmount();
  else view.rerender(<BuildingPlanPngExport plan={kind === 'plan' ? { ...plan } : plan}
    floorId={kind === 'floor' ? 'example-1' : null} />);
  expect(signal.aborted).toBe(true);
  await act(async () => pending.resolve(png));
  expect(URL.createObjectURL).not.toHaveBeenCalled();
  expect(filenames).toEqual([]);
  expect(screen.queryByRole('status')).toBeNull();
});

it('can export again after leaving and returning to an in-flight selection', async () => {
  const old = deferred(), latest = deferred();
  convert.mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise);
  const view = render(<BuildingPlanPngExport plan={plan} floorId={null} />);
  fireEvent.click(screen.getByRole('button', { name: '下載平面圖 PNG' }));
  view.rerender(<BuildingPlanPngExport plan={plan} floorId="example-1" />);
  view.rerender(<BuildingPlanPngExport plan={plan} floorId={null} />);
  const button = screen.getByRole('button', { name: '下載平面圖 PNG' });
  expect(button.hasAttribute('disabled')).toBe(false);
  fireEvent.click(button);
  await act(async () => old.resolve(png));
  expect(filenames).toEqual([]);
  await act(async () => latest.resolve(png));
  expect(filenames).toHaveLength(1);
});
