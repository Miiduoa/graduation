import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { NuniWorkspace } from '@campus/shared/src/nuni';
import type { NuniStudyAgenda, NuniStudyTask } from '@campus/shared/src/nuniStudyAgenda';
import { StudyAgenda } from './StudyAgenda';
import type { StudyAgendaFilter } from './studyNavigation';

const state = vi.hoisted(() => ({ load: vi.fn(), refresh: vi.fn(), request: vi.fn() }));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
vi.mock('@campus/shared/src/nuniStudyAgenda', async () => ({
  ...(await vi.importActual<typeof import('@campus/shared/src/nuniStudyAgenda')>(
    '@campus/shared/src/nuniStudyAgenda',
  )),
  loadNuniStudyAgenda: state.load,
}));
vi.mock('./Session', () => ({
  browserRequest: state.request,
  useNuniSession: () => ({
    session: {
      context: 'session-a',
      platformAccountId: 'pa_11111111-1111-4111-8111-111111111111',
    },
    refresh: state.refresh,
    pendingLogout: false,
  }),
}));
vi.mock('@/lib/useMaterialClientState', () => ({
  useClientNow: () => Date.parse('2026-10-25T12:00:00+08:00'),
}));

const memberships: NuniWorkspace[] = [
  {
    id: 'cw_11111111-1111-4111-8111-111111111111',
    title: '資料庫系統',
    state: 'active',
    memberRole: 'student',
  },
];

