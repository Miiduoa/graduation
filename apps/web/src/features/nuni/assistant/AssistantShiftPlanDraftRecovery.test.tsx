import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { ShiftPlanDraft } from '@/lib/assistantShiftPlanDraft';
import { AssistantShiftPlanDraftRecovery } from './AssistantShiftPlanDraftRecovery';

function draft(): ShiftPlanDraft {
  return { version: 1, id: 'PRIVATE_ID', scopeKey: 'PRIVATE_SCOPE', savedAt: Date.parse('2030-11-04T12:00:00Z'),
    source: { key: 'PRIVATE_SOURCE', events: [
      { title: '同名讀書', date: '2030-11-04', allDay: false, startTime: '20:00', endTime: '21:00' },
      { title: '同名讀書', date: '2030-11-04', endDate: '2030-11-05', allDay: false, startTime: '23:00', endTime: '01:00' },
      { title: '全天活動', date: '2030-11-05', endDate: '2030-11-07', allDay: true },
    ] }, mode: 'shift', direction: 'earlier', minutes: '45', selectedIndices: [1], protectedIndices: [0] };
}
const props = () => ({ draft: draft(), restored: false, blocked: false, status: '', onRestore: vi.fn(), onDiscard: vi.fn() });

it('offers recovery without exposing raw content or triggering any action before an explicit restore', () => {
  const callbacks = props();
  render(<AssistantShiftPlanDraftRecovery {...callbacks} />);
  expect(screen.getByRole('region', { name: '未送出的平移草稿' })).toBeTruthy();
  expect(screen.getByText(/原提議 3 項，當時選取 1 項、保留原樣 1 項/)).toBeTruthy();
  expect(screen.getByText(/2030\/11\/04 20:00/)).toBeTruthy();
  expect(document.body.textContent).not.toContain('同名讀書'); expect(document.body.textContent).not.toContain('PRIVATE_');
  expect(screen.queryByRole('list')).toBeNull();
  expect(callbacks.onRestore).not.toHaveBeenCalled(); expect(callbacks.onDiscard).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '恢復平移草稿' }));
  expect(callbacks.onRestore).toHaveBeenCalledExactlyOnceWith();
  expect(screen.queryByRole('region', { name: '已恢復的平移草稿內容' })).toBeNull();
});

it('focuses the restored read-only content and distinguishes original selected and protected same-name rows by ordinal', () => {
  const callbacks = props(), view = render(<AssistantShiftPlanDraftRecovery {...callbacks} />);
  view.rerender(<AssistantShiftPlanDraftRecovery {...callbacks} restored />);
  const content = screen.getByRole('region', { name: '已恢復的平移草稿內容' });
  expect(document.activeElement).toBe(content); expect(content.tabIndex).toBe(-1);
  const selected = within(screen.getByRole('list', { name: '草稿原選取項目' })).getAllByRole('listitem');
  const locked = within(screen.getByRole('list', { name: '草稿原保留項目' })).getAllByRole('listitem');
  expect(selected[0].textContent).toContain('第 2 項 · 同名讀書'); expect(selected[0].textContent).toContain('2030-11-04 23:00 – 2030-11-05 01:00');
  expect(locked[0].textContent).toContain('第 1 項 · 同名讀書');
  expect(screen.getByText('提前')).toBeTruthy(); expect(screen.getByText('45')).toBeTruthy();
  expect(screen.getByText(/否則只帶回方向與分鐘，須重新勾選/)).toBeTruthy();
  expect(document.querySelector('input, select, textarea, form')).toBeNull();
  const discard = screen.getByRole('button', { name: '捨棄平移草稿' }); discard.focus();
  view.rerender(<AssistantShiftPlanDraftRecovery {...callbacks} restored status="內容已恢復。" />);
  expect(document.activeElement).toBe(discard);
});

