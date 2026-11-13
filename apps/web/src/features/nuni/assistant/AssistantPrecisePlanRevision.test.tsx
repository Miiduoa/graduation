import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { PlanProtectionEvent } from '@/lib/assistantPlanProtection';
import { AssistantPrecisePlanComparison, AssistantPrecisePlanRevision, type PreciseRevisionDraftBridge } from './AssistantPrecisePlanRevision';
import type { V2ActionStates, V2Card, V2Turn } from './types';

function card(id = 'first', patch: Record<string, unknown> = {}): V2Card {
  return { tool: 'propose_personal_event', mutationId: id, token: 'PRIVATE_TOKEN_' + id, schoolId: 'pu',
    destination: 'PRIVATE_DESTINATION', args: { title: '英文複習', date: '2030-11-04', allDay: false,
      startTime: '20:00', endTime: '21:00', ...patch } };
}
const turn = (cards = [card()]): V2Turn => ({ question: 'PRIVATE_QUESTION', reply: { answer: '請確認', steps: [], cards } });
const base = { states: {}, pending: false, enabled: true };
function open() { fireEvent.click(screen.getByRole('button', { name: '精確調整時間' })); }
function input(label: string) { return screen.getByLabelText(label) as HTMLInputElement; }
function field(label: string, value: string) { fireEvent.change(input(label), { target: { value } }); }
function submit() { fireEvent.submit(screen.getByRole('form', { name: '精確調整行程時間' })); }
function edit() { field('開始時間', '21:30'); field('結束時間', '22:30'); }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
afterEach(() => { vi.restoreAllMocks(); });

it('opens native labeled time fields with exact original data and no model or preview call', () => {
  const onPreview = vi.fn();
  render(<AssistantPrecisePlanRevision {...base} turn={turn()} onPreview={onPreview} />);
  open();
  expect(document.activeElement).toBe(screen.getByLabelText('要調整的行程'));
  expect(input('開始日期').type).toBe('date');
  expect(input('結束日期').type).toBe('date');
  expect(input('開始時間').type).toBe('time');
  expect(input('結束時間').type).toBe('time');
  expect(input('開始日期').value).toBe('2030-11-04');
  expect(input('結束日期').value).toBe('2030-11-04');
  expect(input('開始時間').value).toBe('20:00');
  expect(input('結束時間').value).toBe('21:00');
  expect(screen.getByText(/台灣時間（UTC\+8）。跨日/)).toBeTruthy();
  expect(screen.getByText(/不會把內容送給模型/).textContent).toContain('逐張手動確認');
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(screen.queryByRole('checkbox')).toBeNull();
  expect(document.body.textContent).not.toContain('PRIVATE_');
  expect(onPreview).not.toHaveBeenCalled();
});

it('distinguishes equal titles by original ordinal and submits the selected ID with a cross-day range', async () => {
  const onPreview = vi.fn(async () => ({ ok: true, message: '新時間提議已備妥。' }));
  const allDay = card('all-day');
  allDay.args = { title: '全天活動', date: '2030-11-04', allDay: true };
  render(<AssistantPrecisePlanRevision {...base} turn={turn([allDay, card(), card('second', { startTime: '22:00', endTime: '23:00' })])} onPreview={onPreview} />);
  open();
  const select = screen.getByLabelText('要調整的行程');
  const options = within(select).getAllByRole('option');
  expect(options.map(option => option.textContent)).toEqual([
    '第 2 項 · 英文複習 · 2030-11-04 20:00–21:00',
    '第 3 項 · 英文複習 · 2030-11-04 22:00–23:00',
  ]);
  fireEvent.change(select, { target: { value: 'second' } });
  field('開始日期', '2030-11-07'); field('開始時間', '23:30');
  field('結束日期', '2030-11-08'); field('結束時間', '00:30');
  submit();
  await screen.findByText('新時間提議已備妥。');
  expect(onPreview).toHaveBeenCalledExactlyOnceWith({ mutationId: 'second', date: '2030-11-07', endDate: '2030-11-08', startTime: '23:30', endTime: '00:30' });
  expect(screen.queryByRole('form')).toBeNull();
  expect(screen.queryByRole('button', { name: '精確調整時間' })).toBeNull();
});

