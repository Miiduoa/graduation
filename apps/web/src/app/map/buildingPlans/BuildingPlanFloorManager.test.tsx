import { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { createExampleBuildingPlan, type BuildingPlan } from './buildingPlan';
import BuildingPlanFloorManager from './BuildingPlanFloorManager';

const scope = { schoolId: 'test-school', buildingId: 'test-building' };
function example() { return createExampleBuildingPlan(scope); }
function openManager() { fireEvent.click(screen.getByText('管理樓層')); }
function floor(label: string) { return within(screen.getByRole('group', { name: `${label} 樓層設定` })); }
function startEditing(label = '1F') { fireEvent.click(floor(label).getByRole('button', { name: '編輯樓層' })); }
function input(label: string) { return screen.getByLabelText(label) as HTMLInputElement; }
function renderManaged(plan = example()) {
  const changed = vi.fn();
  function Harness() {
    const [current, setCurrent] = useState(plan);
    return <BuildingPlanFloorManager plan={current} onChange={next => { changed(next); setCurrent(next); }} />;
  }
  const result = render(<Harness />);
  openManager();
  return { ...result, changed };
}

it('starts collapsed and shows each floor source with the plan source as a fallback', () => {
  const plan = example();
  plan.source = { label: '建築圖面總覽', url: 'https://example.edu/building' };
  plan.floors[1].source = { label: '二樓平面圖', url: 'https://example.edu/floor-two' };
  render(<BuildingPlanFloorManager plan={plan} onChange={vi.fn()} />);
  const details = screen.getByText('管理樓層').closest('details');
  expect(details?.open).toBe(false);
  expect(screen.queryByRole('textbox', { name: '樓層名稱' })).toBeNull();
  openManager();
  expect(details?.open).toBe(true);
  expect(floor('1F').getByRole('link', { name: '建築圖面總覽 ↗' }).getAttribute('href')).toBe('https://example.edu/building');
  expect(floor('2F').getByRole('link', { name: '二樓平面圖 ↗' }).getAttribute('href')).toBe('https://example.edu/floor-two');
  expect(floor('1F').getByText('樓底 0 公尺 · 樓高 3.4 公尺')).toBeTruthy();
});

it('stages name and height changes until applied, keeps room IDs, and returns focus to the updated floor', () => {
  const plan = example();
  const before = JSON.stringify(plan);
  const { changed } = renderManaged(plan);
  startEditing();
  expect(document.activeElement).toBe(input('樓層名稱'));
  fireEvent.change(input('樓層名稱'), { target: { value: '  地面層  ' } });
  fireEvent.change(input('樓高（公尺）'), { target: { value: '3.2' } });
  expect(changed).not.toHaveBeenCalled();
  expect(JSON.stringify(plan)).toBe(before);
  fireEvent.click(screen.getByRole('button', { name: '套用樓層設定' }));
  expect(changed).toHaveBeenCalledTimes(1);
  const result: BuildingPlan = changed.mock.calls[0][0];
  expect(result.floors[0].label).toBe('地面層');
  expect(result.floors[0].height).toBe(3.2);
  expect(result.floors[0].rooms).toEqual(plan.floors[0].rooms);
  expect(result.schoolId).toBe(scope.schoolId);
  expect(result.buildingId).toBe(scope.buildingId);
  expect(result.units).toBe('m');
  expect(screen.queryByRole('textbox', { name: '樓層名稱' })).toBeNull();
  expect(document.activeElement).toBe(floor('地面層').getByRole('button', { name: '編輯樓層' }));
  expect(screen.getByRole('status').textContent).toBe('地面層 的設定已套用。');
});

it('orders by the explicitly entered elevation without renumbering rooms or changing other floors', () => {
  const plan = example();
  const { changed } = renderManaged(plan);
  startEditing();
  fireEvent.change(input('樓底標高（公尺）'), { target: { value: '8' } });
  fireEvent.click(screen.getByRole('button', { name: '套用樓層設定' }));
  const result: BuildingPlan = changed.mock.calls[0][0];
  expect(result.floors.map(item => item.id)).toEqual(['example-2', 'example-1']);
  expect(result.floors[0]).toEqual(plan.floors[1]);
  expect(result.floors[1]).toEqual({ ...plan.floors[0], elevation: 8 });
  expect(screen.getAllByRole('heading', { level: 4 }).map(item => item.textContent)).toEqual(['2F', '1F']);
  expect(document.activeElement).toBe(floor('1F').getByRole('button', { name: '編輯樓層' }));
});

it.each([
  ['樓層名稱', '   ', '請填寫樓層名稱。'],
  ['樓底標高（公尺）', '', '請填寫有效的樓底標高。'],
  ['樓高（公尺）', '', '請填寫有效的樓高。'],
])('keeps the model and editing values when %s is empty', (label, value, message) => {
  const { changed } = renderManaged();
  startEditing();
  fireEvent.change(input(label), { target: { value } });
  fireEvent.click(screen.getByRole('button', { name: '套用樓層設定' }));
  expect(changed).not.toHaveBeenCalled();
  expect(input(label).value).toBe(value);
  expect(screen.getByRole('alert').textContent).toBe(message);
  expect(document.activeElement).toBe(screen.getByRole('alert'));
  expect(floor('1F').getByText('樓底 0 公尺 · 樓高 3.4 公尺')).toBeTruthy();
});

it('rejects overlapping floors without replacing the original model and lets the same draft be corrected', () => {
  const { changed } = renderManaged();
  startEditing();
  fireEvent.change(input('樓高（公尺）'), { target: { value: '4' } });
  fireEvent.click(screen.getByRole('button', { name: '套用樓層設定' }));
  expect(changed).not.toHaveBeenCalled();
  expect(screen.getByRole('alert').textContent).toMatch(/重疊/);
  expect(input('樓高（公尺）').value).toBe('4');
  fireEvent.change(input('樓高（公尺）'), { target: { value: '3' } });
  fireEvent.click(screen.getByRole('button', { name: '套用樓層設定' }));
  expect(changed).toHaveBeenCalledTimes(1);
  expect(floor('1F').getByText('樓底 0 公尺 · 樓高 3 公尺')).toBeTruthy();
});

it('cancels a staged edit without touching the model and restores focus to its edit button', () => {
  const { changed } = renderManaged();
  startEditing();
  fireEvent.change(input('樓層名稱'), { target: { value: '尚未套用的名稱' } });
  fireEvent.click(screen.getByRole('button', { name: '取消修改' }));
  expect(changed).not.toHaveBeenCalled();
  expect(screen.queryByRole('textbox', { name: '樓層名稱' })).toBeNull();
  expect(document.activeElement).toBe(floor('1F').getByRole('button', { name: '編輯樓層' }));
  startEditing();
  expect(input('樓層名稱').value).toBe('1F');
});

it('uses the existing relative units when editing and does not label them as metres', () => {
  const plan = { ...example(), units: 'relative' as const };
  const { changed } = renderManaged(plan);
  startEditing();
  expect(screen.getByText('這份圖面使用示意單位，標高與樓高僅供預覽。')).toBeTruthy();
  expect(screen.queryByLabelText('樓底標高（公尺）')).toBeNull();
  fireEvent.change(input('樓高（示意單位）'), { target: { value: '2.5' } });
  fireEvent.click(screen.getByRole('button', { name: '套用樓層設定' }));
  expect(changed.mock.calls[0][0].units).toBe('relative');
  expect(floor('1F').getByText('樓底 0 示意單位 · 樓高 2.5 示意單位')).toBeTruthy();
});

it('requires a second explicit action to remove a floor, and cancellation preserves it', () => {
  const { changed } = renderManaged();
  fireEvent.click(floor('1F').getByRole('button', { name: '移除樓層' }));
  expect(changed).not.toHaveBeenCalled();
  expect(screen.getByText('移除「1F」及其中 3 個房間？')).toBeTruthy();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: '確認移除' }));
  fireEvent.click(screen.getByRole('button', { name: '保留樓層' }));
  expect(screen.queryByRole('button', { name: '確認移除' })).toBeNull();
  expect(changed).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(floor('1F').getByRole('button', { name: '移除樓層' }));
});

