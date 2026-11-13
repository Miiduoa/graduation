import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { createAssistantCalendarReceipt } from '@campus/shared/src/assistantExecution';
import type { V2Card, V2Reply } from '@/features/nuni/assistant/types';
import type { HomeTask } from '@/lib/homeOverview';
import { TodayAgentPanel, todayAgentTaskKey, type TodayAgentPanelProps } from './TodayAgentPanel';

const now = new Date('2026-11-13T08:00:00+08:00');

function task(id: string, dueAt = '2026-11-13T23:59:00+08:00'): HomeTask {
  return {
    id,
    kind: 'assignment',
    courseId: 'database-course',
    courseName: '資料庫系統',
    title: `作業 ${id}`,
    dueAt,
    href: `/classroom/course/database-course#assignment-${id}`,
  };
}

const card: V2Card = {
  tool: 'propose_personal_event',
  token: 'signed-confirmation',
  mutationId: 'planned-event-1',
  schoolId: 'pu',
  destination: '個人行事曆',
  args: {
    title: '準備：資料庫作業',
    date: '2026-11-13',
    startTime: '10:10',
    endTime: '10:40',
    allDay: false,
  },
};

const reply: V2Reply = {
  answer: '找到 10:10–10:40 的空檔，確認後加入行事曆。',
  steps: [
    { name: 'coursework', status: 'ok', summary: '已核對這份作業仍未繳交' },
    { name: 'calendar', status: 'ok', summary: '已避開課表與個人行程' },
  ],
  cards: [card],
};

function props(overrides: Partial<TodayAgentPanelProps> = {}): TodayAgentPanelProps {
  return {
    tasks: [task('one')],
    now,
    states: {},
    pending: null,
    onPlan: vi.fn(),
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
    onReconcile: vi.fn(),
    ...overrides,
  };
}

it('surfaces the three nearest valid deadlines without starting a request on mount', () => {
  const first = task('first', '2026-11-13T09:00:00+08:00');
  const second = task('second', '2026-11-13T10:00:00+08:00');
  const third = task('third', '2026-11-13T11:00:00+08:00');
  const fourth = task('fourth', '2026-11-14T12:00:00+08:00');
  const input = props({ tasks: [fourth, task('invalid', 'not-a-date'), third, first, second,
    task('past', '2026-11-13T07:59:00+08:00'), first] });
  render(<TodayAgentPanel {...input} />);
  const list = screen.getByRole('list', { name: '先處理近期截止的事' });
  expect(within(list).getAllByRole('heading', { level: 3 }).map((item) => item.textContent))
    .toEqual(['作業 first', '作業 second', '作業 third']);
  expect(screen.getByText(/其他 1 件可在課程中查看/)).toBeTruthy();
  expect(screen.queryByText('作業 past')).toBeNull();
  expect(screen.queryByText('作業 invalid')).toBeNull();
  expect(input.onPlan).not.toHaveBeenCalled();
  expect(input.onConfirm).not.toHaveBeenCalled();
  fireEvent.click(within(list).getByRole('button', { name: '替「作業 first」找 30 分鐘準備時間' }));
  expect(input.onPlan).toHaveBeenCalledExactlyOnceWith(first);
  expect(screen.getByRole('link', { name: '代辦權限' }).getAttribute('href'))
    .toBe('/settings?section=assistant');
});

it('does not treat an incomplete or failed read as no remaining work', () => {
  const onRetry = vi.fn();
  const view = render(<TodayAgentPanel {...props({ tasks: [], loading: true, onRetry })} />);
  expect(screen.getByRole('status').textContent).toContain('正在讀取');
  expect(screen.queryByText(/沒有待安排/)).toBeNull();
  view.rerender(<TodayAgentPanel {...props({ tasks: [], error: '部分課程尚未讀到', onRetry })} />);
  expect(screen.getByRole('alert').textContent).toBe('部分課程尚未讀到');
  expect(screen.queryByText(/沒有待安排|全部完成/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '重新確認資料' }));
  expect(onRetry).toHaveBeenCalledOnce();
});

it('keeps a new action disabled while planning and while an earlier result is unresolved', () => {
  const first = task('one');
  const input = props({ selectedTaskId: todayAgentTaskKey(first), pending: 'plan' });
  const view = render(<TodayAgentPanel {...input} />);
  const button = screen.getByRole('button', { name: '替「作業 one」找 30 分鐘準備時間' }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  expect(button.textContent).toBe('正在安排…');
  fireEvent.click(button);
  expect(input.onPlan).not.toHaveBeenCalled();
  view.rerender(<TodayAgentPanel {...props({ states: {
    oldAction: { status: 'unknown', message: '原操作還沒確認' },
  } })} />);
  expect((screen.getByRole('button', { name: /找 30 分鐘準備時間/ }) as HTMLButtonElement).disabled).toBe(true);
});

it('shows the exact proposed event and waits for a separate confirmation', () => {
  const input = props({ reply });
  render(<TodayAgentPanel {...input} />);
  expect(screen.getByText('準備：資料庫作業')).toBeTruthy();
  expect(screen.getByText('11月13日（五） · 10:10–10:40')).toBeTruthy();
  expect(screen.getByRole('list', { name: '本次已執行的檢查' }).textContent)
    .toContain('已避開課表與個人行程');
  expect((screen.getByRole('button', { name: /找 30 分鐘準備時間/ }) as HTMLButtonElement).disabled).toBe(true);
  expect(input.onConfirm).not.toHaveBeenCalled();
  expect(screen.queryByText('已核對並加入個人行事曆')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '確認' }));
  expect(input.onConfirm).toHaveBeenCalledExactlyOnceWith([card]);
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  expect(input.onCancel).toHaveBeenCalledExactlyOnceWith(0);
});