it('keeps an unchanged time range local, including an implicit same-day endDate', () => {
  const onPreview = vi.fn();
  render(<AssistantPrecisePlanRevision {...base} turn={turn()} onPreview={onPreview} />);
  open(); submit(); submit();
  expect(screen.getByRole('status').textContent).toContain('時間沒有變更，原提議保持原狀');
  expect(onPreview).not.toHaveBeenCalled();
  expect(input('結束日期').value).toBe('2030-11-04');
});

it('preserves per-target fields across target changes and collapse while returning focus', async () => {
  const onPreview = vi.fn(async () => ({ ok: false, message: '欄位已收到。' }));
  render(<AssistantPrecisePlanRevision {...base} turn={turn([card(), card('second', { startTime: '18:00', endTime: '19:00' })])} onPreview={onPreview} />);
  open(); edit();
  fireEvent.change(screen.getByLabelText('要調整的行程'), { target: { value: 'second' } });
  field('開始時間', '18:15'); field('結束時間', '19:15');
  fireEvent.click(screen.getByRole('button', { name: '收起時間調整' }));
  expect(document.activeElement).toBe(screen.getByRole('button', { name: '精確調整時間' }));
  open();
  expect((screen.getByLabelText('要調整的行程') as HTMLSelectElement).value).toBe('second');
  expect(input('開始時間').value).toBe('18:15');
  fireEvent.change(screen.getByLabelText('要調整的行程'), { target: { value: 'first' } });
  expect(input('開始時間').value).toBe('21:30');
  expect(input('結束時間').value).toBe('22:30');
  submit(); await screen.findByRole('alert');
  expect(onPreview).toHaveBeenCalledExactlyOnceWith({ mutationId: 'first', date: '2030-11-04', endDate: '2030-11-04', startTime: '21:30', endTime: '22:30' });
});

it.each([
  ['開始日期', ''], ['結束日期', '2030-11-03'], ['開始時間', '22:00'], ['結束日期', '2030-12-06'],
])('keeps invalid %s input for correction without contacting the owner', async (label, value) => {
  const onPreview = vi.fn(async () => ({ ok: false, message: '修正後的時間已收到。' }));
  render(<AssistantPrecisePlanRevision {...base} turn={turn()} onPreview={onPreview} />);
  open(); field(label, value); submit();
  expect(screen.getByRole('alert')).toBeTruthy();
  expect(input(label).value).toBe(value);
  expect(document.activeElement).toBe(input('結束時間'));
  expect(onPreview).not.toHaveBeenCalled();
  field('開始日期', '2030-11-04'); field('結束日期', '2030-11-04'); edit(); submit();
  await screen.findByText('修正後的時間已收到。');
  expect(onPreview).toHaveBeenCalledTimes(1);
});

it('guards direct double submits, freezes fields, and retries after partial then full cancellation', async () => {
  const pending = deferred<{ ok: boolean; message: string }>();
  const onPreview = vi.fn().mockReturnValueOnce(pending.promise)
    .mockResolvedValueOnce({ ok: false, message: '日期有衝突，請修改。' })
    .mockResolvedValueOnce({ ok: true, message: '新的確認卡已備妥。' });
  const original = turn([card(), card('second', { title: '程式練習' })]);
  const view = render(<AssistantPrecisePlanRevision {...base} turn={original} onPreview={onPreview} />);
  open(); edit(); submit(); submit();
  expect(onPreview).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('form').getAttribute('aria-busy')).toBe('true');
  for (const label of ['開始日期', '結束日期', '開始時間', '結束時間']) expect(input(label).disabled).toBe(true);
  expect((screen.getByLabelText('要調整的行程') as HTMLSelectElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: '收起時間調整' }) as HTMLButtonElement).disabled).toBe(true);
  await act(async () => { pending.resolve({ ok: false, message: '撤銷未完成，請核對。' }); });
  view.rerender(<AssistantPrecisePlanRevision {...base} turn={original} states={{ first: { status: 'cancelled' } }} onPreview={onPreview} />);
  expect(input('開始時間').value).toBe('21:30');
  submit(); await screen.findByText('日期有衝突，請修改。');
  view.rerender(<AssistantPrecisePlanRevision {...base} turn={original} states={{ first: { status: 'cancelled' }, second: { status: 'cancelled' } }} onPreview={onPreview} />);
  field('開始時間', '22:00'); field('結束時間', '23:00'); submit();
  await screen.findByText('新的確認卡已備妥。');
  expect(onPreview).toHaveBeenCalledTimes(3);
  expect(screen.queryByRole('form')).toBeNull();
});

