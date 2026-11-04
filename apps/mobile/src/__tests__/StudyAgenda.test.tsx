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

it('clears export selection while refreshing data and excludes confirmed submissions', () => {
  const props = { data: agenda([task('one', { dueAt: '2026-11-02T00:30:00+08:00' })]), loading: false, error: '', retry: jest.fn(), open: jest.fn() };
  const view = render(<StudyAgenda {...props} />);
  fireEvent.press(view.getByRole('button', { name: '匯出未繳期限 ICS' }));
  fireEvent.press(view.getByRole('checkbox'));
  fireEvent.press(view.getByRole('button', { name: '預覽已選 1 項' }));
  view.rerender(<StudyAgenda {...props} loading />);
  expect(view.queryByRole('checkbox')).toBeNull();
  view.rerender(<StudyAgenda {...props} />);
  fireEvent.press(view.getByRole('button', { name: '匯出未繳期限 ICS' }));
  expect(view.getByRole('button', { name: '預覽已選 0 項' }).props.accessibilityState.disabled).toBe(true);
});

it('queries only current student assignments and opens the selected platform record', () => {
  jest.useFakeTimers({ now: new Date('2026-11-04T09:00:00Z') });
  try {
    const workspaces: NuniStudyAgenda['workspaces'] = [
      { id: 'design', title: '資料庫設計', state: 'active', memberRole: 'student' },
      { id: 'management', title: '資料庫管理', state: 'active', memberRole: 'student' },
      { id: 'ethics', title: '工程倫理', state: 'active', memberRole: 'student' },
      { id: 'archived', title: '資料庫歷史', state: 'archived', memberRole: 'student' },
      { id: 'teacher', title: '資料庫教學', state: 'active', memberRole: 'owner-teacher' },
    ];
    const items = workspaces.map(({ id, title }) => task(id, {
      courseId: id, courseTitle: title, title: '期中報告', dueAt: '2026-11-05T13:00:00Z',
    }));
    const distractors = [
      task('closed', { ...items[0], id: 'closed', state: 'closed' }),
      task('submitted', { ...items[0], id: 'submitted', submittedAt: '2026-11-04T07:00:00Z' }),
      task('quiz', { ...items[0], id: 'quiz', kind: 'quiz' }),
    ];
    const data = agenda([...items, ...distractors], { workspaces });
    const open = jest.fn();
    const retry = jest.fn();
    const view = render(<StudyAgenda data={data} loading={false} error="" retry={retry} open={open} />);
    fireEvent.press(view.getByRole('button', { name: '問作業助理' }));
    fireEvent.changeText(view.getByLabelText('輸入作業問題'), '資料庫的期中報告什麼時候交？');
    fireEvent.press(view.getByRole('button', { name: '查詢作業' }));
    const matches = view.getAllByRole('button', { name: /^查看作業：/ });
    expect(matches).toHaveLength(2);
    expect(open).not.toHaveBeenCalled();
    fireEvent.press(view.getByRole('button', { name: '查看作業：資料庫管理 · 期中報告' }));
    expect(open.mock.calls).toEqual([['management', 'management']]);
    expect(retry).not.toHaveBeenCalled();
    view.rerender(<StudyAgenda data={data} loading error="" retry={retry} open={open} />);
    expect(view.queryByRole('button', { name: '問作業助理' })).toBeNull();
    expect(view.queryAllByRole('button', { name: /^查看作業：/ })).toHaveLength(0);
    view.rerender(<StudyAgenda data={agenda([], { workspaces })} loading={false} error="" retry={retry} open={open} />);
    expect(view.queryAllByRole('button', { name: /^查看作業：/ })).toHaveLength(0);
  } finally {
    jest.useRealTimers();
  }
});

