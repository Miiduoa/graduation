import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { PlanProtectionEvent } from '@/lib/assistantPlanProtection';
import { AssistantPlanShift, AssistantPlanShiftComparison } from './AssistantPlanShift';
import type { V2ActionStates, V2Card, V2Turn } from './types';

function card(id = 'first', patch: Record<string, unknown> = {}): V2Card {
  return { tool: 'propose_personal_event', mutationId: id, token: 'PRIVATE_TOKEN_' + id, schoolId: 'pu',
    destination: 'PRIVATE_DESTINATION', args: { title: '英文複習', date: '2030-11-04', allDay: false,
      startTime: '20:00', endTime: '21:00', ...patch } };
}
const turn = (cards = [card(), card('second', { startTime: '21:15', endTime: '22:00' }),
  card('third', { title: '閱讀', startTime: '22:30', endTime: '23:00' })]): V2Turn =>
  ({ question: 'PRIVATE_QUESTION', reply: { answer: '請核對', steps: [], cards } });
const base = { states: {}, pending: false, enabled: true, protectedIndices: [] };
function open() { fireEvent.click(screen.getByRole('button', { name: '整組調整時間' })); }
function checkbox(ordinal: number) { return screen.getByRole('checkbox', { name: new RegExp('^平移 第 ' + ordinal + ' 項') }) as HTMLInputElement; }
function minutes() { return screen.getByLabelText('調整分鐘數') as HTMLInputElement; }
function setMinutes(value: string) { fireEvent.change(minutes(), { target: { value } }); }
function direction(value: 'later' | 'earlier') { fireEvent.change(screen.getByLabelText('調整方向'), { target: { value } }); }
function submit() { fireEvent.submit(screen.getByRole('form', { name: '整組調整待確認時間' })); }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
afterEach(() => { vi.restoreAllMocks(); });

it('defaults to unlocked timed items and 30 minutes later with native labels, focus and clear exclusions', () => {
  const allDay = card('all-day'); allDay.args = { title: '全天閱讀', date: '2030-11-05', allDay: true };
  const onPreview = vi.fn();
  render(<AssistantPlanShift {...base} turn={turn([card(), card('locked'), allDay])} protectedIndices={[1]} onPreview={onPreview} />);
  open();
  expect(document.activeElement).toBe(screen.getByLabelText('調整方向'));
  expect((screen.getByLabelText('調整方向') as HTMLSelectElement).value).toBe('later');
  expect(minutes().type).toBe('number'); expect(minutes().value).toBe('30');
  expect(minutes().min).toBe('1'); expect(minutes().max).toBe('1440'); expect(minutes().step).toBe('1');
  expect(checkbox(1).checked).toBe(true);
  expect(checkbox(2).checked).toBe(false); expect(checkbox(2).disabled).toBe(true);
  expect(checkbox(3).checked).toBe(false); expect(checkbox(3).disabled).toBe(true);
  expect(screen.getByText('保留原樣，本次不平移。')).toBeTruthy();
  expect(screen.getByText('全天項目不能平移時間。')).toBeTruthy();
  expect(screen.getByText(/未選項目固定不動/)).toBeTruthy();
  expect(screen.getByText(/不會送給模型/).textContent).toContain('逐張手動確認');
  expect(document.body.textContent).not.toContain('PRIVATE_');
  expect(onPreview).not.toHaveBeenCalled();
});

it('previews the complete three-item translation without changing source fields or requiring individual time entry', async () => {
  const original = turn(), snapshot = JSON.stringify(original);
  const onPreview = vi.fn(async () => ({ ok: true, message: '整組時間的新卡已備妥。' }));
  render(<AssistantPlanShift {...base} turn={original} onPreview={onPreview} />);
  open(); fireEvent.click(screen.getByRole('button', { name: '預覽整組時間' }));
  await screen.findByText('整組時間的新卡已備妥。');
  expect(onPreview).toHaveBeenCalledExactlyOnceWith({ mutationIds: ['first', 'second', 'third'], offsetMinutes: 30 });
  expect(JSON.stringify(original)).toBe(snapshot);
  expect(screen.queryByRole('form')).toBeNull();
  expect(screen.queryByRole('button', { name: '整組調整時間' })).toBeNull();
});