function task(index: number, extra: Partial<NuniStudyTask> = {}): NuniStudyTask {
  return {
    id: `cwa_00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    kind: 'assignment',
    courseId: memberships[0].id,
    courseTitle: memberships[0].title,
    title: `學習任務 ${index}`,
    dueAt: '2026-10-26T19:00:00+08:00',
    state: 'open',
    submittedAt: null,
    feedback: null,
    reviewedAt: null,
    ...extra,
  };
}

function agenda(tasks: NuniStudyTask[], extra: Partial<NuniStudyAgenda> = {}): NuniStudyAgenda {
  return {
    tasks,
    workspaces: memberships,
    studiedCourseCount: 1,
    failedCourseIds: [],
    limitedCourseIds: [],
    ...extra,
  };
}

function Harness({
  workspaces = memberships,
  context = '',
}: {
  workspaces?: NuniWorkspace[];
  context?: string;
}) {
  const [filter, setFilter] = useState<StudyAgendaFilter>('pending');
  return (
    <StudyAgenda workspaces={workspaces} filter={filter} onFilter={setFilter} context={context} />
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  window.history.replaceState({}, '', '/classroom');
  state.load.mockReset().mockResolvedValue(agenda([]));
  state.refresh.mockReset();
  state.request.mockReset();
});

it('starts with pending work and separates latest feedback, submitted receipts and closed work', async () => {
  state.load.mockResolvedValue(
    agenda([
      task(1, { title: '仍可補交', dueAt: '2026-10-20T19:00:00+08:00' }),
      task(2, { title: '已停止的任務', state: 'closed' }),
      task(3, {
        title: '已有本次回饋',
        submittedAt: '2026-10-24T10:00:00+08:00',
        reviewedAt: '2026-10-25T10:00:00+08:00',
        feedback: '這次資料來源完整。',
      }),
      task(4, {
        title: '回饋後已重交',
        submittedAt: '2026-10-25T11:00:00+08:00',
        reviewedAt: '2026-10-24T09:00:00+08:00',
        feedback: '這是上一稿的回饋。',
      }),
    ]),
  );
  render(<Harness />);
  await screen.findByRole('link', { name: '仍可補交' });
  expect(screen.queryByRole('link', { name: '已停止的任務' })).toBeNull();
  expect(screen.queryByRole('link', { name: '已有本次回饋' })).toBeNull();
  expect(screen.getByRole('link', { name: '前往繳交：仍可補交' })).toBeTruthy();
  const metrics = within(screen.getByRole('group', { name: '待辦快速篩選' }));
  fireEvent.click(metrics.getByRole('button', { name: /老師回饋/ }));
  expect(screen.getByRole('link', { name: '已有本次回饋' })).toBeTruthy();
  expect(screen.queryByRole('link', { name: '回饋後已重交' })).toBeNull();
  expect(screen.getByText('這次資料來源完整。')).toBeTruthy();
  const filters = within(screen.getByRole('group', { name: '篩選課業待辦' }));
  fireEvent.click(filters.getByRole('button', { name: '已繳交／作答' }));
  expect(screen.getByRole('link', { name: '回饋後已重交' })).toBeTruthy();
  expect(screen.queryByText('這是上一稿的回饋。')).toBeNull();
  fireEvent.click(filters.getByRole('button', { name: '已停止收件' }));
  expect(screen.getByRole('link', { name: '已停止的任務' })).toBeTruthy();
  expect(screen.queryByRole('link', { name: '已有本次回饋' })).toBeNull();
});

it('does not claim all work is finished after a partially failed empty load and offers retry', async () => {
  state.load.mockResolvedValue(agenda([], { failedCourseIds: [memberships[0].id] }));
  render(<Harness />);
  await screen.findByText(/有 1 門課未能完整讀取/);
  expect(screen.getByRole('heading', { name: '已載入的項目中沒有符合的待辦' })).toBeTruthy();
  expect(screen.queryByRole('heading', { name: '目前沒有待完成的項目' })).toBeNull();
  const summary = screen.getByRole('group', { name: '待辦快速篩選' });
  expect(within(summary).getByRole('button', { name: /待完成/ }).textContent).toContain('0+');
  state.load.mockResolvedValueOnce(agenda([task(1)]));
  fireEvent.click(screen.getByRole('button', { name: '重試' }));
  await screen.findByRole('link', { name: '學習任務 1' });
  expect(state.load).toHaveBeenCalledTimes(2);
  expect(screen.queryByText(/有 1 門課未能完整讀取/)).toBeNull();
});

it('labels source caps as incomplete counts instead of a complete todo total', async () => {
  state.load.mockResolvedValue(agenda([task(1)], { limitedCourseIds: [memberships[0].id] }));
  render(<Harness />);
  await screen.findByRole('link', { name: '學習任務 1' });
  expect(screen.getByText(/有 1 門課達到目前的顯示上限/)).toBeTruthy();
  expect(screen.getByText('顯示 1 / 1 項（已載入）')).toBeTruthy();
  const summary = screen.getByRole('group', { name: '待辦快速篩選' });
  expect(within(summary).getByRole('button', { name: /待完成/ }).textContent).toContain('1+');
});

it('links each task to its own panel and anchor while preserving campus and directory context', async () => {
  const assignment = task(1);
  const quiz = task(2, { id: 'cwq_00000000-0000-4000-8000-000000000002', kind: 'quiz' });
  state.load.mockResolvedValue(agenda([assignment, quiz]));
  const context = new URLSearchParams({
    campus: 'tw-pu',
    q: '資料庫',
    courses: 'studying',
    task: 'pending',
    view: 'materials',
    unexpected: 'do-not-copy',
  }).toString();
  render(<Harness context={context} />);
  await screen.findByRole('link', { name: assignment.title });
  for (const item of [assignment, quiz]) {
    const title = screen.getByRole('link', { name: item.title });
    const destination = new URL(title.getAttribute('href')!, window.location.origin);
    expect(destination.pathname).toBe(`/classroom/course/${memberships[0].id}`);
    expect(Object.fromEntries(destination.searchParams)).toMatchObject({
      campus: 'tw-pu',
      q: '資料庫',
      courses: 'studying',
      task: 'pending',
      view: item.kind === 'assignment' ? 'assignments' : 'quizzes',
    });
    expect(destination.hash).toBe(`#${item.kind}-${item.id}`);
    expect(destination.searchParams.has('unexpected')).toBe(false);
  }
});