it('uses Taipei local deadline strings from the platform when filtering tomorrow', () => {
  jest.useFakeTimers({ now: new Date('2026-11-04T15:57:00Z') });
  try {
    const workspaces: NuniStudyAgenda['workspaces'] = [
      { id: 'course', title: '資料庫', state: 'active', memberRole: 'student' },
    ];
    const data = agenda([
      task('late-today', { title: '今天最後一份', dueAt: '2026-11-04T23:59:00' }),
      task('midnight', { title: '午夜的作業', dueAt: '2026-11-05T00:00:00' }),
      task('undated', { title: '沒有參考期限', dueAt: null }),
    ], { workspaces, limitedCourseIds: ['course'] });
    const retry = jest.fn(), open = jest.fn();
    const view = render(<StudyAgenda data={data} loading={false} error="" retry={retry} open={open} />);
    fireEvent.press(view.getByRole('button', { name: '問作業助理' }));
    fireEvent.changeText(view.getByLabelText('輸入作業問題'), '明天有哪些作業要交？');
    fireEvent.press(view.getByRole('button', { name: '查詢作業' }));
    expect(view.getAllByRole('button', { name: /^查看作業：/ })).toHaveLength(1);
    fireEvent.press(view.getByRole('button', { name: '查看作業：資料庫 · 午夜的作業' }));
    expect(open.mock.calls).toEqual([['course', 'midnight']]);
    expect(retry).not.toHaveBeenCalled();
  } finally {
    jest.useRealTimers();
  }
});

it('pages the platform results locally and invalidates them when the course data changes', () => {
  const workspaces: NuniStudyAgenda['workspaces'] = [
    { id: 'course', title: '資料庫', state: 'active', memberRole: 'student' },
  ];
  const rows = Array.from({ length: 17 }, (_, i) => task(String(i + 1), {
    dueAt: new Date(Date.UTC(2026, 10, 5 + i)).toISOString(),
  }));
  const open = jest.fn(), retry = jest.fn();
  const props = { loading: false, error: '', open, retry };
  const view = render(<StudyAgenda data={agenda(rows, { workspaces })} {...props} />);
  fireEvent.press(view.getByRole('button', { name: '問作業助理' }));
  fireEvent.changeText(view.getByLabelText('輸入作業問題'), '有哪些作業待交？');
  fireEvent.press(view.getByRole('button', { name: '查詢作業' }));
  expect(view.getAllByRole('button', { name: /^查看作業：/ })).toHaveLength(8);
  fireEvent.changeText(view.getByLabelText('輸入作業問題'), '還有呢？');
  fireEvent.press(view.getByRole('button', { name: '查詢作業' }));
  fireEvent.changeText(view.getByLabelText('輸入作業問題'), '第二筆');
  fireEvent.press(view.getByRole('button', { name: '查詢作業' }));
  expect(view.getAllByRole('button', { name: /^查看作業：/ })).toHaveLength(1);
  expect(open).not.toHaveBeenCalled();
  fireEvent.press(view.getByRole('button', { name: '查看作業：資料庫 · 作業 10' }));
  expect(open.mock.calls).toEqual([['course', '10']]);
  fireEvent.press(view.getByRole('button', { name: '返回清單' }));
  fireEvent.press(view.getByRole('button', { name: '下一頁作業' }));
  expect(view.getAllByRole('button', { name: /^查看作業：/ })).toHaveLength(1);
  expect(view.getByRole('button', { name: '查看作業：資料庫 · 作業 17' })).toBeTruthy();
  view.rerender(<StudyAgenda data={agenda([task('replacement')], { workspaces })} {...props} />);
  expect(view.queryByRole('button', { name: '查看作業：資料庫 · 作業 17' })).toBeNull();
  expect(retry).not.toHaveBeenCalled();
});

