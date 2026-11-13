import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { createAssistantCalendarReceipt } from '@campus/shared/src/assistantExecution';
import type { AssistantCourseworkFollowup } from '@campus/shared/src/assistantCourseworkFollowup';
import type { V2ActionState, V2Card, V2Reply } from '@/features/nuni/assistant/types';
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

function followup(overrides: Partial<AssistantCourseworkFollowup> = {}): AssistantCourseworkFollowup {
  return {
    version: 1,
    operation: 'coursework.followup',
    schoolId: card.schoolId,
    mutationId: card.mutationId,
    checkedAt: '2026-11-13T00:05:00.000Z',
    status: 'scheduled',
    task: { workspaceId: 'database-course', taskId: 'one', kind: 'assignment' },
    source: { title: '作業 one', courseName: '資料庫系統', dueAt: '2026-11-13T23:59:00+08:00', state: 'open', submitted: false },
    calendar: 'matching',
    event: { title: '準備：資料庫作業', date: '2026-11-13', startTime: '10:10', endTime: '10:40', allDay: false },
    ...overrides,
  };
}

function verified(): V2ActionState {
  return {
    status: 'verified',
    local: 'ready',
    receipt: createAssistantCalendarReceipt({
      schoolId: card.schoolId, mutationId: card.mutationId, event: card.args, storage: 'synced',
      revision: 3, verifiedAt: '2026-11-13T00:01:00.000Z',
      record: {
        ...card.args, id: card.mutationId, batchId: card.mutationId, kind: 'events',
        schoolId: card.schoolId, academicYear: '', semester: '', importedAt: '2026-11-13T00:00:00.000Z',
        source: { type: 'paste', line: 1, rawText: '' },
      },
    }),
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

it('shows an existing arrangement beside its exact source task without matching another task by title', () => {
  const sameTitle = { ...task('other'), title: '作業 one', href: 'https://untrusted.invalid' };
  const input = props({ tasks: [task('one'), sameTitle], followups: [followup()] });
  render(<TodayAgentPanel {...input} />);
  const tracking = screen.getByRole('group', { name: '「作業 one」的安排追蹤' });
  expect(within(tracking).getByText('已安排')).toBeTruthy();
  expect(within(tracking).getByRole('link', { name: '查看「作業 one」的行程' }).getAttribute('href'))
    .toBe('/calendar?schoolId=pu&eventId=planned-event-1');
  expect(within(tracking).getByRole('link', { name: '查看「作業 one」的作業' }).getAttribute('href'))
    .toBe('/classroom/course/database-course#assignment-one');
  const planButtons = screen.getAllByRole('button', { name: '替「作業 one」找 30 分鐘準備時間' });
  expect(planButtons).toHaveLength(1);
  fireEvent.click(planButtons[0]);
  expect(input.onPlan).toHaveBeenCalledExactlyOnceWith(sameTitle);
  expect(screen.queryByLabelText('這次代辦結果')).toBeNull();
});

it('keeps failed follow-ups linked to the original task and never offers another arrangement for it', () => {
  render(<TodayAgentPanel {...props({ followups: [followup({
    status: 'unavailable', source: null, calendar: 'unavailable',
  })] })} />);
  expect(screen.getByText('最新狀態尚未確認')).toBeTruthy();
  expect(screen.getByText(/先保留上次安排/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: /找 30 分鐘準備時間/ })).toBeNull();
  expect(screen.queryByText('已安排')).toBeNull();
  expect(screen.queryByText('作業已繳交')).toBeNull();
  expect(screen.getByRole('link', { name: '查看「準備：資料庫作業」的作業' }).getAttribute('href'))
    .toBe('/classroom/course/database-course#assignment-one');
});

it('distinguishes unread coursework from an unconfirmed preparation window after the source and original event were read', () => {
  const input = props({ followups: [followup({ status: 'unavailable', calendar: 'matching', source: null })] });
  const view = render(<TodayAgentPanel {...input} />);
  expect(screen.getByText('已核對原行程，作業資料暫時讀不到。')).toBeTruthy();
  view.rerender(<TodayAgentPanel {...input} followups={[followup({ status: 'unavailable', calendar: 'matching' })]} />);
  expect(screen.getByText('作業與原行程已核對，準備時段仍待確認。')).toBeTruthy();
  expect(screen.queryByText(/作業資料暫時讀不到/)).toBeNull();
  expect(screen.queryByRole('button', { name: /找 30 分鐘準備時間/ })).toBeNull();
});

it.each([
  ['submitted', 'changed', '作業已繳交', '原行程有變更，目前內容請以行事曆為準。'],
  ['submitted', 'missing', '作業已繳交', '目前查不到原行程，請查看行事曆確認。'],
  ['closed', 'changed', '作業已停止收件', '原行程有變更，目前內容請以行事曆為準。'],
  ['closed', 'missing', '作業已停止收件', '目前查不到原行程，請查看行事曆確認。'],
] as const)('keeps calendar attention visible for %s coursework when its original event is %s', (status, calendar, label, note) => {
  const source = followup().source!;
  render(<TodayAgentPanel {...props({ tasks: [], followups: [followup({ status, calendar,
    source: { ...source, submitted: status === 'submitted', state: status === 'closed' ? 'closed' : 'open' },
  })] })} />);
  const disclosure = screen.getByText('最近安排（1）').closest('details')!;
  expect(within(disclosure).getByText('需要確認 1 件')).toBeTruthy();
  fireEvent.click(disclosure.querySelector('summary')!);
  const tracking = within(disclosure).getByRole('group', { name: '「作業 one」的安排追蹤' });
  expect(within(tracking).getByText(label)).toBeTruthy();
  expect(within(tracking).getByText(note)).toBeTruthy();
  expect(tracking.getAttribute('data-attention')).toBe('true');
  expect(within(tracking).getByRole('link', { name: '查看「作業 one」的行程' }).getAttribute('href'))
    .toBe('/calendar?schoolId=pu&eventId=planned-event-1');
  expect(screen.queryByRole('button', { name: /找 30 分鐘準備時間|確認|重新安排/ })).toBeNull();
});

it('retains an arrangement outside the first three pending tasks in a compact disclosure', () => {
  const source = followup().source!;
  render(<TodayAgentPanel {...props({
    tasks: [task('first', '2026-11-13T09:00:00+08:00'), task('second', '2026-11-13T10:00:00+08:00'),
      task('third', '2026-11-13T11:00:00+08:00'), task('one', '2026-11-14T23:59:00+08:00')],
    followups: [followup({ status: 'source_changed', source: { ...source, dueAt: '2026-11-15T23:59:00+08:00' } })],
  })} />);
  const disclosure = screen.getByText('最近安排（1）').closest('details')!;
  expect(disclosure.open).toBe(false);
  expect(within(disclosure).getByText('需要確認 1 件')).toBeTruthy();
  fireEvent.click(disclosure.querySelector('summary')!);
  expect(disclosure.open).toBe(true);
  expect(within(disclosure).getByRole('group', { name: '「作業 one」的安排追蹤' })).toBeTruthy();
  expect(within(disclosure).getByText('作業內容或期限有變更')).toBeTruthy();
  expect(within(disclosure).getByText(/目前期限：2026\/11\/15/)).toBeTruthy();
});

it('does not turn elapsed preparation time into a submitted assignment', () => {
  const input = props({ followups: [followup({ status: 'elapsed' })] });
  const view = render(<TodayAgentPanel {...input} />);
  expect(screen.getByText('準備時間已結束')).toBeTruthy();
  expect(screen.getByText('作業仍待繳交。')).toBeTruthy();
  expect(screen.queryByText('作業已繳交')).toBeNull();
  expect(screen.queryByRole('button', { name: /找 30 分鐘準備時間/ })).toBeNull();
  view.rerender(<TodayAgentPanel {...input} followups={[followup({
    status: 'submitted', source: { ...followup().source!, submitted: true },
  })]} />);
  expect(screen.getByText('作業已繳交')).toBeTruthy();
  expect(screen.queryByText('作業仍待繳交。')).toBeNull();
});

it('shows changed or missing calendar evidence without inventing a replacement operation', () => {
  const input = props({ followups: [followup({ status: 'event_changed', calendar: 'changed' })] });
  const view = render(<TodayAgentPanel {...input} />);
  expect(screen.getByText('原行程有變更')).toBeTruthy();
  expect(screen.getByText(/原準備時間：11月13日/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: /找 30 分鐘|確認|重新安排/ })).toBeNull();
  view.rerender(<TodayAgentPanel {...input} followups={[followup({ status: 'event_missing', calendar: 'missing' })]} />);
  expect(screen.getByText('目前查不到原行程')).toBeTruthy();
  expect(screen.getByRole('link', { name: '查看「作業 one」的行程' }).getAttribute('href'))
    .toBe('/calendar?schoolId=pu&eventId=planned-event-1');
  expect(input.onPlan).not.toHaveBeenCalled();
  expect(input.onConfirm).not.toHaveBeenCalled();
});

