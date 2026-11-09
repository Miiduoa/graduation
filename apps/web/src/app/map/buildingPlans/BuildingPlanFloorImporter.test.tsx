import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createExampleBuildingPlan, MAX_BUILDING_PLAN_BYTES, type BuildingPlan } from './buildingPlan';
import BuildingPlanFloorImporter from './BuildingPlanFloorImporter';

const scope = { schoolId: 'pu', buildingId: 'library' };
function floorPlan(label = '1F'): BuildingPlan {
  const plan = createExampleBuildingPlan(scope);
  plan.floors = [plan.floors[0]];
  plan.floors[0].label = label;
  plan.source = { label: `${label} 原圖`, url: `https://example.com/${label}` };
  return plan;
}
function file(contents: string | Promise<string>, name = 'floor.json') {
  const input = new File(['test'], name, { type: 'application/json' });
  Object.defineProperty(input, 'text', { value: vi.fn(() => Promise.resolve(contents)) });
  return input;
}
function upload(input: File) {
  fireEvent.change(screen.getByLabelText('選擇要加入的圖面'), { target: { files: [input] } });
}
function setup(plan = floorPlan()) {
  const onChange = vi.fn();
  const view = render(<BuildingPlanFloorImporter plan={plan} onChange={onChange} />);
  fireEvent.click(screen.getByText('加入樓層圖面'));
  return { onChange, view, plan };
}
async function candidate(plan = floorPlan('2F')) {
  upload(file(JSON.stringify(plan)));
  await screen.findByText('圖面已讀取，請設定樓層位置。尚未加入目前建築。');
  fireEvent.change(screen.getByLabelText('樓底標高（公尺）'), { target: { value: '4' } });
}
function preview() { fireEvent.click(screen.getByRole('button', { name: '預覽樓層位置' })); }