it('removes only the confirmed floor and moves keyboard focus to a remaining floor', () => {
  const plan = example();
  const { changed } = renderManaged(plan);
  fireEvent.click(floor('1F').getByRole('button', { name: '移除樓層' }));
  fireEvent.click(screen.getByRole('button', { name: '確認移除' }));
  expect(changed).toHaveBeenCalledTimes(1);
  expect(changed.mock.calls[0][0].floors).toEqual([plan.floors[1]]);
  expect(screen.queryByRole('group', { name: '1F 樓層設定' })).toBeNull();
  expect(document.activeElement).toBe(floor('2F').getByRole('button', { name: '編輯樓層' }));
  expect(screen.getByRole('status').textContent).toBe('已移除 1F。');
  const lastRemove = floor('2F').getByRole('button', { name: '移除樓層' });
  expect(lastRemove.getAttribute('aria-disabled')).toBe('true');
  lastRemove.focus();
  fireEvent.click(lastRemove);
  expect(changed).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('button', { name: '確認移除' })).toBeNull();
  expect(document.activeElement).toBe(lastRemove);
});

it('blocks an already open edit while disabled, including direct form submission', () => {
  const plan = example();
  const changed = vi.fn();
  const view = render(<BuildingPlanFloorManager plan={plan} onChange={changed} />);
  openManager();
  startEditing();
  fireEvent.change(input('樓層名稱'), { target: { value: '保留中的修改' } });
  view.rerender(<BuildingPlanFloorManager plan={plan} onChange={changed} disabled />);
  fireEvent.change(input('樓層名稱'), { target: { value: '停用時不可修改' } });
  expect(input('樓層名稱').value).toBe('保留中的修改');
  fireEvent.submit(input('樓層名稱').closest('form')!);
  expect(changed).not.toHaveBeenCalled();
  view.rerender(<BuildingPlanFloorManager plan={plan} onChange={changed} />);
  fireEvent.submit(input('樓層名稱').closest('form')!);
  expect(changed).toHaveBeenCalledTimes(1);
  expect(changed.mock.calls[0][0].floors[0].label).toBe('保留中的修改');
});