it('offers reconciliation of the original card after an uncertain outcome, never another write', () => {
  const input = props({ reply, states: {
    [card.mutationId]: { status: 'unknown', message: '執行結果尚未核對' },
  } });
  render(<TodayAgentPanel {...input} />);
  expect(screen.queryByRole('button', { name: '確認' })).toBeNull();
  expect(screen.queryByRole('button', { name: '重試原確認' })).toBeNull();
  expect(screen.queryByText('已核對並加入個人行事曆')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '重新核對結果' }));
  expect(input.onReconcile).toHaveBeenCalledExactlyOnceWith(card);
  expect(input.onConfirm).not.toHaveBeenCalled();
});

it('links the verified receipt to the actual saved event and enables the next task', () => {
  const receipt = createAssistantCalendarReceipt({
    schoolId: card.schoolId,
    mutationId: card.mutationId,
    event: card.args,
    storage: 'synced',
    revision: 3,
    verifiedAt: '2026-11-13T01:00:00.000Z',
    record: {
      ...card.args,
      id: card.mutationId,
      batchId: card.mutationId,
      kind: 'events',
      schoolId: card.schoolId,
      academicYear: '',
      semester: '',
      importedAt: '2026-11-13T00:59:00.000Z',
      source: { type: 'paste', line: 1, rawText: '' },
    },
  });
  render(<TodayAgentPanel {...props({ reply, states: {
    [card.mutationId]: { status: 'verified', receipt, local: 'ready' },
  } })} />);
  expect(screen.getByText('已核對並加入個人行事曆')).toBeTruthy();
  expect(screen.getByRole('link', { name: '開啟這筆行程' }).getAttribute('href'))
    .toBe('/calendar?schoolId=pu&eventId=planned-event-1');
  expect(screen.queryByRole('button', { name: '確認' })).toBeNull();
  expect((screen.getByRole('button', { name: /找 30 分鐘準備時間/ }) as HTMLButtonElement).disabled).toBe(false);
  expect(screen.queryByText(/作業已完成|作業已繳交/)).toBeNull();
});

it('keeps the original result available when account storage succeeded but this device has not updated', () => {
  const receipt = createAssistantCalendarReceipt({
    schoolId: card.schoolId,
    mutationId: card.mutationId,
    event: card.args,
    storage: 'synced',
    revision: 3,
    verifiedAt: '2026-11-13T01:00:00.000Z',
    record: {
      ...card.args, id: card.mutationId, batchId: card.mutationId, kind: 'events',
      schoolId: card.schoolId, academicYear: '', semester: '',
      importedAt: '2026-11-13T00:59:00.000Z',
      source: { type: 'paste', line: 1, rawText: '' },
    },
  });
  const input = props({ reply, states: {
    [card.mutationId]: { status: 'verified', receipt, local: 'unavailable', localMessage: '裝置暫存尚未核對' },
  } });
  render(<TodayAgentPanel {...input} />);
  expect((screen.getByRole('button', { name: /找 30 分鐘準備時間/ }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByRole('link', { name: '開啟這筆行程' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '重新核對並更新此裝置' }));
  expect(input.onReconcile).toHaveBeenCalledExactlyOnceWith(card);
});

it('renders useful internal recovery links without exposing a raw technical error code', () => {
  render(<TodayAgentPanel {...props({ reply: {
    answer: '請先[開啟助理權限](/settings?section=assistant)，再重新安排。',
    cards: [],
    steps: [{ name: 'plan', status: 'error', summary: 'ASSISTANT_PERMISSION_DENIED' }],
  } })} />);
  expect(screen.getByRole('link', { name: '開啟助理權限' }).getAttribute('href'))
    .toBe('/settings?section=assistant');
  expect(screen.queryByText('ASSISTANT_PERMISSION_DENIED')).toBeNull();
  expect(screen.getByText('這一步尚未完成，請依上方說明處理。')).toBeTruthy();
});

it('does not expose transaction buttons for a different action type', () => {
  render(<TodayAgentPanel {...props({ reply: {
    ...reply,
    cards: [{ ...card, tool: 'propose_food_order' }],
  } })} />);
  expect(screen.getByRole('alert').textContent).toContain('無法核對為個人行程');
  expect(screen.queryByRole('button', { name: '確認' })).toBeNull();
});

it('keeps invalid device time from exposing an actionable or falsely empty state', () => {
  render(<TodayAgentPanel {...props({ now: new Date('invalid') })} />);
  expect(screen.getByRole('status').textContent).toContain('正在讀取');
  expect(screen.queryByRole('button', { name: /找 30 分鐘準備時間/ })).toBeNull();
  expect(screen.queryByText(/沒有待安排/)).toBeNull();
});