it('keeps the six-field source snapshot collapsed until requested, including optional and all-day semantics', () => {
  render(<AssistantShiftPlanDraftRecovery {...props()} restored />);
  const summary = screen.getByText('原提議內容（僅供核對）');
  expect((summary.closest('details') as HTMLDetailsElement).open).toBe(false); fireEvent.click(summary);
  expect((summary.closest('details') as HTMLDetailsElement).open).toBe(true);
  const rows = within(screen.getByRole('list', { name: '平移草稿的原提議內容' })).getAllByRole('listitem');
  expect(rows).toHaveLength(3);
  expect(within(rows[0]).getAllByRole('definition').map(node => node.textContent)).toEqual(['同名讀書', '2030-11-04', '未另設', '否', '20:00', '21:00']);
  expect(within(rows[2]).getByText('結束日期（不含當日）')).toBeTruthy();
  expect(within(rows[2]).getAllByRole('definition').map(node => node.textContent)).toEqual(['全天活動', '2030-11-05', '2030-11-07', '是', '未設定', '未設定']);
});

it('shows blank or invalid minutes literally without granting validity or rendering markup', () => {
  const callbacks = props();
  const view = render(<AssistantShiftPlanDraftRecovery {...callbacks} restored draft={{ ...callbacks.draft, minutes: '' }} />);
  expect(screen.getByText('未填')).toBeTruthy();
  const raw = '<img src=x onerror=alert(1)>';
  view.rerender(<AssistantShiftPlanDraftRecovery {...callbacks} restored draft={{ ...callbacks.draft, minutes: raw, selectedIndices: [], protectedIndices: [] }} />);
  expect(screen.getByText(raw)).toBeTruthy(); expect(view.container.querySelector('img, script')).toBeNull();
  expect(screen.getByText('草稿當時沒有選取項目。')).toBeTruthy();
  expect(screen.getByText('草稿當時沒有保留原樣項目。')).toBeTruthy();
  expect(screen.getByText(/空白或無效內容仍須修正後才能預覽/)).toBeTruthy();
  expect(view.container.textContent).not.toContain('PRIVATE_');
});

it('allows only explicit recovery or discard while blocked, with no application or transaction controls', () => {
  const callbacks = props(), view = render(<AssistantShiftPlanDraftRecovery {...callbacks} blocked />);
  fireEvent.click(screen.getByRole('button', { name: '恢復平移草稿' }));
  expect(callbacks.onRestore).toHaveBeenCalledExactlyOnceWith();
  view.rerender(<AssistantShiftPlanDraftRecovery {...callbacks} restored blocked />);
  expect(screen.getByText(/目前不能套用或預覽/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: /預覽|套用|確認/ })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '捨棄平移草稿' }));
  expect(callbacks.onDiscard).toHaveBeenCalledExactlyOnceWith();
  expect(screen.getByText(/不會授權、復活確認卡、送給模型或送出行程操作/)).toBeTruthy();
});

it('hides the whole recovered offer when the owner expires it after 31 minutes, without renewing or dispatching', () => {
  const callbacks = props(), view = render(<AssistantShiftPlanDraftRecovery {...callbacks} restored />);
  // The storage/hook owns the TTL; this UI verifies that an expired/null offer exposes no old content.
  view.rerender(<AssistantShiftPlanDraftRecovery {...callbacks} draft={null} restored status="平移草稿已超過 30 分鐘。" />);
  expect(screen.getByRole('status').textContent).toContain('已超過 30 分鐘');
  expect(screen.queryByRole('region')).toBeNull(); expect(screen.queryByRole('button')).toBeNull();
  expect(screen.queryByText('同名讀書')).toBeNull();
  view.rerender(<AssistantShiftPlanDraftRecovery {...callbacks} draft={null} />);
  expect(view.container.textContent).toBe('');
  expect(callbacks.onRestore).not.toHaveBeenCalled(); expect(callbacks.onDiscard).not.toHaveBeenCalled();
});