it('keeps subset, direction and minutes on collapse and supports the labeled form submission path', async () => {
  const onPreview = vi.fn(async () => ({ ok: false, message: '先核對這份平移。' }));
  render(<AssistantPlanShift {...base} turn={turn()} onPreview={onPreview} />);
  open(); fireEvent.click(checkbox(2)); direction('earlier'); setMinutes('45');
  fireEvent.click(screen.getByRole('button', { name: '收起整組調整' }));
  expect(document.activeElement).toBe(screen.getByRole('button', { name: '整組調整時間' }));
  expect(onPreview).not.toHaveBeenCalled();
  open(); expect(document.activeElement).toBe(screen.getByLabelText('調整方向'));
  expect(checkbox(2).checked).toBe(false); expect(minutes().value).toBe('45');
  expect((screen.getByLabelText('調整方向') as HTMLSelectElement).value).toBe('earlier');
  const submitButton = screen.getByRole('button', { name: '預覽整組時間' }) as HTMLButtonElement;
  submitButton.focus(); expect(document.activeElement).toBe(submitButton); expect(submitButton.type).toBe('submit');
  submit(); await screen.findByText('先核對這份平移。');
  expect(onPreview).toHaveBeenCalledExactlyOnceWith({ mutationIds: ['first', 'third'], offsetMinutes: -45 });
});

it('removes newly locked choices, releases only through the owner, and requires a new manual selection after unlocking', async () => {
  const original = turn(), onReleaseProtection = vi.fn();
  const onPreview = vi.fn(async () => ({ ok: false, message: '範圍已收到。' }));
  const view = render(<AssistantPlanShift {...base} turn={original} onReleaseProtection={onReleaseProtection} onPreview={onPreview} />);
  open(); setMinutes('45');
  view.rerender(<AssistantPlanShift {...base} turn={original} protectedIndices={[0]} onReleaseProtection={onReleaseProtection} onPreview={onPreview} />);
  expect(checkbox(1).checked).toBe(false); expect(checkbox(1).disabled).toBe(true);
  expect(checkbox(2).checked).toBe(true); expect(minutes().value).toBe('45');
  const firstRelease = screen.getByRole('button', { name: '解除第 1 項的保留' });
  firstRelease.focus(); fireEvent.click(firstRelease);
  expect(onReleaseProtection).toHaveBeenCalledExactlyOnceWith(0);
  expect(onPreview).not.toHaveBeenCalled();
  expect(checkbox(1).disabled).toBe(true);
  view.rerender(<AssistantPlanShift {...base} turn={original} onReleaseProtection={onReleaseProtection} onPreview={onPreview} />);
  expect(checkbox(1).disabled).toBe(false); expect(checkbox(1).checked).toBe(false);
  expect(document.activeElement).toBe(checkbox(1));
  fireEvent.click(checkbox(1)); submit(); await screen.findByText('範圍已收到。');
  expect(onPreview).toHaveBeenCalledExactlyOnceWith({ mutationIds: ['first', 'second', 'third'], offsetMinutes: 45 });
  view.rerender(<AssistantPlanShift {...base} turn={original} protectedIndices={[0]} pending onReleaseProtection={onReleaseProtection} onPreview={onPreview} />);
  const release = screen.getByRole('button', { name: '解除第 1 項的保留' }) as HTMLButtonElement;
  expect(release.disabled).toBe(true); fireEvent.click(release);
  expect(onReleaseProtection).toHaveBeenCalledTimes(1);
});

it('keeps invalid minute input for correction and does not dispatch any part of a candidate', async () => {
  const onPreview = vi.fn(async () => ({ ok: false, message: '已收到修正後的分鐘。' }));
  render(<AssistantPlanShift {...base} turn={turn()} onPreview={onPreview} />);
  open();
  for (const value of ['', '0', '-1', '1.5', '1441']) {
    setMinutes(value); submit();
    expect(screen.getByRole('alert').textContent).toContain('1 到 1440');
    expect(minutes().value).toBe(value);
    expect(document.activeElement).toBe(minutes());
    expect(onPreview).not.toHaveBeenCalled();
  }
  setMinutes('1440'); submit(); await screen.findByText('已收到修正後的分鐘。');
  expect(onPreview).toHaveBeenCalledExactlyOnceWith({ mutationIds: ['first', 'second', 'third'], offsetMinutes: 1440 });
});