it('keeps thrown failures editable and never claims a no-op revives a cancelled card', async () => {
  const onPreview = vi.fn().mockRejectedValueOnce(new Error('暫時無法預覽。'));
  const original = turn();
  const view = render(<AssistantPrecisePlanRevision {...base} turn={original} onPreview={onPreview} />);
  open(); edit(); submit(); await screen.findByText('暫時無法預覽。');
  view.rerender(<AssistantPrecisePlanRevision {...base} turn={original} states={{ first: { status: 'cancelled' } }} onPreview={onPreview} />);
  field('開始時間', '20:00'); field('結束時間', '21:00'); submit();
  expect(screen.getByRole('status').textContent).toContain('不會恢復舊確認卡');
  expect(screen.queryByText(/原提議保持原狀/)).toBeNull();
  expect(onPreview).toHaveBeenCalledTimes(1);
});

it.each(['unknown', 'executing', 'checking', 'conflict', 'absent', 'blocked'] as const)('blocks further preview on a global %s action while preserving fields', async status => {
  const original = turn();
  const onPreview = vi.fn(async () => ({ ok: false, message: '請再試。' }));
  const view = render(<AssistantPrecisePlanRevision {...base} turn={original} onPreview={onPreview} />);
  open(); edit(); submit(); await screen.findByText('請再試。');
  const state = status === 'absent' ? { status, retryable: true, message: '待核對' } : { status, message: '待核對' };
  view.rerender(<AssistantPrecisePlanRevision {...base} turn={original} states={{ unrelated: state } as V2ActionStates} onPreview={onPreview} />);
  expect(screen.getByText(/請先使用原確認卡的核對流程/)).toBeTruthy();
  expect((screen.getByRole('button', { name: '預覽時間調整' }) as HTMLButtonElement).disabled).toBe(true);
  submit();
  expect(onPreview).toHaveBeenCalledTimes(1);
  expect(input('開始時間').value).toBe('21:30');
});

it('does not offer a cancelled, already acted-on, non-calendar, or all-day-only source', () => {
  const onPreview = vi.fn();
  const view = render(<AssistantPrecisePlanRevision {...base} turn={turn()} states={{ first: { status: 'cancelled' } }} onPreview={onPreview} />);
  expect(screen.queryByRole('button')).toBeNull();
  view.rerender(<AssistantPrecisePlanRevision {...base} turn={turn()} states={{ first: { status: 'superseded' } }} onPreview={onPreview} />);
  expect(screen.queryByRole('button')).toBeNull();
  view.rerender(<AssistantPrecisePlanRevision {...base} turn={turn([{ ...card(), tool: 'propose_open_page' }])} onPreview={onPreview} />);
  expect(screen.queryByRole('button')).toBeNull();
  view.rerender(<AssistantPrecisePlanRevision {...base} turn={turn([{ ...card(), args: { title: '全天', date: '2030-11-04', allDay: true } }])} onPreview={onPreview} />);
  expect(screen.queryByRole('button')).toBeNull();
  expect(onPreview).not.toHaveBeenCalled();
});

it('respects owner readiness and pending flags even for a direct form submission', () => {
  const original = turn(), onPreview = vi.fn();
  const view = render(<AssistantPrecisePlanRevision {...base} turn={original} onPreview={onPreview} />);
  open(); edit();
  view.rerender(<AssistantPrecisePlanRevision {...base} turn={original} enabled={false} onPreview={onPreview} />);
  submit();
  expect((screen.getByRole('button', { name: '預覽時間調整' }) as HTMLButtonElement).disabled).toBe(true);
  view.rerender(<AssistantPrecisePlanRevision {...base} turn={original} pending onPreview={onPreview} />);
  submit();
  expect(input('開始時間').disabled).toBe(true);
  expect(onPreview).not.toHaveBeenCalled();
});