it('shows six tasks initially, expands the remaining work, and can collapse without refetching', async () => {
  state.load.mockResolvedValue(agenda(Array.from({ length: 8 }, (_, index) => task(index + 1))));
  render(<Harness />);
  await screen.findByText('顯示 6 / 8 項');
  expect(screen.getAllByRole('listitem')).toHaveLength(6);
  fireEvent.click(screen.getByRole('button', { name: '再顯示 12 項' }));
  expect(screen.getAllByRole('listitem')).toHaveLength(8);
  expect(screen.getByText('顯示 8 / 8 項')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '收合清單' }));
  expect(screen.getAllByRole('listitem')).toHaveLength(6);
  expect(state.load).toHaveBeenCalledTimes(1);
});

it('restores the task course from the URL and preserves that scope when opening a task', async () => {
  const workspaces: NuniWorkspace[] = [
    ...memberships,
    { ...memberships[0], id: 'cw_22222222-2222-4222-8222-222222222222', title: '網路通訊' },
  ];
  const first = task(1);
  const second = task(2, { courseId: workspaces[1].id, courseTitle: workspaces[1].title });
  window.history.replaceState({}, '', `/classroom?taskCourse=${workspaces[1].id}`);
  state.load.mockResolvedValue(agenda([first, second], { workspaces, studiedCourseCount: 2 }));
  const view = render(<Harness workspaces={workspaces} context="campus=tw-pu" />);
  await screen.findByRole('link', { name: second.title });
  expect(screen.queryByRole('link', { name: first.title })).toBeNull();
  expect((screen.getByRole('combobox', { name: '待辦課程' }) as HTMLSelectElement).value).toBe(
    workspaces[1].id,
  );
  fireEvent.change(screen.getByRole('combobox', { name: '待辦課程' }), {
    target: { value: 'all' },
  });
  expect(screen.getByRole('link', { name: first.title })).toBeTruthy();
  expect(new URLSearchParams(window.location.search).has('taskCourse')).toBe(false);
  fireEvent.change(screen.getByRole('combobox', { name: '待辦課程' }), {
    target: { value: workspaces[0].id },
  });
  const destination = new URL(
    screen.getByRole('link', { name: first.title }).getAttribute('href')!,
    window.location.origin,
  );
  expect(destination.searchParams.get('taskCourse')).toBe(workspaces[0].id);
  expect(destination.searchParams.get('campus')).toBe('tw-pu');
  act(() => {
    window.history.replaceState({}, '', `/classroom?taskCourse=${workspaces[1].id}`);
    view.rerender(<Harness workspaces={workspaces} context="campus=tw-pu" />);
  });
  expect(screen.getByRole('link', { name: second.title })).toBeTruthy();
  expect(screen.queryByRole('link', { name: first.title })).toBeNull();
  expect(state.load).toHaveBeenCalledTimes(1);
});

it('cancels obsolete membership reads and never lets their late responses replace current work', async () => {
  const oldRead = deferred<NuniStudyAgenda>();
  const currentRead = deferred<NuniStudyAgenda>();
  state.load
    .mockImplementationOnce(() => oldRead.promise)
    .mockImplementationOnce(() => currentRead.promise);
  const nextMemberships: NuniWorkspace[] = [
    {
      id: 'cw_22222222-2222-4222-8222-222222222222',
      title: '新的課程',
      state: 'active',
      memberRole: 'student',
    },
  ];
  const view = render(<Harness />);
  const oldFence = state.load.mock.calls[0][2] as { cancelled(): boolean };
  view.rerender(<Harness workspaces={nextMemberships} />);
  expect(oldFence.cancelled()).toBe(true);
  await act(async () => {
    currentRead.resolve(
      agenda([task(2, { courseId: nextMemberships[0].id, title: '目前課程的作業' })], {
        workspaces: nextMemberships,
      }),
    );
  });
  await screen.findByRole('link', { name: '目前課程的作業' });
  await act(async () => {
    oldRead.resolve(agenda([task(1, { title: '過期回應的作業' })]));
  });
  expect(screen.queryByRole('link', { name: '過期回應的作業' })).toBeNull();
  expect(screen.getByRole('link', { name: '目前課程的作業' })).toBeTruthy();
  const currentFence = state.load.mock.calls[1][2] as { cancelled(): boolean };
  view.unmount();
  await waitFor(() => expect(currentFence.cancelled()).toBe(true));
});