it('checks loaded receipts by course and title without treating absence as a confirmed submission', () => {
  const workspaces: NuniStudyAgenda['workspaces'] = [
    { id: 'design', title: '資料庫設計', state: 'active', memberRole: 'student' },
    { id: 'management', title: '資料庫管理', state: 'active', memberRole: 'student' },
    { id: 'staff', title: '資料庫助教', state: 'active', memberRole: 'owner-teacher' },
    { id: 'old', title: '資料庫舊課', state: 'archived', memberRole: 'student' },
  ];
  const rows = workspaces.map(({ id, title }) => task(id, {
    title: '期中報告', courseId: id, courseTitle: title,
    submittedAt: id === 'management' || id === 'staff' ? '2026-11-04T05:00:00Z' : null,
  }));
  const open = jest.fn();
  const view = render(<StudyAgenda data={agenda(rows, { workspaces, limitedCourseIds: ['design'] })}
    loading={false} error="" retry={jest.fn()} open={open} />);
  fireEvent.press(view.getByRole('button', { name: '問作業助理' }));
  fireEvent.changeText(view.getByLabelText('輸入作業問題'), '資料庫的期中報告交了嗎？');
  fireEvent.press(view.getByRole('button', { name: '查詢作業' }));
  expect(view.getAllByRole('button', { name: /^查看作業：/ })).toHaveLength(2);
  expect(view.getByText('本次未見繳交紀錄 · 請到原頁核對')).toBeTruthy();
  expect(view.getByText(/已載入繳交紀錄.*繳交時間/)).toBeTruthy();
  expect(view.getByText(/未見紀錄不代表校方 LMS 已確認未交/)).toBeTruthy();
  fireEvent.press(view.getByRole('button', { name: '查看作業：資料庫管理 · 期中報告' }));
  expect(open).toHaveBeenCalledWith('management', 'management');

  fireEvent.changeText(view.getByLabelText('輸入作業問題'), '我已繳交的作業有哪些？');
  fireEvent.press(view.getByRole('button', { name: '查詢作業' }));
  expect(view.getAllByRole('button', { name: /^查看作業：/ })).toHaveLength(1);
  expect(view.getByRole('button', { name: '查看作業：資料庫管理 · 期中報告' })).toBeTruthy();

  fireEvent.changeText(view.getByLabelText('輸入作業問題'), '這份作業交了嗎？');
  fireEvent.press(view.getByRole('button', { name: '查詢作業' }));
  expect(view.getByText('請提供課程或作業名稱，再核對這份作業的繳交紀錄。')).toBeTruthy();
  expect(view.queryAllByRole('button', { name: /^查看作業：/ })).toHaveLength(0);
});


it('keeps a named course receipt scope across status-only follow-ups and opens the exact activity', () => {
  const workspaces: NuniStudyAgenda['workspaces'] = [
    { id: 'design', title: '資料庫設計', state: 'active', memberRole: 'student' },
    { id: 'management', title: '資料庫管理', state: 'active', memberRole: 'student' },
    { id: 'ethics', title: '工程倫理', state: 'active', memberRole: 'student' },
  ];
  const rows = workspaces.map(({ id, title }) => task(id, {
    title: '期中報告', courseId: id, courseTitle: title,
    submittedAt: id === 'management' || id === 'ethics' ? '2026-11-04T05:00:00Z' : null,
  }));
  const open = jest.fn();
  const view = render(<StudyAgenda data={agenda(rows, { workspaces })}
    loading={false} error="" retry={jest.fn()} open={open} />);
  fireEvent.press(view.getByRole('button', { name: '問作業助理' }));
  const ask = (question: string) => {
    fireEvent.changeText(view.getByLabelText('輸入作業問題'), question);
    fireEvent.press(view.getByRole('button', { name: '查詢作業' }));
  };
  ask('資料庫的期中報告交了嗎？');
  expect(view.getAllByRole('button', { name: /^查看作業：/ })).toHaveLength(2);
  ask('那已交的呢？');
  expect(view.getAllByRole('button', { name: /^查看作業：/ })).toHaveLength(1);
  expect(view.queryByRole('button', { name: '查看作業：工程倫理 · 期中報告' })).toBeNull();
  fireEvent.press(view.getByRole('button', { name: '查看作業：資料庫管理 · 期中報告' }));
  expect(open).toHaveBeenCalledWith('management', 'management');
  ask('那還沒交的呢？');
  expect(view.getAllByRole('button', { name: /^查看作業：/ })).toHaveLength(1);
  fireEvent.press(view.getByRole('button', { name: '查看作業：資料庫設計 · 期中報告' }));
  expect(open).toHaveBeenCalledWith('design', 'design');
});