it('stops an already open editor when the original card becomes superseded', () => {
  const original = turn(), onPreview = vi.fn();
  const view = render(<AssistantPrecisePlanRevision {...base} turn={original} onPreview={onPreview} />);
  open(); edit();
  view.rerender(<AssistantPrecisePlanRevision {...base} turn={original} states={{ first: { status: 'superseded' } }} onPreview={onPreview} />);
  submit();
  expect(screen.getByRole('status').textContent).toContain('目前不能預覽這份時間調整');
  expect(onPreview).not.toHaveBeenCalled();
});

it('ignores a late result after a source change and keeps the replacement fields', async () => {
  const pending = deferred<{ ok: boolean; message: string }>();
  const onPreview = vi.fn(() => pending.promise);
  const view = render(<AssistantPrecisePlanRevision {...base} turn={turn()} onPreview={onPreview} />);
  open(); edit(); submit();
  view.rerender(<AssistantPrecisePlanRevision {...base} turn={turn([card('replacement')])} onPreview={onPreview} />);
  open(); field('開始時間', '19:00');
  await act(async () => { pending.resolve({ ok: true, message: '舊回應不可顯示。' }); });
  expect(screen.queryByText('舊回應不可顯示。')).toBeNull();
  expect(input('開始時間').value).toBe('19:00');
  expect((screen.getByRole('button', { name: '預覽時間調整' }) as HTMLButtonElement).disabled).toBe(false);
});

it('accepts a late failure after unmount without restoring any editor', async () => {
  const pending = deferred<{ ok: boolean; message: string }>();
  const view = render(<AssistantPrecisePlanRevision {...base} turn={turn()} onPreview={() => pending.promise} />);
  open(); edit(); submit(); view.unmount();
  await act(async () => { pending.resolve({ ok: false, message: '晚到失敗。' }); });
  expect(screen.queryByText('晚到失敗。')).toBeNull();
  expect(document.body.textContent).toBe('');
});

const summaryBefore: PlanProtectionEvent[] = [
  { title: '英文複習', date: '2030-11-04', allDay: false, startTime: '18:00', endTime: '19:00' },
  { title: '英文複習', date: '2030-11-04', allDay: false, startTime: '20:00', endTime: '21:00' },
  { title: '未修改項目的名稱不需重複', date: '2030-11-05', allDay: true },
];
const summaryAfter: PlanProtectionEvent[] = summaryBefore.map((event, index) => index === 1
  ? { ...event, date: '2030-11-07', endDate: '2030-11-08', startTime: '23:30', endTime: '00:30' } : { ...event });
it('summarizes only the known target despite equal names, with exact cross-day times and historical-safe wording', () => {
  render(<AssistantPrecisePlanComparison before={summaryBefore} after={summaryAfter} index={1} />);
  expect(screen.getByRole('heading', { name: '時間調整摘要' })).toBeTruthy();
  expect(screen.getByText('第 2 項 · 英文複習')).toBeTruthy();
  expect(screen.getByText('2030-11-04 20:00–21:00')).toBeTruthy();
  expect(screen.getByText('2030-11-07 23:30 – 2030-11-08 00:30')).toBeTruthy();
  expect(screen.getByText(/其餘 2 項行程內容保持不變/)).toBeTruthy();
  expect(screen.getByText(/是否已寫入，請依確認卡的結果核對/)).toBeTruthy();
  expect(document.body.textContent).not.toContain('未修改項目的名稱不需重複');
  expect(document.body.textContent).not.toContain('18:00');
  expect(document.body.textContent).not.toContain('沒有寫入');
});

it.each(['title', 'other-row', 'index', 'unchanged', 'length', 'all-day'] as const)('does not claim a precise comparison for invalid %s correspondence', kind => {
  const next = summaryAfter.map(event => ({ ...event }));
  let index = 1;
  if (kind === 'title') next[1].title = '另一名稱';
  if (kind === 'other-row') next[0].date = '2030-11-09';
  if (kind === 'index') index = 20;
  if (kind === 'unchanged') next[1] = { ...summaryBefore[1] };
  if (kind === 'length') next.pop();
  if (kind === 'all-day') next[1] = { title: next[1].title, date: next[1].date, allDay: true };
  const { container } = render(<AssistantPrecisePlanComparison before={summaryBefore} after={next} index={index} />);
  expect(container.textContent).toBe('');
});


