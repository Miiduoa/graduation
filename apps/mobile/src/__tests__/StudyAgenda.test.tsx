import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import type { NuniStudyAgenda, NuniStudyTask } from '@campus/shared/src/nuniStudyAgenda';
import { StudyAgenda } from '../screens/nuni/StudyAgenda';
import { NuniDraftProvider } from '../state/nuniDrafts';

jest.mock('../state/theme', () => ({ useTheme: () => require('../ui/theme').theme }));

const task = (id: string, overrides: Partial<NuniStudyTask> = {}): NuniStudyTask => ({
  id,
  courseId: 'course',
  courseTitle: '資料庫',
  title: `作業 ${id}`,
  kind: 'assignment',
  state: 'open',
  dueAt: null,
  submittedAt: null,
  feedback: null,
  reviewedAt: null,
  ...overrides,
});
const agenda = (
  tasks: NuniStudyTask[],
  overrides: Partial<NuniStudyAgenda> = {},
): NuniStudyAgenda => ({
  tasks,
  workspaces: [],
  studiedCourseCount: 1,
  failedCourseIds: [],
  limitedCourseIds: [],
  ...overrides,
});

it('opens overdue but still accepted work without falsely calling it closed', () => {
  const open = jest.fn();
  const view = render(
    <StudyAgenda
      data={agenda([task('past', { dueAt: '2020-01-01T00:00:00Z' })])}
      loading={false}
      error=""
      retry={jest.fn()}
      open={open}
    />,
  );
  expect(view.getByText('參考期限已過 · 仍可繳交')).toBeTruthy();
  fireEvent.press(view.getByRole('button', { name: '開啟作業：作業 past' }));
  expect(open).toHaveBeenCalledWith('course', 'past');
});

it('separates closed unfinished work from confirmed submissions', () => {
  const view = render(
    <StudyAgenda
      data={agenda([
        task('closed', { state: 'closed' }),
        task('sent', { state: 'closed', submittedAt: '2026-10-20T00:00:00Z' }),
      ])}
      loading={false}
      error=""
      retry={jest.fn()}
      open={jest.fn()}
    />,
  );
  fireEvent.press(view.getByRole('button', { name: '已停止收件 1' }));
  expect(view.getByText('作業 closed')).toBeTruthy();
  expect(view.queryByText('作業 sent')).toBeNull();
  fireEvent.press(view.getByRole('button', { name: '已有繳交紀錄 1' }));
  expect(view.getByText('作業 sent')).toBeTruthy();
  expect(view.queryByText('作業 closed')).toBeNull();
});

it('does not claim all work is done when a course request failed or reached its limit', () => {
  const retry = jest.fn();
  const view = render(
    <StudyAgenda
      data={agenda([], { failedCourseIds: ['course'], limitedCourseIds: ['course'] })}
      loading={false}
      error=""
      retry={retry}
      open={jest.fn()}
    />,
  );
  expect(view.getByText('已載入的內容中沒有這類項目，其他課程仍待確認。')).toBeTruthy();
  expect(view.queryByText('目前沒有待完成項目。可以從下方課程繼續閱讀教材。')).toBeNull();
  fireEvent.press(view.getByRole('button', { name: '重新讀取待辦' }));
  expect(retry).toHaveBeenCalledTimes(1);
});

it('limits the initial task list and reveals more without losing earlier rows', () => {
  const tasks = Array.from({ length: 10 }, (_, index) => task(String(index)));
  const view = render(
    <StudyAgenda
      data={agenda(tasks)}
      loading={false}
      error=""
      retry={jest.fn()}
      open={jest.fn()}
    />,
  );
  expect(view.getAllByRole('button', { name: /^開啟作業/ })).toHaveLength(8);
  fireEvent.press(view.getByRole('button', { name: '再顯示 2 項' }));
  expect(view.getAllByRole('button', { name: /^開啟作業/ })).toHaveLength(10);
  expect(view.queryByRole('button', { name: /^再顯示/ })).toBeNull();
});

it('identifies feedback from a previous submission instead of calling the revision reviewed', () => {
  const view = render(
    <StudyAgenda
      data={agenda([
        task('revision', {
          submittedAt: '2026-10-22T00:00:00Z',
          feedback: '請補充',
          reviewedAt: '2026-10-21T00:00:00Z',
        }),
      ])}
      loading={false}
      error=""
      retry={jest.fn()}
      open={jest.fn()}
    />,
  );
  fireEvent.press(view.getByRole('button', { name: '已有繳交紀錄 1' }));
  expect(view.getByText('已繳交 · 有較早版本的回饋')).toBeTruthy();
});