it('blocks a pending removal while disabled and preserves the confirmation for later', () => {
  const plan = example();
  const changed = vi.fn();
  const view = render(<BuildingPlanFloorManager plan={plan} onChange={changed} />);
  openManager();
  fireEvent.click(floor('1F').getByRole('button', { name: '移除樓層' }));
  view.rerender(<BuildingPlanFloorManager plan={plan} onChange={changed} disabled />);
  fireEvent.click(screen.getByRole('button', { name: '確認移除' }));
  expect(changed).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: '確認移除' })).toBeTruthy();
  view.rerender(<BuildingPlanFloorManager plan={plan} onChange={changed} />);
  fireEvent.click(screen.getByRole('button', { name: '確認移除' }));
  expect(changed).toHaveBeenCalledTimes(1);
});

it('discards a stale editing draft when a new model has the same floor IDs', () => {
  const plan = example();
  const changed = vi.fn();
  const view = render(<BuildingPlanFloorManager plan={plan} onChange={changed} />);
  openManager();
  startEditing();
  fireEvent.change(input('樓層名稱'), { target: { value: '舊圖面的未完成修改' } });
  const replacement = example();
  replacement.floors[0].label = '新的地面層';
  replacement.floors[0].height = 2.8;
  view.rerender(<BuildingPlanFloorManager plan={replacement} onChange={changed} />);
  expect(screen.queryByRole('textbox', { name: '樓層名稱' })).toBeNull();
  expect(changed).not.toHaveBeenCalled();
  startEditing('新的地面層');
  expect(input('樓層名稱').value).toBe('新的地面層');
  expect(input('樓高（公尺）').value).toBe('2.8');
});