function draftBridge(patch: Partial<PreciseRevisionDraftBridge> = {}): PreciseRevisionDraftBridge {
  return { onChange: vi.fn(), onClear: vi.fn(() => ({ ok: true })), onReplace: vi.fn(() => ({ ok: true })),
    onApply: vi.fn(() => ({ ok: false, message: '尚未核對來源。' })), ...patch };
}
const restoredTimeContent = { selectedIndex: 1, edits: [
  { index: 0, date: '2030-11-04', endDate: '2030-11-04', startTime: '19:30', endTime: '' },
  { index: 1, date: '2030-11-07', endDate: '2030-11-08', startTime: '23:30', endTime: '00:30' },
] };

it('saves only genuine raw field changes with complete original indices and no IDs or private metadata', () => {
  const draft = draftBridge();
  const allDay = card('all-day'); allDay.args = { title: '全天活動', date: '2030-11-04', allDay: true };
  render(<AssistantPrecisePlanRevision {...base} turn={turn([allDay, card(), card('second')])} draft={draft} onPreview={vi.fn()} />);
  open();
  fireEvent.change(screen.getByLabelText('要調整的行程'), { target: { value: 'second' } });
  fireEvent.click(screen.getByRole('button', { name: '收起時間調整' })); open();
  expect(draft.onChange).not.toHaveBeenCalled();
  field('結束時間', '');
  expect(draft.onChange).toHaveBeenLastCalledWith({ selectedIndex: 2, edits: [
    { index: 2, date: '2030-11-04', endDate: '2030-11-04', startTime: '20:00', endTime: '' },
  ] });
  fireEvent.change(screen.getByLabelText('要調整的行程'), { target: { value: 'first' } });
  field('開始時間', '19:00');
  expect(draft.onChange).toHaveBeenLastCalledWith({ selectedIndex: 1, edits: [
    { index: 1, date: '2030-11-04', endDate: '2030-11-04', startTime: '19:00', endTime: '21:00' },
    { index: 2, date: '2030-11-04', endDate: '2030-11-04', startTime: '20:00', endTime: '' },
  ] });
  expect(JSON.stringify(vi.mocked(draft.onChange).mock.calls)).not.toMatch(/PRIVATE_|mutationId|first|second|schoolId|token/);
  expect(screen.getByText(/目前有 2 項時間欄位尚未送出/).textContent).toContain('其餘已編輯時間不會套用');
  expect(screen.getByText(/目前有 2 項時間欄位尚未送出/).textContent).toContain('若要調整其他項目，請在新提議重新填寫');
});

it('removes edits returned to the original display values but preserves an unfinished all-blank target', () => {
  const draft = draftBridge();
  render(<AssistantPrecisePlanRevision {...base} turn={turn()} draft={draft} onPreview={vi.fn()} />);
  open(); field('開始時間', '19:00'); field('開始時間', '20:00');
  expect(draft.onChange).toHaveBeenLastCalledWith({ selectedIndex: 0, edits: [] });
  for (const label of ['開始日期', '結束日期', '開始時間', '結束時間']) field(label, '');
  expect(draft.onChange).toHaveBeenLastCalledWith({ selectedIndex: 0, edits: [
    { index: 0, date: '', endDate: '', startTime: '', endTime: '' },
  ] });
});

it('does not expose apply before restoration and explicitly replaces a pending stored offer without sending an action', () => {
  const draft = draftBridge({ pendingRecovery: true, status: '本分頁另有尚未恢復的時間草稿。' });
  const onPreview = vi.fn();
  render(<AssistantPrecisePlanRevision {...base} turn={turn()} draft={draft} onPreview={onPreview} />);
  open(); edit();
  expect(screen.queryByRole('button', { name: /套用已恢復/ })).toBeNull();
  expect(screen.queryByRole('button', { name: /以恢復草稿取代/ })).toBeNull();
  expect(draft.onReplace).not.toHaveBeenCalled();
  expect(screen.getByText(/改存目前時間欄位會取代先前時間草稿/).textContent).toContain('不影響文字草稿');
  fireEvent.click(screen.getByRole('button', { name: '改存目前時間欄位' }));
  expect(draft.onReplace).toHaveBeenCalledExactlyOnceWith({ selectedIndex: 0, edits: [
    { index: 0, date: '2030-11-04', endDate: '2030-11-04', startTime: '21:30', endTime: '22:30' },
  ] });
  expect(draft.onApply).not.toHaveBeenCalled();
  expect(onPreview).not.toHaveBeenCalled();
});