it('compacts a verified receipt only after a matching follow-up exists', () => {
  const input = props({ reply, states: { [card.mutationId]: verified() } });
  const view = render(<TodayAgentPanel {...input} />);
  expect(screen.getByLabelText('行程執行回執')).toBeTruthy();
  view.rerender(<TodayAgentPanel {...input} followups={[followup()]} />);
  expect(screen.queryByLabelText('行程執行回執')).toBeNull();
  expect(screen.queryByLabelText('這次代辦結果')).toBeNull();
  expect(screen.getByRole('status').textContent).toContain('已儲存並核對的 1 筆安排');
  expect(screen.getByText('已安排')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /找 30 分鐘準備時間/ })).toBeNull();
});

it('does not hide uncertain execution or a receipt with a mismatching follow-up', () => {
  const input = props({ reply, states: { [card.mutationId]: verified() } });
  const view = render(<TodayAgentPanel {...input} followups={[followup({ schoolId: 'another-school' })]} />);
  expect(screen.getByLabelText('行程執行回執')).toBeTruthy();
  view.rerender(<TodayAgentPanel {...input} followups={[followup({
    event: { ...followup().event, startTime: '11:00', endTime: '11:30' },
  })]} />);
  expect(screen.getByLabelText('行程執行回執')).toBeTruthy();
  view.rerender(<TodayAgentPanel {...input} followups={[followup({
    status: 'unavailable', source: null, calendar: 'matching',
  })]} />);
  expect(screen.getByLabelText('行程執行回執')).toBeTruthy();
  view.rerender(<TodayAgentPanel {...input} followups={[followup({
    status: 'event_missing', calendar: 'missing',
  })]} />);
  expect(screen.getByLabelText('行程執行回執')).toBeTruthy();
  view.rerender(<TodayAgentPanel {...input} followups={[followup()]} states={{
    [card.mutationId]: { status: 'unknown', message: '執行結果尚未核對' },
  }} />);
  expect(screen.getByLabelText('這次代辦結果')).toBeTruthy();
  expect(screen.getByRole('button', { name: '重新核對結果' })).toBeTruthy();
  expect(screen.queryByText(/已儲存並核對的/)).toBeNull();
});