it('filters upcoming deadlines, overdue work, and teacher feedback without opening every course', () => {
  const now = Date.now();
  const view = render(
    <StudyAgenda
      data={agenda([
        task('soon', { dueAt: new Date(now + 2 * 86400000).toISOString() }),
        task('later', { dueAt: new Date(now + 12 * 86400000).toISOString() }),
        task('past', { dueAt: new Date(now - 2 * 86400000).toISOString() }),
        task('reviewed', {
          submittedAt: '2026-10-20T09:00:00Z',
          reviewedAt: '2026-10-21T09:00:00Z',
          feedback: '批閱完成',
        }),
      ])}
      loading={false}
      error=""
      retry={jest.fn()}
      open={jest.fn()}
    />,
  );
  fireEvent.press(view.getByRole('button', { name: '未來七天 1' }));
  expect(view.getByText('作業 soon')).toBeTruthy();
  expect(view.queryByText('作業 past')).toBeNull();
  expect(view.queryByText('作業 later')).toBeNull();
  fireEvent.press(view.getByRole('button', { name: '老師回饋 1' }));
  expect(view.getByText('作業 reviewed')).toBeTruthy();
  expect(view.queryByText('作業 soon')).toBeNull();
  fireEvent.press(view.getByRole('button', { name: '已過建議時間 1' }));
  expect(view.getByText('作業 past')).toBeTruthy();
  fireEvent.press(view.getByRole('button', { name: '全部 4' }));
  expect(view.getAllByRole('button', { name: /^開啟作業/ })).toHaveLength(4);
});

it('scopes partial counts and warnings to a selected course', () => {
  const workspaces = [
    { id: 'first', title: '資料庫', state: 'active', memberRole: 'student' },
    { id: 'second', title: '網路通訊', state: 'active', memberRole: 'student' },
  ] as NuniStudyAgenda['workspaces'];
  const view = render(
    <StudyAgenda
      data={agenda(
        [
          task('a', { courseId: 'first' }),
          task('b', { courseId: 'second', courseTitle: '網路通訊' }),
        ],
        { workspaces, studiedCourseCount: 2, failedCourseIds: ['first'] },
      )}
      loading={false}
      error=""
      retry={jest.fn()}
      open={jest.fn()}
    />,
  );
  expect(view.getByText(/有 1 門課程尚未完整載入/)).toBeTruthy();
  fireEvent.press(view.getByRole('button', { name: '篩選課程：網路通訊' }));
  expect(view.getByText('作業 b')).toBeTruthy();
  expect(view.queryByText('作業 a')).toBeNull();
  expect(view.queryByText(/門課程尚未完整載入/)).toBeNull();
  expect(view.getByRole('button', { name: '待完成 1' })).toBeTruthy();
  fireEvent.press(view.getByRole('button', { name: '篩選課程：所有課程' }));
  expect(view.getByRole('button', { name: '待完成 2+' })).toBeTruthy();
});

it('distinguishes closed unanswered quizzes from unsubmitted assignments', () => {
  const view = render(
    <StudyAgenda
      data={agenda([task('quiz', { kind: 'quiz', state: 'closed' })])}
      loading={false}
      error=""
      retry={jest.fn()}
      open={jest.fn()}
    />,
  );
  fireEvent.press(view.getByRole('button', { name: '已停止收件 1' }));
  expect(view.getByText('已結束 · 未作答')).toBeTruthy();
});

it('preserves the selected agenda filter when navigating away and returning', () => {
  const cache = new Map<string, unknown>();
  const data = agenda([
    task('pending'),
    task('reviewed', {
      submittedAt: '2026-10-20T09:00:00Z',
      reviewedAt: '2026-10-21T09:00:00Z',
      feedback: '批閱完成',
    }),
  ]);
  const content = (
    <NuniDraftProvider cache={cache}>
      <StudyAgenda data={data} loading={false} error="" retry={jest.fn()} open={jest.fn()} />
    </NuniDraftProvider>
  );
  const first = render(content);
  fireEvent.press(first.getByRole('button', { name: '老師回饋 1' }));
  first.unmount();
  const second = render(content);
  expect(second.getByText('作業 reviewed')).toBeTruthy();
  expect(second.queryByText('作業 pending')).toBeNull();
});

it('does not call an overdue but still open quiz a submission', () => {
  const view = render(
    <StudyAgenda
      data={agenda([task('late-quiz', { kind: 'quiz', dueAt: '2020-01-01T00:00:00Z' })])}
      loading={false}
      error=""
      retry={jest.fn()}
      open={jest.fn()}
    />,
  );
  expect(view.getByText('參考期限已過 · 仍可作答')).toBeTruthy();
});

it('guides an empty account to join a course', () => {
  const view = render(
    <StudyAgenda
      data={agenda([], { studiedCourseCount: 0 })}
      loading={false}
      error=""
      retry={jest.fn()}
      open={jest.fn()}
    />,
  );
  expect(
    view.getByText('還沒加入 nuni 課程。請到下方課程區輸入邀請碼，加入後就能看到作業與測驗。'),
  ).toBeTruthy();
});
