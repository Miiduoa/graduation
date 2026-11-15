import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { PrecisePlanDraft } from '@/lib/assistantPrecisePlanDraft';
import { AssistantPrecisePlanDraftRecovery } from './AssistantPrecisePlanDraftRecovery';

function draft(): PrecisePlanDraft {
  return {
    version: 1, id: 'PRIVATE_DRAFT_ID', scopeKey: 'PRIVATE_SCOPE', savedAt: Date.parse('2026-11-09T14:30:00Z'),
    source: { key: 'PRIVATE_SOURCE_KEY', events: [
      { title: '原提議的跨日討論', date: '2030-11-10', endDate: '2030-11-11', allDay: false, startTime: '23:00', endTime: '01:00' },
      { title: '原提議的程式練習', date: '2030-11-12', allDay: false, startTime: '18:00', endTime: '19:00' },
      { title: '原提議的全天活動', date: '2030-11-13', endDate: '2030-11-15', allDay: true },
    ] },
    selectedIndex: 1,
    edits: [
      { index: 0, date: '2030-11-31', endDate: '', startTime: '25:99', endTime: '  ' },
      { index: 1, date: '2030-11-14', endDate: '2030-11-14', startTime: '20:00', endTime: '21:00' },
    ],
  };
}
function props() {
  return { draft: draft(), restored: false, status: '', blocked: false, onRestore: vi.fn(), onDiscard: vi.fn() };
}

it('shows only counts and saved time before explicit restore, with no automatic callback or focus change', () => {
  const callbacks = props();
  const outside = document.createElement('button');
  document.body.append(outside); outside.focus();
  const view = render(<AssistantPrecisePlanDraftRecovery {...callbacks} />);
  expect(document.activeElement).toBe(outside);
  expect(screen.getByRole('region', { name: '未送出的時間草稿' })).toBeTruthy();
  expect(screen.getByText(/原提議 3 項，已編輯 2 項/)).toBeTruthy();
  expect(screen.getByText(/2026\/11\/09 22:30/)).toBeTruthy();
  expect(view.container.querySelector('time')?.dateTime).toBe('2026-11-09T14:30:00.000Z');
  for (const secret of ['PRIVATE_', '原提議的跨日討論', '2030-11-10', '2030-11-31', '25:99', '最後編輯'])
    expect(view.container.textContent).not.toContain(secret);
  expect(screen.queryByRole('list')).toBeNull();
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(screen.queryByRole('form')).toBeNull();
  for (const name of ['恢復時間草稿', '捨棄時間草稿'])
    expect((screen.getByRole('button', { name }) as HTMLButtonElement).type).toBe('button');
  expect(callbacks.onRestore).not.toHaveBeenCalled();
  expect(callbacks.onDiscard).not.toHaveBeenCalled();
  outside.remove();
});

it('requests restore exactly once per click and reveals content only when the owner confirms restored', () => {
  const callbacks = props();
  const view = render(<AssistantPrecisePlanDraftRecovery {...callbacks} />);
  const restore = screen.getByRole('button', { name: '恢復時間草稿' });
  restore.focus(); fireEvent.click(restore);
  expect(callbacks.onRestore).toHaveBeenCalledExactlyOnceWith();
  expect(screen.queryByText('原提議的跨日討論')).toBeNull();
  view.rerender(<AssistantPrecisePlanDraftRecovery {...callbacks} restored status="時間草稿已恢復，尚未套用。" />);
  const summary = screen.getByRole('region', { name: '已恢復的時間草稿內容' });
  expect(summary.tabIndex).toBe(-1);
  expect(document.activeElement).toBe(summary);
  expect(screen.queryByRole('button', { name: '恢復時間草稿' })).toBeNull();
  expect(screen.getByText('最後編輯：第 2 項。')).toBeTruthy();
  expect(screen.getByRole('status').textContent).toBe('時間草稿已恢復，尚未套用。');
  expect(callbacks.onRestore).toHaveBeenCalledOnce();
  expect(callbacks.onDiscard).not.toHaveBeenCalled();
});