describe('joining completed floor files', () => {
  it('reviews explicit origin rotation and translation before changing the original model', async () => {
    const { onChange, plan } = setup();
    const before = JSON.stringify(plan);
    await candidate();
    fireEvent.change(screen.getByLabelText('水平位移（公尺）'), { target: { value: '6' } });
    fireEvent.change(screen.getByLabelText('垂直位移（公尺）'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('圖面旋轉'), { target: { value: '90' } });
    preview();
    expect(onChange).not.toHaveBeenCalled();
    expect(JSON.stringify(plan)).toBe(before);
    expect(screen.getByText('待加入樓層：2F').parentElement?.getAttribute('points')).toBe('6,2 6,24 -8,24 -8,2');
    expect(document.activeElement).toBe(screen.getByLabelText('待加入樓層確認'));
    fireEvent.click(screen.getByRole('button', { name: '加入這個樓層' }));
    expect(onChange).toHaveBeenCalledTimes(1);
    const [joined, id] = onChange.mock.calls[0] as [BuildingPlan, string];
    expect(joined.floors).toHaveLength(2);
    expect(joined.floors.find(floor => floor.id === id)?.elevation).toBe(4);
    expect(joined.floors[0].outline).toEqual(plan.floors[0].outline);
    expect(joined.floors[1].source).toEqual(floorPlan('2F').source);
    expect(screen.queryByRole('button', { name: '加入這個樓層' })).toBeNull();
    expect(document.activeElement).toBe(screen.getByText('加入樓層圖面'));
  });

  it('computes a quarter turn from two manually matched corner pairs, without adding the floor automatically', async () => {
    const { onChange, plan } = setup();
    const upper = floorPlan('2F');
    upper.floors[0].outline = [[0, 0], [14, 0], [14, 22], [0, 22]];
    upper.floors[0].rooms = [];
    upper.floors[0].walls = [];
    const before = JSON.stringify(plan);
    await candidate(upper);
    fireEvent.click(screen.getByText('依兩組角點對位（選用）'));
    fireEvent.change(screen.getByLabelText('參考樓層對位點 B'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('來源圖面對位點 B'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: '依兩組對位點計算位置' }));
    expect((screen.getByLabelText('圖面旋轉') as HTMLSelectElement).value).toBe('90');
    expect((screen.getByLabelText('水平位移（公尺）') as HTMLInputElement).value).toBe('0');
    expect((screen.getByLabelText('垂直位移（公尺）') as HTMLInputElement).value).toBe('0');
    expect(screen.getByText(/第二對角點誤差 0.00 公尺/)).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
    expect(JSON.stringify(plan)).toBe(before);
    preview();
    expect(screen.getByText('待加入樓層：2F').parentElement?.getAttribute('points')).toBe('0,0 0,14 -22,14 -22,0');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('keeps manual offsets after rejected alignment and invalidates earlier placement approval', async () => {
    const { onChange } = setup();
    await candidate();
    fireEvent.change(screen.getByLabelText('水平位移（公尺）'), { target: { value: '6' } });
    preview();
    fireEvent.click(screen.getByText('依兩組角點對位（選用）'));
    fireEvent.change(screen.getByLabelText('來源圖面對位點 B'), { target: { value: '2' } });
    expect(screen.queryByRole('button', { name: '加入這個樓層' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '依兩組對位點計算位置' }));
    expect(screen.getByRole('alert').textContent).toContain('距離不一致');
    expect((screen.getByLabelText('水平位移（公尺）') as HTMLInputElement).value).toBe('6');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('invalidates reviewed positions when any placement field changes', async () => {
    const { onChange } = setup();
    await candidate(); preview();
    fireEvent.change(screen.getByLabelText('新增樓層名稱'), { target: { value: '研究層' } });
    expect(screen.queryByRole('button', { name: '加入這個樓層' })).toBeNull();
    expect(screen.queryByRole('img', { name: '樓層位置預覽' })).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    preview();
    fireEvent.click(screen.getByRole('button', { name: '加入這個樓層' }));
    expect(onChange.mock.calls[0][0].floors[1].label).toBe('研究層');
  });

  it('selects exactly one incoming storey and retains its own source', async () => {
    const { onChange } = setup();
    const incoming = createExampleBuildingPlan(scope);
    incoming.floors[1].source = { label: '二樓測繪', url: 'https://example.com/floor-two' };
    await candidate(incoming);
    fireEvent.change(screen.getByLabelText('加入哪一層'), { target: { value: 'example-2' } });
    expect((screen.getByLabelText('新增樓層名稱') as HTMLInputElement).value).toBe('2F');
    expect(screen.getByRole('link', { name: '二樓測繪 ↗' }).getAttribute('href')).toBe('https://example.com/floor-two');
    preview(); fireEvent.click(screen.getByRole('button', { name: '加入這個樓層' }));
    expect(onChange.mock.calls[0][0].floors).toHaveLength(2);
    expect(onChange.mock.calls[0][0].floors[1].source.label).toBe('二樓測繪');
  });

  it('requires an explicit storey elevation and rejects overlap without changing the plan', async () => {
    const { onChange } = setup();
    await candidate();
    fireEvent.change(screen.getByLabelText('樓底標高（公尺）'), { target: { value: '' } });
    preview();
    expect(screen.getByRole('alert').textContent).toContain('請填寫樓底標高');
    fireEvent.change(screen.getByLabelText('樓底標高（公尺）'), { target: { value: '2' } });
    preview();
    expect(screen.getByRole('alert').textContent).toContain('互相重疊');
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: '加入這個樓層' })).toBeNull();
  });

  it.each(['relative', 'school', 'building', 'invalid'] as const)('rejects %s input and retains the current model', async kind => {
    const { onChange, plan } = setup();
    const before = JSON.stringify(plan);
    const input = floorPlan('2F');
    if (kind === 'relative') input.units = 'relative';
    if (kind === 'school') input.schoolId = 'another-school';
    if (kind === 'building') input.buildingId = 'another-building';
    upload(file(kind === 'invalid' ? '{' : JSON.stringify(input)));
    await screen.findByRole('alert');
    expect(JSON.stringify(plan)).toBe(before);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('新增樓層名稱')).toBeNull();
  });

  it('rejects oversized files before reading their contents', () => {
    setup();
    const input = file('{}');
    Object.defineProperty(input, 'size', { value: MAX_BUILDING_PLAN_BYTES + 1 });
    upload(input);
    expect(input.text).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('256 KB');
  });

  it('keeps a reviewed candidate after a failed replacement file', async () => {
    const { onChange } = setup();
    await candidate(); preview();
    upload(file('{'));
    await screen.findByRole('alert');
    await waitFor(() => expect(screen.queryByText('正在讀取要加入的樓層…')).toBeNull());
    expect(screen.getByText('待加入樓層：2F')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '加入這個樓層' }));
    expect(onChange.mock.calls[0][0].floors[1].label).toBe('2F');
  });

  it('ignores a late older read after a newer candidate has been selected', async () => {
    setup();
    let resolve!: (value: string) => void;
    upload(file(new Promise<string>(done => { resolve = done; })));
    await candidate(floorPlan('新樓層'));
    await act(async () => { resolve(JSON.stringify(floorPlan('舊樓層'))); });
    expect((screen.getByLabelText('新增樓層名稱') as HTMLInputElement).value).toBe('新樓層');
  });

  it('cancels a pending file and prevents its late result from restoring a candidate', async () => {
    const { onChange } = setup();
    let resolve!: (value: string) => void;
    upload(file(new Promise<string>(done => { resolve = done; })));
    fireEvent.click(screen.getByRole('button', { name: '取消加入樓層' }));
    expect(document.activeElement).toBe(screen.getByLabelText('選擇要加入的圖面'));
    await act(async () => { resolve(JSON.stringify(floorPlan('晚到樓層'))); });
    expect(screen.queryByLabelText('新增樓層名稱')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('clears pending state when a newer file is rejected before reading', async () => {
    setup();
    let resolve!: (value: string) => void;
    upload(file(new Promise<string>(done => { resolve = done; })));
    upload(file('{}', 'not-a-plan.png'));
    expect(screen.queryByText('正在讀取要加入的樓層…')).toBeNull();
    await act(async () => { resolve(JSON.stringify(floorPlan('晚到樓層'))); });
    expect(screen.queryByLabelText('新增樓層名稱')).toBeNull();
  });

  it('never applies a reviewed candidate to a replacement model', async () => {
    const { view, onChange } = setup();
    await candidate(); preview();
    view.rerender(<BuildingPlanFloorImporter plan={floorPlan('新的原圖')} onChange={onChange} />);
    expect(screen.queryByRole('button', { name: '加入這個樓層' })).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('blocks applying a reviewed candidate while its parent is busy', async () => {
    const { view, onChange, plan } = setup();
    await candidate(); preview();
    view.rerender(<BuildingPlanFloorImporter plan={plan} disabled onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: '加入這個樓層' }));
    expect(onChange).not.toHaveBeenCalled();
    view.rerender(<BuildingPlanFloorImporter plan={plan} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: '加入這個樓層' }));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it.each(['relative', 'full'] as const)('does not offer composition for a %s base', kind => {
    const plan = floorPlan();
    if (kind === 'relative') plan.units = 'relative';
    else plan.floors = Array.from({ length: 12 }, (_, i) => ({ ...plan.floors[0], id: `f-${i}`, elevation: i * 4, rooms: [] }));
    const { onChange } = setup(plan);
    const input = file('{}');
    fireEvent.change(screen.getByLabelText('選擇要加入的圖面'), { target: { files: [input] } });
    expect(input.text).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });
});