it('does not attribute another course loading failure to the selected healthy course', async () => {
  const workspaces: NuniWorkspace[] = [
    ...memberships,
    { ...memberships[0], id: 'cw_22222222-2222-4222-8222-222222222222', title: '網路通訊' },
  ];
  state.load.mockResolvedValue(
    agenda(
      [task(21, { courseId: workspaces[1].id, courseTitle: workspaces[1].title })],
      { workspaces, studiedCourseCount: 2, failedCourseIds: [workspaces[0].id] },
    ),
  );
  render(<Harness workspaces={workspaces} />);
  await screen.findByText(/有 1 門課未能完整讀取/);
  fireEvent.change(screen.getByRole('combobox', { name: '待辦課程' }), {
    target: { value: workspaces[1].id },
  });
  expect(screen.queryByText(/有 1 門課未能完整讀取/)).toBeNull();
  const summary = within(screen.getByRole('group', { name: '待辦快速篩選' }));
  expect(summary.getByRole('button', { name: /待完成/ }).textContent).toContain('1');
  expect(summary.getByRole('button', { name: /待完成/ }).textContent).not.toContain('+');
});
 

it('shows an explainable cross-course focus queue with direct task actions', async () => {
  const overdue = task(31, { title: '仍可處理的逾時作業', dueAt: '2026-10-20T10:00:00+08:00' });
  const quiz = task(32, {
    kind: 'quiz',
    title: '今天的小考',
    id: 'cwq_00000000-0000-4000-8000-000000000032',
    dueAt: '2026-10-25T20:00:00+08:00',
  });
  const completed = task(33, { title: '已經繳交過的作業', submittedAt: '2026-10-24T12:00:00+08:00' });
  state.load.mockResolvedValue(agenda([quiz, completed, overdue]));
  render(<Harness context="campus=tw-pu" />);
  const focus = await screen.findByRole('region', { name: '今日優先課業' });
  const links = within(focus).getAllByRole('link');
  expect(links).toHaveLength(2);
  expect(links[0].getAttribute('aria-label')).toContain(overdue.title);
  expect(links[1].getAttribute('aria-label')).toContain(quiz.title);
  expect(links[0].getAttribute('href')).toContain(`#assignment-${overdue.id}`);
  expect(links[1].getAttribute('href')).toContain(`#quiz-${quiz.id}`);
  expect(focus.textContent).toContain('已過參考時間 · 仍可開啟');
  expect(focus.textContent).not.toContain(completed.title);
});

it('marks a partially loaded recommendation as incomplete rather than a full student plan', async () => {
  state.load.mockResolvedValue(agenda([task(90)], { failedCourseIds: [memberships[0].id] }));
  render(<Harness />);
  const focus = await screen.findByRole('region', { name: '今日優先課業' });
  expect(focus.textContent).toContain('部分課程資料尚未完整');
});

it('exports loaded tasks beyond the visible list and clears export choices after refreshing', async () => {
  state.load.mockResolvedValue(agenda(Array.from({ length: 9 }, (_, index) => task(index + 1))));
  render(<Harness />);
  fireEvent.click(await screen.findByRole('button', { name: '匯出未繳期限 ICS' }));
  expect(screen.getAllByRole('checkbox')).toHaveLength(9);
  fireEvent.click(screen.getAllByRole('checkbox')[8]);
  fireEvent.click(screen.getByRole('button', { name: '預覽已選 1 項' }));
  expect(screen.getByLabelText('期限匯出預覽').textContent).toContain('學習任務 9');
  fireEvent.click(screen.getByRole('button', { name: '更新待辦資料' }));
  await waitFor(() => expect(state.load).toHaveBeenCalledTimes(2));
  fireEvent.click(await screen.findByRole('button', { name: '匯出未繳期限 ICS' }));
  expect(screen.getByRole('button', { name: '預覽已選 0 項' }).hasAttribute('disabled')).toBe(true);
  expect(screen.queryByRole('button', { name: '下載 ICS' })).toBeNull();
});
