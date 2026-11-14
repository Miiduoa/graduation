import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { RevisionDraft } from '@/lib/assistantPlanRevisionDraft';
import { AssistantPlanDraftRecovery } from './AssistantPlanDraftRecovery';

function draft(): RevisionDraft {
  return {
    version: 1, id: 'draft-id', scopeKey: 'opaque-scope', savedAt: Date.parse('2026-11-09T14:30:00Z'),
    source: { key: 'source-content', events: [
      { title: '原提議的跨日討論', date: '2026-11-10', endDate: '2026-11-11', allDay: false, startTime: '23:00', endTime: '01:00' },
      { title: '原提議的全天活動', date: '2026-11-12', endDate: '2026-11-14', allDay: true },
    ] },
    instruction: '草稿裡的修改條件', protectedIndices: [1],
  };
}
function props() {
  return { draft: draft(), restored: false, status: '', blocked: false, onRestore: vi.fn(), onDiscard: vi.fn(), onChange: vi.fn() };
}

it('offers only metadata before explicit restore, with no focus change or source-content exposure', () => {
  const callbacks = props();
  const outside = document.createElement('button');
  document.body.append(outside); outside.focus();
  render(<AssistantPlanDraftRecovery {...callbacks} />);
  expect(document.activeElement).toBe(outside);
  expect(screen.getByRole('region', { name: '未送出的修訂草稿' })).toBeTruthy();
  expect(screen.getByText(/原提議 2 項，已勾選保留 1 項/)).toBeTruthy();
  expect(screen.getByText(/2026\/11\/09 22:30/)).toBeTruthy();
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(screen.queryByText('草稿裡的修改條件')).toBeNull();
  expect(screen.queryByText('原提議的跨日討論')).toBeNull();
  expect(screen.queryByText('查看原提議內容（僅供核對）')).toBeNull();
  expect(document.body.textContent).not.toContain('opaque-scope');
  for (const name of ['恢復修訂草稿', '捨棄修訂草稿']) {
    expect((screen.getByRole('button', { name }) as HTMLButtonElement).type).toBe('button');
  }
  expect(callbacks.onRestore).not.toHaveBeenCalled();
  expect(callbacks.onDiscard).not.toHaveBeenCalled();
  expect(callbacks.onChange).not.toHaveBeenCalled();
  outside.remove();
});

it('focuses after explicit restore but never refocuses on text, status or draft-id updates', () => {
  const callbacks = props();
  const view = render(<AssistantPlanDraftRecovery {...callbacks} />);
  const restore = screen.getByRole('button', { name: '恢復修訂草稿' });
  restore.focus(); fireEvent.click(restore);
  expect(callbacks.onRestore).toHaveBeenCalledOnce();
  expect(screen.queryByRole('textbox')).toBeNull();
  view.rerender(<AssistantPlanDraftRecovery {...callbacks} restored status="草稿已恢復，尚未套用。" />);
  const field = screen.getByRole('textbox', { name: '已恢復的修改條件' }) as HTMLTextAreaElement;
  expect(document.activeElement).toBe(field);
  expect(field.value).toBe('草稿裡的修改條件');
  expect(field.maxLength).toBe(300);
  fireEvent.change(field, { target: { value: '編輯後的條件' } });
  expect(callbacks.onChange).toHaveBeenCalledExactlyOnceWith('編輯後的條件');
  const discard = screen.getByRole('button', { name: '捨棄修訂草稿' });
  discard.focus();
  view.rerender(<AssistantPlanDraftRecovery {...callbacks} restored status="本機暫存已更新。" draft={{ ...callbacks.draft, id: 'next-draft-id', instruction: '編輯後的條件' }} />);
  expect(document.activeElement).toBe(discard);
  expect(field.value).toBe('編輯後的條件');
  expect(callbacks.onRestore).toHaveBeenCalledOnce();
});

it('does not steal focus when mounted with an already restored draft', () => {
  const callbacks = props();
  const outside = document.createElement('button');
  document.body.append(outside); outside.focus();
  render(<AssistantPlanDraftRecovery {...callbacks} restored />);
  expect(document.activeElement).toBe(outside);
  outside.remove();
});

it('keeps recovery, editing and discard available while old operations block applying the draft', () => {
  const callbacks = props();
  const view = render(<AssistantPlanDraftRecovery {...callbacks} blocked />);
  expect(screen.getByText(/仍有舊操作待核對/)).toBeTruthy();
  const restore = screen.getByRole('button', { name: '恢復修訂草稿' }) as HTMLButtonElement;
  expect(restore.disabled).toBe(false);
  fireEvent.click(restore);
  expect(callbacks.onRestore).toHaveBeenCalledOnce();
  view.rerender(<AssistantPlanDraftRecovery {...callbacks} blocked restored />);
  const field = screen.getByLabelText('已恢復的修改條件') as HTMLTextAreaElement;
  expect(field.disabled).toBe(false);
  fireEvent.change(field, { target: { value: '只編輯本機內容' } });
  expect(callbacks.onChange).toHaveBeenCalledExactlyOnceWith('只編輯本機內容');
  fireEvent.click(screen.getByRole('button', { name: '捨棄修訂草稿' }));
  expect(callbacks.onDiscard).toHaveBeenCalledOnce();
  expect(screen.queryByRole('button', { name: /確認|重新預覽|套用/ })).toBeNull();
  expect(screen.queryByRole('form')).toBeNull();
});

it('shows the exact six source fields in an optional read-only snapshot, including cross-day and exclusive all-day end dates', () => {
  const callbacks = props();
  const view = render(<AssistantPlanDraftRecovery {...callbacks} restored />);
  const details = view.container.querySelector('details')!;
  expect(details.open).toBe(false);
  details.open = true;
  const items = within(screen.getByRole('list', { name: '草稿的原提議內容' })).getAllByRole('listitem');
  expect(items).toHaveLength(2);
  expect(within(items[0]).getAllByRole('term')).toHaveLength(6);
  expect(within(items[0]).getAllByRole('definition').map(node => node.textContent)).toEqual([
    '原提議的跨日討論', '2026-11-10', '2026-11-11', '否', '23:00', '01:00',
  ]);
  expect(within(items[1]).getByText('結束日期（不含當日）')).toBeTruthy();
  expect(within(items[1]).getAllByRole('definition').map(node => node.textContent)).toEqual([
    '原提議的全天活動', '2026-11-12', '2026-11-14', '是', '未設定', '未設定',
  ]);
  expect(screen.getByText(/不代表行程已建立/)).toBeTruthy();
  expect(callbacks.onChange).not.toHaveBeenCalled();
  expect(callbacks.onRestore).not.toHaveBeenCalled();
});

it('renders a short status when there is no draft and nothing when status is also empty', () => {
  const callbacks = props();
  const view = render(<AssistantPlanDraftRecovery {...callbacks} draft={null} status="草稿已捨棄。" />);
  expect(screen.getByRole('status').textContent).toBe('草稿已捨棄。');
  expect(screen.queryByRole('region')).toBeNull();
  expect(screen.queryByRole('button')).toBeNull();
  view.rerender(<AssistantPlanDraftRecovery {...callbacks} draft={null} />);
  expect(view.container.innerHTML).toBe('');
});