it('does not steal focus on an already-restored mount or subsequent draft/status updates', () => {
  const callbacks = props();
  const outside = document.createElement('button');
  document.body.append(outside); outside.focus();
  const view = render(<AssistantPrecisePlanDraftRecovery {...callbacks} restored />);
  expect(document.activeElement).toBe(outside);
  const discard = screen.getByRole('button', { name: '捨棄時間草稿' });
  discard.focus();
  view.rerender(<AssistantPrecisePlanDraftRecovery {...callbacks} restored status="僅保留草稿。" draft={{ ...callbacks.draft, id: 'NEXT_PRIVATE_ID' }} />);
  expect(document.activeElement).toBe(discard);
  expect(callbacks.onRestore).not.toHaveBeenCalled();
  expect(callbacks.onDiscard).not.toHaveBeenCalled();
  outside.remove();
});

it('renders invalid raw edits exactly, marks blank values unfilled, and provides no editable controls', () => {
  const callbacks = props();
  render(<AssistantPrecisePlanDraftRecovery {...callbacks} restored />);
  const items = within(screen.getByRole('list', { name: '草稿的時間修改欄位' })).getAllByRole('listitem');
  expect(items).toHaveLength(2);
  expect(within(items[0]).getByRole('heading', { name: '第 1 項的時間欄位' })).toBeTruthy();
  expect(within(items[0]).getAllByRole('definition').map(node => node.textContent)).toEqual(['2030-11-31', '未填', '25:99', '未填']);
  expect(within(items[1]).getAllByRole('definition').map(node => node.textContent)).toEqual(['2030-11-14', '2030-11-14', '20:00', '21:00']);
  expect(screen.getByText(/未填或無效內容不代表可用時間/)).toBeTruthy();
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(screen.queryByRole('combobox')).toBeNull();
  expect(screen.queryByRole('form')).toBeNull();
  expect(document.querySelector('input, textarea, select')).toBeNull();
  expect(callbacks.onRestore).not.toHaveBeenCalled();
  expect(callbacks.onDiscard).not.toHaveBeenCalled();
});

it('shows all six raw source fields, including absent endDate and exclusive all-day end dates', () => {
  render(<AssistantPrecisePlanDraftRecovery {...props()} restored />);
  const summary = screen.getByText('原提議內容（僅供核對）');
  expect((summary.closest('details') as HTMLDetailsElement).open).toBe(false);
  // JSDOM role queries do not model closed-details visibility; assert its native state.
  fireEvent.click(summary);
  expect((summary.closest('details') as HTMLDetailsElement).open).toBe(true);
  const items = within(screen.getByRole('list', { name: '時間草稿的原提議內容' })).getAllByRole('listitem');
  expect(items).toHaveLength(3);
  for (const item of items) expect(within(item).getAllByRole('term')).toHaveLength(6);
  expect(within(items[0]).getAllByRole('definition').map(node => node.textContent)).toEqual([
    '原提議的跨日討論', '2030-11-10', '2030-11-11', '否', '23:00', '01:00',
  ]);
  expect(within(items[1]).getAllByRole('definition').map(node => node.textContent)).toEqual([
    '原提議的程式練習', '2030-11-12', '未另設', '否', '18:00', '19:00',
  ]);
  expect(within(items[2]).getByText('結束日期（不含當日）')).toBeTruthy();
  expect(within(items[2]).getAllByRole('definition').map(node => node.textContent)).toEqual([
    '原提議的全天活動', '2030-11-13', '2030-11-15', '是', '未設定', '未設定',
  ]);
  expect(screen.getByText(/不代表行程已建立/)).toBeTruthy();
});

