import { render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AssistantPlanComparison } from './AssistantPlanComparison';

const event = (title: string, overrides: Record<string, unknown> = {}) => ({
  title, date: '2030-11-10', allDay: false, startTime: '19:00', endTime: '19:30', ...overrides,
});
const region = () => screen.getByRole('region', { name: '這次提議改了什麼' });
afterEach(() => vi.unstubAllGlobals());

it('shows only changed fields with exact dated cross-day values and counts unchanged events', () => {
  const unchanged = event('未變更的英文複習');
  const night = event('跨日讀書', { startTime: '23:30', endTime: '00:30', endDate: '2030-11-11' });
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  render(<AssistantPlanComparison before={[unchanged, night]}
    after={[unchanged, { ...night, endTime: '01:30' }]} />);
  const summary = within(region());
  expect(summary.getByRole('heading', { name: '這次提議改了什麼' })).toBeTruthy();
  expect(summary.getByText('內容未變更：1 項。')).toBeTruthy();
  expect(summary.queryByText('未變更的英文複習')).toBeNull();
  const changes = summary.getByRole('list', { name: '內容變更的提議' });
  const row = within(changes).getByRole('listitem', { name: '跨日讀書' });
  expect(within(row).getAllByRole('term').map(term => term.textContent)).toEqual(['結束時間']);
  expect(within(row).getByText('依兩份提議中唯一相同的名稱對照。')).toBeTruthy();
  expect(row.textContent).toContain('原提議：2030-11-11 00:30（台灣時間）');
  expect(row.textContent).toContain('新提議：2030-11-11 01:30（台灣時間）');
  expect(summary.getByText(/行程是否已寫入，請查看確認卡的執行結果/)).toBeTruthy();
  expect(summary.queryByRole('button')).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
});

it('labels a reliable rename without describing unchanged dates or times as changes', () => {
  render(<AssistantPlanComparison before={[event('小組討論')]} after={[event('專題討論')]} />);
  const row = within(region()).getByRole('listitem', { name: '專題討論' });
  expect(within(row).getAllByRole('term').map(term => term.textContent)).toEqual(['名稱']);
  expect(within(row).getByText('依兩份提議中唯一相同的日期與時段對照。')).toBeTruthy();
  expect(row.textContent).toContain('原提議：小組討論');
  expect(row.textContent).toContain('新提議：專題討論');
});

it('reports reordered proposals as unchanged content without listing those events again', () => {
  const first = event('英文閱讀'), second = event('程式練習', { startTime: '20:00', endTime: '20:30' });
  render(<AssistantPlanComparison before={[first, second]} after={[second, first]} />);
  expect(within(region()).getByText('兩份提議的安排內容相同。')).toBeTruthy();
  expect(within(region()).getByText('內容未變更：2 項。')).toBeTruthy();
  expect(within(region()).getByText(/顯示順序與原提議不同/)).toBeTruthy();
  expect(within(region()).queryByRole('list')).toBeNull();
  expect(region().textContent).not.toContain('英文閱讀');
  expect(region().textContent).not.toContain('程式練習');
});

it('distinguishes added and omitted proposals from calendar execution or deletion', () => {
  const first = event('原有安排'), added = event('新增討論', { startTime: '21:00', endTime: '21:30' });
  const view = render(<AssistantPlanComparison before={[first]} after={[first, added]} />);
  const additions = within(region()).getByRole('list', { name: '新提議新增' });
  expect(within(additions).getAllByRole('listitem')).toHaveLength(1);
  expect(additions.textContent).toContain('新增討論');
  expect(additions.textContent).toContain('2030-11-10 21:00 – 2030-11-10 21:30（台灣時間）');
  expect(within(region()).queryByRole('list', { name: '新提議不再列入' })).toBeNull();
  view.rerender(<AssistantPlanComparison before={[first, added]} after={[first]} />);
  const removed = within(region()).getByRole('list', { name: '新提議不再列入' });
  expect(removed.textContent).toContain('新增討論');
  expect(within(region()).getByText(/不代表刪除既有行程/)).toBeTruthy();
  expect(region().textContent).not.toMatch(/已刪除|已修改行事曆|尚未寫入/);
});

it('keeps same-name ambiguous items in separate original and revised lists without guessing a field change', () => {
  const first = event('複習'), second = event('複習', { startTime: '20:00', endTime: '20:30' });
  render(<AssistantPlanComparison before={[first, second]}
    after={[first, event('複習', { startTime: '21:00', endTime: '21:30' })]} />);
  const summary = within(region());
  expect(summary.getByRole('heading', { name: '無法可靠逐筆對照' })).toBeTruthy();
  expect(summary.getByText('內容未變更：1 項。')).toBeTruthy();
  expect(summary.queryByRole('list', { name: '內容變更的提議' })).toBeNull();
  const original = summary.getByRole('list', { name: '原提議行程' });
  const revised = summary.getByRole('list', { name: '新提議行程' });
  expect(within(original).getAllByRole('listitem')).toHaveLength(1);
  expect(within(revised).getAllByRole('listitem')).toHaveLength(1);
  expect(original.textContent).toContain('2030-11-10 20:00 – 2030-11-10 20:30');
  expect(revised.textContent).toContain('2030-11-10 21:00 – 2030-11-10 21:30');
});

it('makes the exclusive end date clear for added and changed all-day proposals', () => {
  const day = { title: '全天活動', date: '2030-11-10', allDay: true, endDate: '2030-11-12' };
  const view = render(<AssistantPlanComparison before={[]} after={[day]} />);
  expect(within(region()).getByText('2030-11-10 起 · 全天（至 2030-11-12，不含結束日）')).toBeTruthy();
  view.rerender(<AssistantPlanComparison before={[day]} after={[{ ...day, endDate: '2030-11-13' }]} />);
  const row = within(region()).getByRole('listitem', { name: '全天活動' });
  expect(within(row).getAllByRole('term').map(term => term.textContent)).toEqual(['結束日期']);
  expect(row.textContent).toContain('原提議：2030-11-12（不含結束日）');
  expect(row.textContent).toContain('新提議：2030-11-13（不含結束日）');
});

it('does not invent changes for equivalent explicit end dates and handles known empty lists', () => {
  const timed = event('讀書'), day = { title: '全天活動', date: '2030-11-10', allDay: true };
  const view = render(<AssistantPlanComparison before={[timed, day]}
    after={[{ ...timed, endDate: '2030-11-10' }, { ...day, endDate: '2030-11-11' }]} />);
  expect(within(region()).getByText('內容未變更：2 項。')).toBeTruthy();
  expect(within(region()).queryByRole('list')).toBeNull();
  view.rerender(<AssistantPlanComparison before={[]} after={[]} />);
  expect(within(region()).getByText('沒有行程可比較。')).toBeTruthy();
  expect(within(region()).queryByText('兩份提議的安排內容相同。')).toBeNull();
});

it.each([undefined, null, {}, [event('日期錯誤', { date: '2030-02-30' })], [{ title: '缺少時間' }]])(
  'shows an unavailable comparison for invalid or missing data without claiming unchanged content: %j', invalid => {
    render(<AssistantPlanComparison before={invalid} after={[event('新提議')]} />);
    expect(within(region()).getByText('目前無法比較這兩份提議，請查看各自的確認卡。')).toBeTruthy();
    expect(region().textContent).not.toContain('內容未變更');
    expect(within(region()).queryByRole('list')).toBeNull();
  },
);