it('drops a removal confirmation if an external replacement leaves a single floor', () => {
  const plan = example();
  const changed = vi.fn();
  const view = render(<BuildingPlanFloorManager plan={plan} onChange={changed} />);
  openManager();
  fireEvent.click(floor('1F').getByRole('button', { name: '移除樓層' }));
  const replacement = { ...example(), floors: [example().floors[0]] };
  view.rerender(<BuildingPlanFloorManager plan={replacement} onChange={changed} />);
  expect(screen.queryByRole('button', { name: '確認移除' })).toBeNull();
  fireEvent.click(floor('1F').getByRole('button', { name: '移除樓層' }));
  expect(changed).not.toHaveBeenCalled();
});

it('does not steal focus from controls outside the manager on an external model replacement', () => {
  const plan = example();
  const changed = vi.fn();
  const content = (drawing: BuildingPlan) => <><input aria-label="其他圖面入口" /><BuildingPlanFloorManager plan={drawing} onChange={changed} /></>;
  const view = render(content(plan));
  openManager();
  startEditing();
  const outside = input('其他圖面入口');
  outside.focus();
  view.rerender(content(example()));
  expect(document.activeElement).toBe(outside);
  expect(changed).not.toHaveBeenCalled();
});

it('reports active edits and removal confirmations until they succeed or are cancelled', () => {
  const plan = example();
  const changed = vi.fn();
  const editingChanged = vi.fn();
  render(<BuildingPlanFloorManager plan={plan} onChange={changed} onEditingChange={editingChanged} />);
  openManager();
  startEditing();
  expect(editingChanged.mock.calls).toEqual([[true]]);
  fireEvent.change(input('樓層名稱'), { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: '套用樓層設定' }));
  expect(editingChanged.mock.calls).toEqual([[true]]);
  expect(changed).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '取消修改' }));
  expect(editingChanged.mock.calls).toEqual([[true], [false]]);
  fireEvent.click(floor('1F').getByRole('button', { name: '移除樓層' }));
  expect(editingChanged.mock.calls).toEqual([[true], [false], [true]]);
  fireEvent.click(screen.getByRole('button', { name: '保留樓層' }));
  expect(editingChanged.mock.calls).toEqual([[true], [false], [true], [false]]);
  startEditing();
  fireEvent.change(input('樓層名稱'), { target: { value: '地面層' } });
  fireEvent.click(screen.getByRole('button', { name: '套用樓層設定' }));
  expect(editingChanged.mock.calls.slice(-2)).toEqual([[true], [false]]);
  expect(changed).toHaveBeenCalledTimes(1);
  fireEvent.click(floor('1F').getByRole('button', { name: '移除樓層' }));
  fireEvent.click(screen.getByRole('button', { name: '確認移除' }));
  expect(editingChanged.mock.calls.slice(-2)).toEqual([[true], [false]]);
  expect(changed).toHaveBeenCalledTimes(2);
});

it('keeps editing active while disabled and releases the latest listener on external replacement or unmount', () => {
  const plan = example();
  const changed = vi.fn();
  const originalListener = vi.fn();
  const latestListener = vi.fn();
  const view = render(<BuildingPlanFloorManager plan={plan} onChange={changed} onEditingChange={originalListener} />);
  openManager();
  startEditing();
  expect(originalListener.mock.calls).toEqual([[true]]);
  view.rerender(<BuildingPlanFloorManager plan={plan} onChange={changed} onEditingChange={latestListener} disabled />);
  expect(latestListener).not.toHaveBeenCalled();
  expect(input('樓層名稱').value).toBe('1F');
  fireEvent.submit(input('樓層名稱').closest('form')!);
  expect(changed).not.toHaveBeenCalled();
  expect(latestListener).not.toHaveBeenCalled();
  const replacement = example();
  view.rerender(<BuildingPlanFloorManager plan={replacement} onChange={changed} onEditingChange={latestListener} />);
  expect(latestListener.mock.calls).toEqual([[false]]);
  expect(originalListener.mock.calls).toEqual([[true]]);
  expect(screen.queryByRole('textbox', { name: '樓層名稱' })).toBeNull();
  fireEvent.click(floor('1F').getByRole('button', { name: '移除樓層' }));
  expect(latestListener.mock.calls).toEqual([[false], [true]]);
  view.unmount();
  expect(latestListener.mock.calls).toEqual([[false], [true], [false]]);
  expect(originalListener.mock.calls).toEqual([[true]]);
});