it('restores raw fields only after explicit apply, maps indices to fresh IDs, and does not autosave on apply or select', async () => {
  const draft = draftBridge({ recovery: { id: 'draft-1', match: 'fresh' },
    onApply: vi.fn(() => ({ ok: true, content: restoredTimeContent })) });
  const onPreview = vi.fn(async () => ({ ok: false, message: '僅選取項目的時間已收到。' }));
  render(<AssistantPrecisePlanRevision {...base} turn={turn([card('fresh-first'), card('fresh-second')])} draft={draft} onPreview={onPreview} />);
  open();
  expect(input('開始時間').value).toBe('20:00');
  expect(draft.onApply).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '套用已恢復的時間草稿' }));
  expect(draft.onApply).toHaveBeenCalledTimes(1);
  expect((screen.getByLabelText('要調整的行程') as HTMLSelectElement).value).toBe('fresh-second');
  expect(input('開始日期').value).toBe('2030-11-07');
  expect(input('結束日期').value).toBe('2030-11-08');
  fireEvent.change(screen.getByLabelText('要調整的行程'), { target: { value: 'fresh-first' } });
  expect(input('開始時間').value).toBe('19:30'); expect(input('結束時間').value).toBe('');
  fireEvent.change(screen.getByLabelText('要調整的行程'), { target: { value: 'fresh-second' } });
  expect(draft.onChange).not.toHaveBeenCalled();
  submit(); await screen.findByText('僅選取項目的時間已收到。');
  expect(onPreview).toHaveBeenCalledExactlyOnceWith({ mutationId: 'fresh-second', date: '2030-11-07', endDate: '2030-11-08', startTime: '23:30', endTime: '00:30' });
});

it('retains current input until the user explicitly chooses recovered fields instead of the keep-current choice', () => {
  const draft = draftBridge({ pendingRecovery: true, recovery: { id: 'draft-2', match: 'exact' },
    onApply: vi.fn(() => ({ ok: true, content: { selectedIndex: 0, edits: [
      { index: 0, date: '2030-11-04', endDate: '2030-11-04', startTime: '18:00', endTime: '19:00' },
    ] } })) });
  render(<AssistantPrecisePlanRevision {...base} turn={turn()} draft={draft} onPreview={vi.fn()} />);
  open(); edit();
  expect(screen.queryByRole('button', { name: '套用已恢復的時間草稿' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '保留目前時間欄位' }));
  expect(draft.onApply).not.toHaveBeenCalled();
  expect(draft.onReplace).not.toHaveBeenCalled();
  expect(input('開始時間').value).toBe('21:30');
  expect(screen.getByText(/已保留目前時間欄位，沒有套用恢復草稿/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '以恢復草稿取代目前時間欄位' }));
  expect(draft.onApply).toHaveBeenCalledTimes(1);
  expect(input('開始時間').value).toBe('18:00');
  expect(input('結束時間').value).toBe('19:00');
  expect(draft.onChange).toHaveBeenCalledTimes(2);
});

it.each(['mismatch', 'ambiguous'] as const)('does not apply a %s recovery and keeps current fields for manual correction', match => {
  const draft = draftBridge({ pendingRecovery: true, recovery: { id: 'draft-3', match } });
  render(<AssistantPrecisePlanRevision {...base} turn={turn()} draft={draft} onPreview={vi.fn()} />);
  open(); edit();
  expect(screen.queryByRole('button', { name: /套用已恢復|以恢復草稿取代/ })).toBeNull();
  expect(screen.getByText(/請核對草稿並重新選擇、填寫要調整的項目/)).toBeTruthy();
  expect(input('開始時間').value).toBe('21:30');
  expect(draft.onApply).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: '改存目前時間欄位' })).toBeTruthy();
});