it('keeps device recovery and receipt warnings visible even when a follow-up matches the original event', () => {
  const state = verified();
  if (state.status !== 'verified') throw new Error('The fixture must be verified.');
  const input = props({ reply, followups: [followup()], states: {
    [card.mutationId]: { ...state, local: 'unavailable', localMessage: '裝置尚未更新' },
  } });
  const view = render(<TodayAgentPanel {...input} />);
  expect(screen.getByLabelText('行程執行回執')).toBeTruthy();
  expect(screen.getByRole('button', { name: '重新核對並更新此裝置' })).toBeTruthy();
  view.rerender(<TodayAgentPanel {...input} states={{
    [card.mutationId]: { ...state, verificationWarning: '最新回執與原提議不符，保留前次核對結果' },
  }} />);
  expect(screen.getByLabelText('行程執行回執')).toBeTruthy();
  expect(screen.getByText('最新回執與原提議不符，保留前次核對結果')).toBeTruthy();
  expect(screen.queryByText(/已儲存並核對的/)).toBeNull();
});

it('preserves the original cancellation index when earlier verified cards become compact tracking rows', () => {
  const later: V2Card = {
    ...card, mutationId: 'planned-event-2', token: 'second-signed-confirmation',
    args: { ...card.args, title: '第二份準備安排', startTime: '12:10', endTime: '12:40' },
  };
  const input = props({ reply: { ...reply, cards: [card, later] },
    states: { [card.mutationId]: verified() }, followups: [followup()] });
  render(<TodayAgentPanel {...input} />);
  expect(screen.getAllByRole('article', { name: '行程確認卡' })).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  expect(input.onCancel).toHaveBeenCalledExactlyOnceWith(1);
  fireEvent.click(screen.getByRole('button', { name: '確認' }));
  expect(input.onConfirm).toHaveBeenCalledExactlyOnceWith([later]);
});

it('offers a keyboard-focusable refresh which only checks tracked arrangements and blocks overlapping checks', () => {
  const onRefreshFollowups = vi.fn();
  const input = props({ followups: [followup()], onRefreshFollowups });
  const view = render(<TodayAgentPanel {...input} />);
  const refresh = screen.getByRole('button', { name: '更新安排狀態' });
  refresh.focus();
  expect(document.activeElement).toBe(refresh);
  fireEvent.click(refresh);
  expect(onRefreshFollowups).toHaveBeenCalledOnce();
  expect(input.onPlan).not.toHaveBeenCalled();
  expect(input.onConfirm).not.toHaveBeenCalled();
  view.rerender(<TodayAgentPanel {...input} tracking pending="followup" />);
  expect((screen.getByRole('button', { name: '更新安排狀態' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '更新安排狀態' }));
  expect(onRefreshFollowups).toHaveBeenCalledOnce();
  expect(screen.getByRole('status').textContent).toContain('正在核對已安排');
});

it('keeps follow-up recovery usable while new plans are blocked by an incomplete tracking read', () => {
  const onRefreshFollowups = vi.fn();
  const input = props({ tasks: [task('one'), task('another')], followups: [followup({
    status: 'unavailable', source: null, calendar: 'unavailable',
  })], planningBlocked: true, error: '部分已安排事項暫時無法核對', onRefreshFollowups });
  render(<TodayAgentPanel {...input} />);
  expect((screen.getByRole('button', { name: '替「作業 another」找 30 分鐘準備時間' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByText('正在核對這台裝置保留的安排…')).toBeNull();
  const refresh = screen.getByRole('button', { name: '更新安排狀態' });
  expect((refresh as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(refresh);
  expect(onRefreshFollowups).toHaveBeenCalledOnce();
  expect(input.onPlan).not.toHaveBeenCalled();
});