it('displays text safely without showing execution or scope metadata', () => {
  const callbacks = props();
  const htmlText = '<img src=x onerror=alert(1)>';
  callbacks.draft.source.events[0].title = htmlText;
  callbacks.draft.edits[0].date = '  invalid raw date  ';
  const withMetadata = { ...callbacks.draft, token: 'PRIVATE_TOKEN', conversationId: 'PRIVATE_CONVERSATION', consent: true,
    source: { ...callbacks.draft.source, events: callbacks.draft.source.events.map(event => ({ ...event, token: 'PRIVATE_EVENT_TOKEN', mutationId: 'PRIVATE_MUTATION' })) } };
  const view = render(<AssistantPrecisePlanDraftRecovery {...callbacks} draft={withMetadata} restored />);
  fireEvent.click(screen.getByText('原提議內容（僅供核對）'));
  expect(screen.getByText(htmlText)).toBeTruthy();
  expect(view.container.querySelector('img, script')).toBeNull();
  expect(view.container.textContent).not.toContain('PRIVATE_');
  const firstEdit = within(screen.getByRole('list', { name: '草稿的時間修改欄位' })).getAllByRole('listitem')[0];
  const firstValue = within(firstEdit).getAllByRole('definition')[0];
  expect(firstValue.textContent).toBe('  invalid raw date  ');
  expect(firstValue.style.whiteSpace).toBe('pre-wrap');
});

it('keeps restore and discard available while blocked, without offering application or execution', () => {
  const callbacks = props();
  const view = render(<AssistantPrecisePlanDraftRecovery {...callbacks} blocked />);
  expect(screen.getByText(/仍有舊操作待核對/)).toBeTruthy();
  const restore = screen.getByRole('button', { name: '恢復時間草稿' }) as HTMLButtonElement;
  expect(restore.disabled).toBe(false);
  fireEvent.click(restore);
  expect(callbacks.onRestore).toHaveBeenCalledExactlyOnceWith();
  view.rerender(<AssistantPrecisePlanDraftRecovery {...callbacks} blocked restored />);
  const discard = screen.getByRole('button', { name: '捨棄時間草稿' }) as HTMLButtonElement;
  expect(discard.disabled).toBe(false);
  fireEvent.click(discard);
  expect(callbacks.onDiscard).toHaveBeenCalledExactlyOnceWith();
  expect(screen.queryByRole('button', { name: /確認|預覽|套用/ })).toBeNull();
  expect(screen.queryByRole('form')).toBeNull();
  expect(screen.getByText(/30 分鐘內可恢復/)).toBeTruthy();
  expect(screen.getByText(/不會復活舊確認卡、送給模型或送出行程操作/)).toBeTruthy();
});

it('explains exact whole-plan matching and ambiguous fresh duplicate proposals without guessing', () => {
  render(<AssistantPrecisePlanDraftRecovery {...props()} restored />);
  expect(screen.getByText(/只有相同來源，或整份內容與順序都能可靠核對/)).toBeTruthy();
  expect(screen.getByText(/提議重排、內容變更/)).toBeTruthy();
  expect(screen.getByText(/完全相同的重複項目而無法可靠對應/)).toBeTruthy();
  expect(screen.getByText(/不會按名稱猜測/)).toBeTruthy();
});

it('calls discard only on its explicit click before restoration', () => {
  const callbacks = props();
  const view = render(<AssistantPrecisePlanDraftRecovery {...callbacks} />);
  view.rerender(<AssistantPrecisePlanDraftRecovery {...callbacks} status="草稿仍在本分頁。" />);
  expect(callbacks.onDiscard).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '捨棄時間草稿' }));
  expect(callbacks.onDiscard).toHaveBeenCalledExactlyOnceWith();
  expect(callbacks.onRestore).not.toHaveBeenCalled();
});

it('shows only status for a missing draft, and nothing for a missing draft with empty status', () => {
  const callbacks = props();
  const view = render(<AssistantPrecisePlanDraftRecovery {...callbacks} draft={null} status="時間草稿已到期。" restored />);
  expect(screen.getByRole('status').textContent).toBe('時間草稿已到期。');
  expect(screen.queryByRole('region')).toBeNull();
  expect(screen.queryByRole('button')).toBeNull();
  view.rerender(<AssistantPrecisePlanDraftRecovery {...callbacks} draft={null} />);
  expect(view.container.innerHTML).toBe('');
  expect(callbacks.onRestore).not.toHaveBeenCalled();
  expect(callbacks.onDiscard).not.toHaveBeenCalled();
});