it('requires successful time-only storage clearing before resetting fields and selection', () => {
  const onClear = vi.fn().mockReturnValueOnce({ ok: false, message: '瀏覽器尚未確認清除。' }).mockReturnValueOnce({ ok: true });
  const draft = draftBridge({ onClear });
  render(<AssistantPrecisePlanRevision {...base} turn={turn([card(), card('second')])} draft={draft} onPreview={vi.fn()} />);
  open(); fireEvent.change(screen.getByLabelText('要調整的行程'), { target: { value: 'second' } }); edit();
  fireEvent.click(screen.getByRole('button', { name: '清除時間草稿' }));
  expect(screen.getByRole('alert').textContent).toContain('尚未確認清除');
  expect(input('開始時間').value).toBe('21:30');
  expect((screen.getByLabelText('要調整的行程') as HTMLSelectElement).value).toBe('second');
  fireEvent.click(screen.getByRole('button', { name: '清除時間草稿' }));
  expect(input('開始時間').value).toBe('20:00');
  expect((screen.getByLabelText('要調整的行程') as HTMLSelectElement).value).toBe('first');
  expect(document.activeElement).toBe(screen.getByLabelText('要調整的行程'));
  expect(screen.getByRole('status').textContent).toContain('文字草稿與確認卡未變更');
  expect(draft.onChange).toHaveBeenCalledTimes(2);
  expect(onClear).toHaveBeenCalledTimes(2);
});

it('keeps inputs after failed apply or replacement without assuming storage succeeded', () => {
  const draft = draftBridge({ pendingRecovery: true, recovery: { id: 'draft-4', match: 'fresh' },
    onApply: vi.fn(() => ({ ok: false, message: '時間草稿已失效。' })),
    onReplace: vi.fn(() => ({ ok: false, message: '瀏覽器空間不足。' })) });
  render(<AssistantPrecisePlanRevision {...base} turn={turn()} draft={draft} onPreview={vi.fn()} />);
  open(); edit();
  fireEvent.click(screen.getByRole('button', { name: '以恢復草稿取代目前時間欄位' }));
  expect(screen.getByRole('alert').textContent).toContain('時間草稿已失效');
  expect(input('開始時間').value).toBe('21:30');
  fireEvent.click(screen.getByRole('button', { name: '改存目前時間欄位' }));
  expect(screen.getByRole('alert').textContent).toContain('瀏覽器空間不足');
  expect(input('結束時間').value).toBe('22:30');
});

it('keeps invalid recovered raw values while editing another field instead of sanitizing the stored draft', () => {
  const draft = draftBridge({ recovery: { id: 'draft-invalid', match: 'exact' },
    onApply: vi.fn(() => ({ ok: true, content: { selectedIndex: 0, edits: [
      { index: 0, date: 'not-a-date', endDate: '', startTime: '29:88', endTime: '' },
    ] } })) });
  render(<AssistantPrecisePlanRevision {...base} turn={turn()} draft={draft} onPreview={vi.fn()} />);
  open(); fireEvent.click(screen.getByRole('button', { name: '套用已恢復的時間草稿' }));
  field('結束時間', '21:00');
  expect(draft.onChange).toHaveBeenLastCalledWith({ selectedIndex: 0, edits: [
    { index: 0, date: 'not-a-date', endDate: '', startTime: '29:88', endTime: '21:00' },
  ] });
});

it('stops autosave and recovery application when owner readiness is withdrawn while retaining memory input', () => {
  const draft = draftBridge({ pendingRecovery: true, recovery: { id: 'draft-5', match: 'exact' } });
  const original = turn();
  const view = render(<AssistantPrecisePlanRevision {...base} turn={original} draft={draft} onPreview={vi.fn()} />);
  open(); field('開始時間', '19:00');
  view.rerender(<AssistantPrecisePlanRevision {...base} turn={original} draft={draft} enabled={false} onPreview={vi.fn()} />);
  field('結束時間', '22:00');
  expect(input('結束時間').value).toBe('22:00');
  expect(draft.onChange).toHaveBeenCalledTimes(1);
  expect((screen.getByRole('button', { name: '以恢復草稿取代目前時間欄位' }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: '改存目前時間欄位' }) as HTMLButtonElement).disabled).toBe(true);
  expect(draft.onApply).not.toHaveBeenCalled();
  expect(draft.onReplace).not.toHaveBeenCalled();
});