it('validates the entire candidate including an unselected invalid-duration row before dispatch', () => {
  const onPreview = vi.fn();
  render(<AssistantPlanShift {...base} turn={turn([card(), card('long', { endDate: '2030-12-06' })])} onPreview={onPreview} />);
  open(); fireEvent.click(checkbox(2)); submit();
  expect(screen.getByRole('alert')).toBeTruthy();
  expect(checkbox(1).checked).toBe(true); expect(checkbox(2).checked).toBe(false);
  expect(onPreview).not.toHaveBeenCalled();
});

it('does not dispatch an empty selection or an all-locked/all-day plan', () => {
  const onPreview = vi.fn(), original = turn([card()]);
  const view = render(<AssistantPlanShift {...base} turn={original} onPreview={onPreview} />);
  open(); fireEvent.click(checkbox(1)); submit();
  expect((screen.getByRole('button', { name: '預覽整組時間' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByRole('alert')).toBeTruthy(); expect(onPreview).not.toHaveBeenCalled();
  view.rerender(<AssistantPlanShift {...base} turn={original} protectedIndices={[0]} onPreview={onPreview} />);
  expect(checkbox(1).checked).toBe(false); submit(); expect(onPreview).not.toHaveBeenCalled();
  const allDay = card(); allDay.args = { title: '全天', date: '2030-11-04', allDay: true };
  view.rerender(<AssistantPlanShift {...base} turn={turn([allDay])} onPreview={onPreview} />);
  open(); expect(checkbox(1).disabled).toBe(true); submit(); expect(onPreview).not.toHaveBeenCalled();
});

it('guards repeated submissions, freezes pending controls, and retains its own inputs across partial/full cancellation retries', async () => {
  const pending = deferred<{ ok: boolean; message: string }>(), original = turn([card(), card('second')]);
  const onPreview = vi.fn().mockReturnValueOnce(pending.promise)
    .mockRejectedValueOnce(new Error('暫時無法取得新卡。')).mockResolvedValueOnce({ ok: true, message: '新卡已備妥。' });
  const view = render(<AssistantPlanShift {...base} turn={original} onPreview={onPreview} />);
  open(); direction('earlier'); setMinutes('15'); submit(); submit();
  expect(onPreview).toHaveBeenCalledTimes(1);
  expect(minutes().disabled).toBe(true); expect((screen.getByLabelText('調整方向') as HTMLSelectElement).disabled).toBe(true);
  expect(screen.getAllByRole('checkbox').every(item => (item as HTMLInputElement).disabled)).toBe(true);
  expect((screen.getByRole('button', { name: '收起整組調整' }) as HTMLButtonElement).disabled).toBe(true);
  await act(async () => { pending.resolve({ ok: false, message: '第一項撤銷待核對。' }); });
  view.rerender(<AssistantPlanShift {...base} turn={original} states={{ first: { status: 'cancelled' } }} onPreview={onPreview} />);
  submit(); await screen.findByText('暫時無法取得新卡。');
  view.rerender(<AssistantPlanShift {...base} turn={original} states={{ first: { status: 'cancelled' }, second: { status: 'cancelled' } }} onPreview={onPreview} />);
  expect(minutes().value).toBe('15'); submit(); await screen.findByText('新卡已備妥。');
  expect(onPreview.mock.calls).toEqual(Array.from({ length: 3 }, () => [{ mutationIds: ['first', 'second'], offsetMinutes: -15 }]));
});

it('blocks unknown/reconciling states, owner unavailability and already-attempted sources including protection release', () => {
  const original = turn(), onPreview = vi.fn(), onReleaseProtection = vi.fn();
  const view = render(<AssistantPlanShift {...base} turn={original} protectedIndices={[0]} onPreview={onPreview} onReleaseProtection={onReleaseProtection} />);
  open();
  for (const status of ['unknown', 'executing', 'checking', 'conflict', 'absent', 'blocked'] as const) {
    const state = status === 'absent' ? { status, retryable: true, message: '待核對' } : { status, message: '待核對' };
    view.rerender(<AssistantPlanShift {...base} turn={original} protectedIndices={[0]} states={{ other: state } as V2ActionStates} onPreview={onPreview} onReleaseProtection={onReleaseProtection} />);
    expect(screen.getByText(/請先使用原確認卡的核對流程/)).toBeTruthy(); submit();
    const release = screen.getByRole('button', { name: '解除第 1 項的保留' }) as HTMLButtonElement;
    expect(release.disabled).toBe(true); fireEvent.click(release);
  }
  view.rerender(<AssistantPlanShift {...base} turn={original} enabled={false} onPreview={onPreview} />); submit();
  view.rerender(<AssistantPlanShift {...base} turn={original} states={{ first: { status: 'superseded' } }} onPreview={onPreview} />); submit();
  expect(onPreview).not.toHaveBeenCalled(); expect(onReleaseProtection).not.toHaveBeenCalled();
  view.unmount();
  render(<AssistantPlanShift {...base} turn={original} states={{ first: { status: 'cancelled' } }} onPreview={onPreview} />);
  expect(screen.queryByRole('button', { name: '整組調整時間' })).toBeNull();
});

it('drops late replies after a source change or unmount and does not retarget old selections', async () => {
  const first = deferred<{ ok: boolean; message: string }>(), second = deferred<{ ok: boolean; message: string }>();
  const onPreview = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const view = render(<AssistantPlanShift {...base} turn={turn()} onPreview={onPreview} />);
  open(); fireEvent.click(checkbox(2)); setMinutes('45'); submit();
  view.rerender(<AssistantPlanShift {...base} turn={turn([card('new', { title: '另一份提議' })])} onPreview={onPreview} />);
  open(); expect(minutes().value).toBe('30'); expect(checkbox(1).checked).toBe(true);
  await act(async () => { first.resolve({ ok: true, message: '不可顯示舊回應。' }); });
  expect(screen.queryByText('不可顯示舊回應。')).toBeNull();
  submit(); view.unmount();
  await act(async () => { second.resolve({ ok: false, message: '不可復活已卸載欄位。' }); });
  expect(document.body.textContent).toBe('');
});

const before: PlanProtectionEvent[] = [
  { title: '同名討論', date: '2030-11-04', allDay: false, startTime: '23:15', endTime: '23:45' },
  { title: '未移動項目不需逐欄重印', date: '2030-11-05', allDay: true },
  { title: '同名討論', date: '2030-11-05', allDay: false, startTime: '00:15', endTime: '00:45' },
];
const after: PlanProtectionEvent[] = [
  { ...before[0], endDate: '2030-11-05', startTime: '23:45', endTime: '00:15' },
  { ...before[1] },
  { ...before[2], startTime: '00:45', endTime: '01:15' },
];
it('compares the exact deterministic target indices across midnight and equal names, summarizing only unchanged items', () => {
  render(<AssistantPlanShiftComparison before={before} after={after} selectedIndices={[2, 0]} offsetMinutes={30} />);
  expect(screen.getByRole('heading', { name: '整組時間調整摘要' })).toBeTruthy();
  const items = within(screen.getByRole('list', { name: '平移項目的時間差異' })).getAllByRole('listitem');
  expect(items).toHaveLength(2);
  expect(within(items[0]).getByRole('heading', { name: '第 1 項 · 同名討論' })).toBeTruthy();
  expect(within(items[1]).getByRole('heading', { name: '第 3 項 · 同名討論' })).toBeTruthy();
  expect(items[0].textContent).toContain('2030-11-04 23:45 – 2030-11-05 00:15');
  expect(items[1].textContent).toContain('2030-11-05 00:45–01:15');
  expect(screen.getByText(/其餘 1 項內容保持原樣/)).toBeTruthy();
  expect(screen.getByText(/是否已建立，請依確認卡的結果核對/)).toBeTruthy();
  expect(document.body.textContent).not.toContain('未移動項目不需逐欄重印');
});

it('rejects comparison data that changed a title, duration, unselected row, or optional field presence', () => {
  const view = render(<AssistantPlanShiftComparison before={before} after={after} selectedIndices={[0, 2]} offsetMinutes={30} />);
  expect(screen.getByRole('heading', { name: '整組時間調整摘要' })).toBeTruthy();
  const invalidAfter = [
    after.map((event, index) => index === 0 ? { ...event, title: '名稱已更改' } : event),
    after.map((event, index) => index === 0 ? { ...event, endTime: '00:30' } : event),
    after.map((event, index) => index === 1 ? { ...event, date: '2030-11-06' } : event),
    after.map((event, index) => index === 2 ? { ...event, endDate: event.date } : event),
  ];
  for (const candidate of invalidAfter) {
    view.rerender(<AssistantPlanShiftComparison before={before} after={candidate} selectedIndices={[0, 2]} offsetMinutes={30} />);
    expect(view.container.textContent).toBe('');
  }
});
