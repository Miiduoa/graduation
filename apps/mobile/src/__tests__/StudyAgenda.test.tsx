import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import type { NuniStudyAgenda, NuniStudyTask } from '@campus/shared/src/nuniStudyAgenda';
import { StudyAgenda } from '../screens/nuni/StudyAgenda';
import { NuniDraftProvider } from '../state/nuniDrafts';

const mockImportScope = { owner: 'test', schoolId: 's' };
jest.mock('../state/personalImportScope', () => ({
  usePersonalImportScope: () => mockImportScope,
}));
jest.mock('../services/personalImports', () => ({
  personalImportStorageKey: (scope: { owner: string; schoolId: string }) =>
    `${scope.owner}:${scope.schoolId}`,
  subscribePersonalImports: () => () => {},
  loadPersonalImports: jest.fn(async () => ({
    records: [
      {
        id: 'e',
        kind: 'events',
        schoolId: 's',
        academicYear: '115',
        semester: '1',
        title: '本機活動',
        date: '2026-10-26',
        startTime: '18:00',
        endTime: '20:00',
      },
    ],
  })),
}));

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
  fireEvent.press(view.getByRole('button', { name: /^開啟作業：資料庫 · 作業 past，參考期限已過/ }));
  expect(open).toHaveBeenCalledWith('course', 'past');
});

it('separates closed work without a loaded receipt from confirmed submissions', () => {
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
  expect(view.getByText('已停止收件 · 未見繳交紀錄')).toBeTruthy();
  expect(view.getByRole('button', { name: /作業 closed，已停止收件 · 未見繳交紀錄/ })).toBeTruthy();
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

it('keeps the course scope for same-title tasks, assistant answers and empty-filter recovery', () => {
  const workspaces: NuniStudyAgenda['workspaces'] = [
    { id: 'db', title: '資料庫', state: 'active', memberRole: 'student' },
    { id: 'net', title: '網路', state: 'active', memberRole: 'student' },
  ];
  const data = agenda(
    workspaces.map(({ id, title }) =>
      task('report-' + id, { courseId: id, courseTitle: title, title: '期中報告' }),
    ),
    { workspaces, studiedCourseCount: 2 },
  );
  const open = jest.fn();
  const view = render(
    <StudyAgenda data={data} open={open} loading={false} error="" retry={jest.fn()} />,
  );
  fireEvent.press(view.getByRole('button', { name: /^開啟作業：網路 · 期中報告，/ }));
  expect(open).toHaveBeenLastCalledWith('net', 'report-net');
  fireEvent.press(view.getByRole('button', { name: '篩選課程：資料庫' }));
  fireEvent.press(view.getByRole('button', { name: '問課業助理' }));
  fireEvent.press(view.getByRole('button', { name: '有哪些待交作業？' }));
  expect(view.getAllByRole('button', { name: /^查看作業：/ })).toHaveLength(1);
  fireEvent.press(view.getByRole('button', { name: '查看作業：資料庫 · 期中報告' }));
  expect(open).toHaveBeenLastCalledWith('db', 'report-db');
  fireEvent.press(view.getByRole('button', { name: '篩選課程：網路' }));
  expect(view.queryByRole('button', { name: /^查看作業：/ })).toBeNull();
  fireEvent.press(view.getByRole('button', { name: '問課業助理' }));
  fireEvent.press(view.getByRole('button', { name: '有哪些待交作業？' }));
  expect(view.getByRole('button', { name: '查看作業：網路 · 期中報告' })).toBeTruthy();
  fireEvent.press(view.getByRole('button', { name: '老師回饋 0' }));
  expect(view.queryByRole('button', { name: /^查看作業：/ })).toBeNull();
  expect(view.queryByText('優先處理')).toBeNull();
  fireEvent.press(view.getByRole('button', { name: '查看這門課的全部項目' }));
  expect(view.getByRole('button', { name: '篩選課程：網路' })).toHaveAccessibilityState({
    selected: true,
  });
  expect(view.getAllByRole('button', { name: /^開啟作業/ })).toHaveLength(1);
});

it('keeps more tasks visible on return and resets the limit for a different filter', () => {
  const cache = new Map<string, unknown>();
  const data = agenda(Array.from({ length: 10 }, (_, index) => task(String(index))));
  const content = (
    <NuniDraftProvider cache={cache}>
      <StudyAgenda data={data} loading={false} error="" retry={jest.fn()} open={jest.fn()} />
    </NuniDraftProvider>
  );
  const first = render(content);
  fireEvent.press(first.getByRole('button', { name: '再顯示 2 項' }));
  first.unmount();
  const second = render(content);
  expect(second.getAllByRole('button', { name: /^開啟作業/ })).toHaveLength(10);
  fireEvent.press(second.getByRole('button', { name: '全部 10' }));
  expect(second.getAllByRole('button', { name: /^開啟作業/ })).toHaveLength(8);
});

it('only offers calendar export for the chosen progress and upcoming dates', () => {
  const data = agenda([
    task('soon', { dueAt: new Date(Date.now() + 86400000).toISOString() }),
    task('later', { dueAt: new Date(Date.now() + 20 * 86400000).toISOString() }),
  ]);
  const view = render(
    <StudyAgenda data={data} loading={false} error="" retry={jest.fn()} open={jest.fn()} />,
  );
  fireEvent.press(view.getByRole('button', { name: '未來七天 1' }));
  fireEvent.press(view.getByRole('button', { name: '匯出未繳期限 ICS' }));
  expect(view.getAllByRole('checkbox')).toHaveLength(1);
  expect(view.getByRole('checkbox', { name: /作業 soon/ })).toBeTruthy();
  fireEvent.press(view.getByRole('button', { name: '老師回饋 0' }));
  expect(view.queryByRole('button', { name: '匯出未繳期限 ICS' })).toBeNull();
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
  expect(view.getByText('已結束 · 未見作答紀錄')).toBeTruthy();
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
    fireEvent.press(view.getByRole('button', { name: '問課業助理' }));
    fireEvent.changeText(view.getByLabelText('輸入課業問題'), '資料庫的期中報告什麼時候交？');
    fireEvent.press(view.getByRole('button', { name: '查詢課業' }));
    const matches = view.getAllByRole('button', { name: /^查看作業：/ });
    expect(matches).toHaveLength(2);
    expect(open).not.toHaveBeenCalled();
    fireEvent.press(view.getByRole('button', { name: '查看作業：資料庫管理 · 期中報告' }));
    expect(open.mock.calls).toEqual([['management', 'management']]);
    expect(retry).not.toHaveBeenCalled();
    view.rerender(<StudyAgenda data={data} loading error="" retry={retry} open={open} />);
    expect(view.queryByRole('button', { name: '問課業助理' })).toBeNull();
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
    fireEvent.press(view.getByRole('button', { name: '問課業助理' }));
    fireEvent.changeText(view.getByLabelText('輸入課業問題'), '明天有哪些作業要交？');
    fireEvent.press(view.getByRole('button', { name: '查詢課業' }));
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
  fireEvent.press(view.getByRole('button', { name: '問課業助理' }));
  fireEvent.changeText(view.getByLabelText('輸入課業問題'), '有哪些作業待交？');
  fireEvent.press(view.getByRole('button', { name: '查詢課業' }));
  expect(view.getAllByRole('button', { name: /^查看作業：/ })).toHaveLength(8);
  fireEvent.changeText(view.getByLabelText('輸入課業問題'), '還有呢？');
  fireEvent.press(view.getByRole('button', { name: '查詢課業' }));
  fireEvent.changeText(view.getByLabelText('輸入課業問題'), '第二筆');
  fireEvent.press(view.getByRole('button', { name: '查詢課業' }));
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
  fireEvent.press(view.getByRole('button', { name: '問課業助理' }));
  fireEvent.changeText(view.getByLabelText('輸入課業問題'), '資料庫的期中報告交了嗎？');
  fireEvent.press(view.getByRole('button', { name: '查詢課業' }));
  expect(view.getAllByRole('button', { name: /^查看作業：/ })).toHaveLength(2);
  expect(view.getByText('本次未見繳交紀錄 · 請到原頁核對')).toBeTruthy();
  expect(view.getByText(/已載入繳交紀錄.*繳交時間/)).toBeTruthy();
  expect(view.getByText(/未見紀錄不代表校方 LMS 已確認未交/)).toBeTruthy();
  fireEvent.press(view.getByRole('button', { name: '查看作業：資料庫管理 · 期中報告' }));
  expect(open).toHaveBeenCalledWith('management', 'management');

  fireEvent.changeText(view.getByLabelText('輸入課業問題'), '我已繳交的作業有哪些？');
  fireEvent.press(view.getByRole('button', { name: '查詢課業' }));
  expect(view.getAllByRole('button', { name: /^查看作業：/ })).toHaveLength(1);
  expect(view.getByRole('button', { name: '查看作業：資料庫管理 · 期中報告' })).toBeTruthy();

  fireEvent.changeText(view.getByLabelText('輸入課業問題'), '這份作業交了嗎？');
  fireEvent.press(view.getByRole('button', { name: '查詢課業' }));
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
  fireEvent.press(view.getByRole('button', { name: '問課業助理' }));
  const ask = (question: string) => {
    fireEvent.changeText(view.getByLabelText('輸入課業問題'), question);
    fireEvent.press(view.getByRole('button', { name: '查詢課業' }));
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

it('moves from a named deadline lookup to submitted and missing receipts without losing course scope', () => {
  const workspaces: NuniStudyAgenda['workspaces'] = [
    { id: 'design', title: '資料庫設計', state: 'active', memberRole: 'student' },
    { id: 'management', title: '資料庫管理', state: 'active', memberRole: 'student' },
    { id: 'ethics', title: '工程倫理', state: 'active', memberRole: 'student' },
  ];
  const rows = workspaces.map(({ id, title }) => task(id, {
    title: '期中報告', courseId: id, courseTitle: title,
    submittedAt: id === 'design' ? null : '2026-11-04T05:00:00Z',
  }));
  const open = jest.fn(), retry = jest.fn();
  const view = render(<StudyAgenda data={agenda(rows, { workspaces })} loading={false}
    error="" retry={retry} open={open} />);
  fireEvent.press(view.getByRole('button', { name: '問課業助理' }));
  const ask = (question: string) => {
    fireEvent.changeText(view.getByLabelText('輸入課業問題'), question);
    fireEvent.press(view.getByRole('button', { name: '查詢課業' }));
  };
  ask('資料庫的期中報告什麼時候交？');
  expect(view.getAllByRole('button', { name: /^查看作業：/ })).toHaveLength(1);
  ask('那已交的呢？');
  expect(view.getAllByRole('button', { name: /^查看作業：/ })).toHaveLength(1);
  expect(view.queryByRole('button', { name: '查看作業：工程倫理 · 期中報告' })).toBeNull();
  fireEvent.press(view.getByRole('button', { name: '查看作業：資料庫管理 · 期中報告' }));
  expect(open).toHaveBeenCalledWith('management', 'management');
  ask('那還沒交的呢？');
  expect(view.getByRole('button', { name: '查看作業：資料庫設計 · 期中報告' })).toBeTruthy();
  expect(retry).not.toHaveBeenCalled();
});

it('carries tomorrow across deadline-to-receipt questions and does not include next-week receipts', () => {
  jest.useFakeTimers({ now: new Date('2026-11-04T09:00:00Z') });
  try {
    const workspaces: NuniStudyAgenda['workspaces'] = [
      { id: 'design', title: '資料庫設計', state: 'active', memberRole: 'student' },
      { id: 'management', title: '資料庫管理', state: 'active', memberRole: 'student' },
      { id: 'ethics', title: '工程倫理', state: 'active', memberRole: 'student' },
    ];
    const rows = workspaces.map(({ id, title }) => task(id, {
      title: '期中報告', courseId: id, courseTitle: title,
      dueAt: id === 'ethics' ? '2026-11-12T09:00:00+08:00' : '2026-11-05T10:00:00+08:00',
      submittedAt: id === 'design' ? null : '2026-11-04T05:00:00Z',
    }));
    const open = jest.fn(), retry = jest.fn();
    const view = render(<StudyAgenda data={agenda(rows, { workspaces })} loading={false}
      error="" retry={retry} open={open} />);
    fireEvent.press(view.getByRole('button', { name: '問課業助理' }));
    const ask = (question: string) => {
      fireEvent.changeText(view.getByLabelText('輸入課業問題'), question);
      fireEvent.press(view.getByRole('button', { name: '查詢課業' }));
    };
    ask('明天有哪些作業？');
    expect(view.getByRole('button', { name: '查看作業：資料庫設計 · 期中報告' })).toBeTruthy();
    ask('那已交的呢？');
    expect(view.getByRole('button', { name: '查看作業：資料庫管理 · 期中報告' })).toBeTruthy();
    expect(view.queryByRole('button', { name: '查看作業：工程倫理 · 期中報告' })).toBeNull();
    expect(view.getByText('截止範圍：「明天」（台灣時間），依作業參考期限篩選。')).toBeTruthy();
    ask('那還沒交的呢？');
    expect(view.getByRole('button', { name: '查看作業：資料庫設計 · 期中報告' })).toBeTruthy();
    fireEvent.press(view.getByRole('button', { name: '查看作業：資料庫設計 · 期中報告' }));
    expect(open).toHaveBeenCalledWith('design', 'design');
    expect(retry).not.toHaveBeenCalled();
  } finally {
    jest.useRealTimers();
  }
});

it('never expands an overdue-only lookup into all receipts on a vague follow-up', () => {
  const workspaces: NuniStudyAgenda['workspaces'] = [
    { id: 'design', title: '資料庫設計', state: 'active', memberRole: 'student' },
  ];
  const view = render(<StudyAgenda data={agenda([task('design', { courseId: 'design' })], { workspaces })}
    loading={false} error="" retry={jest.fn()} open={jest.fn()} />);
  fireEvent.press(view.getByRole('button', { name: '問課業助理' }));
  fireEvent.changeText(view.getByLabelText('輸入課業問題'), '有哪些逾期作業？');
  fireEvent.press(view.getByRole('button', { name: '查詢課業' }));
  fireEvent.changeText(view.getByLabelText('輸入課業問題'), '那已交的呢？');
  fireEvent.press(view.getByRole('button', { name: '查詢課業' }));
  expect(view.getByText(/上個作業查詢尚未確定日期或只查特定期限狀態/)).toBeTruthy();
  expect(view.queryByText(/來源：本次載入的 nuni 課程繳交紀錄/)).toBeNull();
});

it('checks submitted and missing records in the same course and date without clearing the draft', () => {
  jest.useFakeTimers({ now: new Date('2026-11-04T09:00:00Z') });
  try {
    const workspaces: NuniStudyAgenda['workspaces'] = [
      { id: 'course', title: '資料庫', state: 'active', memberRole: 'student' },
      { id: 'ethics', title: '工程倫理', state: 'active', memberRole: 'student' },
    ];
    const tomorrow = { dueAt: '2026-11-05T13:00:00+08:00' };
    const submitted = { ...tomorrow, title: '期中報告', submittedAt: '2026-11-04T05:00:00Z' };
    const items = [
      task('pending', tomorrow),
      task('right', submitted),
      task('later', { ...submitted, dueAt: '2026-11-12T13:00:00+08:00' }),
      task('right', { ...submitted, courseId: 'ethics', courseTitle: '工程倫理' }),
    ];
    const open = jest.fn();
    const view = render(<StudyAgenda data={agenda(items, { workspaces })} loading={false}
      error="" retry={jest.fn()} open={open} />);
    const press = (name: string) => fireEvent.press(view.getByRole('button', { name }));
    const draft = '下一題還沒打完';
    press('問課業助理');
    fireEvent.changeText(view.getByLabelText('輸入課業問題'), '明天資料庫有哪些作業？');
    press('查詢課業');
    fireEvent.changeText(view.getByLabelText('輸入課業問題'), draft);
    press('查同範圍已繳交作業');
    expect(view.getAllByRole('button', { name: /^查看作業：/ })).toHaveLength(1);
    expect(view.getByText(/已載入繳交紀錄.*繳交時間/)).toBeTruthy();
    press('查看作業：資料庫 · 期中報告');
    expect(open.mock.calls).toEqual([['course', 'right']]);
    press('返回作業結果');
    press('查同範圍未見紀錄作業');
    expect(view.getByText('本次未見繳交紀錄 · 請到原頁核對')).toBeTruthy();
    expect(view.getByRole('button', { name: '查看作業：資料庫 · 作業 pending' })).toBeTruthy();
    press('返回作業結果');
    expect(view.getByDisplayValue(draft)).toBeTruthy();
  } finally {
    jest.useRealTimers();
  }
});

it('resolves "這份作業" only after a deliberate ordinal choice, keeping the exact nuni activity source', () => {
  const workspaces: NuniStudyAgenda['workspaces'] = [
    { id: 'design', title: '資料庫設計', state: 'active', memberRole: 'student' },
    { id: 'management', title: '資料庫管理', state: 'active', memberRole: 'student' },
    { id: 'staff', title: '資料庫教學', state: 'active', memberRole: 'owner-teacher' },
  ];
  const tasks = [
    task('closed', { courseId: 'design', courseTitle: '資料庫設計', title: '期中報告', state: 'closed' }),
    task('pending', { courseId: 'design', courseTitle: '資料庫設計', title: '期中報告' }),
    task('submitted', { courseId: 'management', courseTitle: '資料庫管理',
      title: '期中報告', submittedAt: '2026-11-04T05:00:00Z' }),
    task('teacher-only', { courseId: 'staff', courseTitle: '資料庫教學',
      title: '期中報告', submittedAt: '2026-11-04T05:00:00Z' }),
  ];
  const open = jest.fn(), retry = jest.fn();
  const view = render(<StudyAgenda data={agenda(tasks, { workspaces })} loading={false}
    error="" retry={retry} open={open} />);
  fireEvent.press(view.getByRole('button', { name: '問課業助理' }));
  const ask = (question: string) => {
    fireEvent.changeText(view.getByLabelText('輸入課業問題'), question);
    fireEvent.press(view.getByRole('button', { name: '查詢課業' }));
  };
  ask('這份作業交了嗎？');
  expect(view.getByText('請提供課程或作業名稱，再核對這份作業的繳交紀錄。')).toBeTruthy();
  ask('資料庫的期中報告交了嗎？');
  expect(view.getAllByRole('button', { name: /^查看作業：/ })).toHaveLength(3);
  ask('第三筆');
  expect(view.getByText('已選本頁第 3 筆')).toBeTruthy();
  ask('這份作業交了嗎？');
  expect(view.getAllByRole('button', { name: /^查看作業：/ })).toHaveLength(1);
  expect(view.getByText(/已載入繳交紀錄.*繳交時間/)).toBeTruthy();
  fireEvent.press(view.getByRole('button', { name: '查看作業：資料庫管理 · 期中報告' }));
  expect(open).toHaveBeenCalledWith('management', 'submitted');
  ask('那還沒交的呢？');
  expect(view.queryAllByRole('button', { name: /^查看作業：/ })).toHaveLength(0);
  ask('資料庫的期中報告交了嗎？');
  ask('第二筆');
  ask('這份作業交了嗎？');
  expect(view.getByText('本次未見繳交紀錄 · 請到原頁核對')).toBeTruthy();
  fireEvent.press(view.getByRole('button', { name: '查看作業：資料庫設計 · 期中報告' }));
  expect(open).toHaveBeenCalledWith('design', 'pending');
  expect(open).toHaveBeenCalledTimes(2);
  expect(retry).not.toHaveBeenCalled();
});

it('keeps the exact source when a pending-deadline result is selected before asking about its receipt', () => {
  jest.useFakeTimers({ now: new Date('2026-11-04T09:00:00Z') });
  try {
    const workspaces: NuniStudyAgenda['workspaces'] = [
      { id: 'design', title: '資料庫設計', state: 'active', memberRole: 'student' },
      { id: 'management', title: '資料庫管理', state: 'active', memberRole: 'student' },
      { id: 'staff', title: '資料庫教學', state: 'active', memberRole: 'owner-teacher' },
    ];
    const rows = workspaces.map(({ id, title }) => task(id, {
      courseId: id, courseTitle: title, title: '期中報告',
      dueAt: '2026-11-05T10:00:00+08:00',
    }));
    const open = jest.fn();
    const view = render(<StudyAgenda data={agenda(rows, { workspaces })} loading={false}
      error="" retry={jest.fn()} open={open} />);
    fireEvent.press(view.getByRole('button', { name: '問課業助理' }));
    const ask = (question: string) => {
      fireEvent.changeText(view.getByLabelText('輸入課業問題'), question);
      fireEvent.press(view.getByRole('button', { name: '查詢課業' }));
    };
    ask('明天有哪些作業？');
    expect(view.getAllByRole('button', { name: /^查看作業：/ })).toHaveLength(2);
    ask('第二筆');
    ask('這份作業交了嗎？');
    expect(view.getAllByRole('button', { name: /^查看作業：/ })).toHaveLength(1);
    expect(view.getByText('本次未見繳交紀錄 · 請到原頁核對')).toBeTruthy();
    fireEvent.press(view.getByRole('button', { name: '查看作業：資料庫管理 · 期中報告' }));
    expect(open).toHaveBeenCalledWith('management', 'management');
    expect(view.queryByRole('button', { name: '查看作業：資料庫教學 · 期中報告' })).toBeNull();
  } finally {
    jest.useRealTimers();
  }
});

it('checks a receipt from page two and returns to the same page and selection', () => {
  const workspaces: NuniStudyAgenda['workspaces'] = [
    { id: 'course', title: '資料庫', state: 'active', memberRole: 'student' },
    { id: 'ethics', title: '工程倫理', state: 'active', memberRole: 'student' },
  ];
  const items = [
    ...Array.from({ length: 8 }, (_, index) => task(String(index), {
      dueAt: new Date(Date.UTC(2026, 10, 1 + index)).toISOString(),
    })),
    task('report', { title: '期中報告' }),
    task('report', { courseId: 'ethics', courseTitle: '工程倫理', title: '期中報告' }),
    task('prior', { title: '期中報告', submittedAt: '2026-11-04T05:00:00Z' }),
  ];
  const open = jest.fn(), retry = jest.fn();
  const view = render(<StudyAgenda data={agenda(items, { workspaces })} loading={false}
    error="" retry={retry} open={open} />);
  const press = (name: string) => fireEvent.press(view.getByRole('button', { name }));
  const ask = (question: string) => {
    fireEvent.changeText(view.getByLabelText('輸入課業問題'), question);
    press('查詢課業');
  };
  press('問課業助理');
  press('有哪些待交作業？');
  let firstButton = view.getByRole('button', { name: '查繳交紀錄：資料庫 · 作業 0' });
  while (firstButton.parent && !firstButton.props.onPress) firstButton = firstButton.parent;
  const staleCheck = firstButton.props.onPress;
  press('下一頁作業');
  act(() => staleCheck());
  expect(view.getByText('符合 10 筆 · 顯示第 9–10 筆')).toBeTruthy();

  const checkEthics = '查繳交紀錄：工程倫理 · 期中報告';
  press(checkEthics);
  expect(view.getByText('本次未見繳交紀錄 · 請到原頁核對')).toBeTruthy();
  expect(view.queryByRole('button', { name: '查看作業：資料庫 · 期中報告' })).toBeNull();
  expect(open).not.toHaveBeenCalled();
  press('查看作業：工程倫理 · 期中報告');
  expect(open.mock.calls).toEqual([['ethics', 'report']]);
  ask('那已交的呢？');
  expect(view.getByText('已載入的課程紀錄中沒有符合的作業，請到原課程核對。')).toBeTruthy();
  expect(view.queryAllByRole('button', { name: /^查看作業：/ })).toHaveLength(0);
  press('返回作業結果');
  expect(view.getByText('符合 10 筆 · 顯示第 9–10 筆')).toBeTruthy();

  ask('第二筆');
  press(checkEthics);
  press('返回作業結果');
  expect(view.getByText('已選本頁第 2 筆')).toBeTruthy();
  expect(view.getAllByRole('button', { name: /^查看作業：/ })).toHaveLength(1);
  expect(view.getByRole('button', { name: checkEthics })).toBeTruthy();
  press(checkEthics);
  ask('資料庫的期中報告交了嗎？');
  expect(view.queryByRole('button', { name: '返回作業結果' })).toBeNull();
  expect(view.getByText(/已載入繳交紀錄.*繳交時間/)).toBeTruthy();
  expect(retry).not.toHaveBeenCalled();
});

it('keeps quiz follow-ups inside the selected course and date and opens only the requested quiz', () => {
  jest.useFakeTimers({ now: new Date('2026-11-05T15:50:00Z') });
  try {
    const workspaces: NuniStudyAgenda['workspaces'] = [
      { id: 'course', title: '資料庫', state: 'active', memberRole: 'student' },
      { id: 'other', title: '網路', state: 'active', memberRole: 'student' },
    ];
    const quiz = (id: string, extra: Partial<NuniStudyTask> = {}) => task(id, {
      kind: 'quiz', title: id, dueAt: '2026-11-06T00:00:00', ...extra,
    });
    const source = agenda([
      quiz('期中練習'), quiz('已作答練習', { submittedAt: '2026-11-05T09:00:00Z' }),
      quiz('下週測驗', { dueAt: '2026-11-10T00:00:00', submittedAt: '2026-11-05T11:00:00Z' }),
      quiz('下週無紀錄', { dueAt: '2026-11-10T00:00:00' }),
      quiz('其他課測驗', { courseId: 'other', courseTitle: '網路' }),
      task('相同名稱的作業', { title: '期中練習', dueAt: '2026-11-06T00:00:00' }),
    ], { workspaces });
    const open = jest.fn(), retry = jest.fn();
    const view = render(<StudyAgenda data={source} loading={false} error="" retry={retry} open={open} />);
    const press = (name: string) => fireEvent.press(view.getByRole('button', { name }));
    const ask = (question: string) => {
      fireEvent.changeText(view.getByLabelText('輸入課業問題'), question);
      press('查詢課業');
    };
    press('篩選課程：資料庫');
    press('問課業助理');
    ask('這門課明天有哪些測驗？');
    expect(view.getAllByRole('button', { name: /^查看測驗：/ })).toHaveLength(2);
    expect(view.queryByRole('button', { name: /^查看作業：/ })).toBeNull();
    press('查同範圍已作答測驗');
    expect(view.getAllByRole('button', { name: /^查看測驗：/ })).toHaveLength(1);
    expect(view.getByRole('button', { name: '查看測驗：資料庫 · 已作答練習' })).toBeTruthy();
    ask('那下週呢？');
    expect(view.getAllByRole('button', { name: /^查看測驗：/ })).toHaveLength(1);
    expect(view.getByRole('button', { name: '查看測驗：資料庫 · 下週測驗' })).toBeTruthy();
    ask('第一筆');
    ask('這個測驗作答了嗎？');
    expect(open).not.toHaveBeenCalled();
    press('查看測驗：資料庫 · 下週測驗');
    expect(open.mock.calls).toEqual([['course', '下週測驗']]);
    ask('第一筆');
    ask('這份作業交了嗎？');
    expect(view.getByText('請提供課程或作業名稱，再核對這份作業的繳交紀錄。')).toBeTruthy();
    expect(view.queryByRole('button', { name: /^查看作業：/ })).toBeNull();
    expect(retry).not.toHaveBeenCalled();
    press('篩選課程：網路');
    expect(view.queryAllByRole('button', { name: /^查看測驗：/ })).toHaveLength(0);
  } finally { jest.useRealTimers(); }
});

describe('assignment receipt dates in the real agenda assistant', () => {
  beforeEach(() => jest.useFakeTimers({ now: new Date('2026-11-07T23:59:50+08:00') }));
  afterEach(() => jest.useRealTimers());

  function receiptAgenda(): NuniStudyAgenda {
    const submittedAt = '2026-11-07T09:00:00+08:00';
    return agenda([
      task('pending-tomorrow', { title: '期中報告', dueAt: '2026-11-08T10:00:00+08:00' }),
      task('submitted-tomorrow', { title: '同名練習', dueAt: '2026-11-08T11:00:00+08:00', submittedAt }),
      task('pending-next-week', { title: '下週練習', dueAt: '2026-11-10T10:00:00+08:00' }),
      task('submitted-next-week', { title: '同名練習', dueAt: '2026-11-10T11:00:00+08:00', submittedAt }),
      task('undated', { title: '無期限練習' }),
      task('other-pending', { courseId: 'other', courseTitle: '工程倫理', title: '期中報告',
        dueAt: '2026-11-08T12:00:00+08:00' }),
      task('other-submitted', { courseId: 'other', courseTitle: '工程倫理', title: '同名練習',
        dueAt: '2026-11-10T12:00:00+08:00', submittedAt }),
    ], { workspaces: [
      { id: 'course', title: '資料庫', state: 'active', memberRole: 'student' },
      { id: 'other', title: '工程倫理', state: 'active', memberRole: 'student' },
    ], studiedCourseCount: 2 });
  }

  function openReceiptAssistant() {
    const data = receiptAgenda();
    const open = jest.fn(), retry = jest.fn();
    const view = render(<StudyAgenda data={data} loading={false} error="" retry={retry} open={open} />);
    const press = (name: string) => fireEvent.press(view.getByRole('button', { name }));
    press('問課業助理');
    const ask = (question: string) => {
      fireEvent.changeText(view.getByLabelText('輸入課業問題'), question);
      press('查詢課業');
    };
    const names = () => view.queryAllByRole('button', { name: /^查看作業：/ })
      .map((row) => row.props.accessibilityLabel).sort();
    return { view, data, open, retry, press, ask, names };
  }

  it('makes a direct tomorrow missing-receipt question match the existing two-step lookup and opens the exact namesake', () => {
    const { view, open, retry, press, ask, names } = openReceiptAssistant();
    ask('我明天還沒交的作業有哪些？');
    const direct = names();
    expect(direct).toEqual(['查看作業：工程倫理 · 期中報告', '查看作業：資料庫 · 期中報告'].sort());
    expect(view.getByText('截止範圍：「明天」（台灣時間），依作業參考期限篩選。')).toBeTruthy();
    expect(view.getByText('另有 1 筆無可核對的參考期限，無法依日期判斷。')).toBeTruthy();
    for (const row of view.getAllByRole('button', { name: /^查看作業：/ })) {
      expect(row.props.accessibilityValue.text).toMatch(/未見繳交紀錄/);
      expect(row.props.accessibilityValue.text).toMatch(/參考期限/);
    }
    expect(open).not.toHaveBeenCalled();
    expect(retry).not.toHaveBeenCalled();
    press('查看作業：工程倫理 · 期中報告');
    expect(open.mock.calls).toEqual([['other', 'other-pending']]);
    press('收起課業助理');
    press('問課業助理');
    ask('明天有哪些作業？');
    ask('那還沒交的呢？');
    expect(names()).toEqual(direct);
    expect(open).toHaveBeenCalledTimes(1);
    expect(retry).not.toHaveBeenCalled();
  });

  it('changes only the requested date while keeping the course, receipt status and a deliberately selected exact source', () => {
    const { view, open, retry, press, ask, names } = openReceiptAssistant();
    ask('資料庫明天截止的已繳交作業有哪些？');
    expect(names()).toEqual(['查看作業：資料庫 · 同名練習']);
    expect(view.getByRole('button', { name: '查看作業：資料庫 · 同名練習' }).props.accessibilityValue.text)
      .toMatch(/繳交時間.*參考期限/);
    ask('那下週呢？');
    expect(names()).toEqual(['查看作業：資料庫 · 同名練習']);
    expect(view.getByText('截止範圍：「下週」（台灣時間），依作業參考期限篩選。')).toBeTruthy();
    expect(open).not.toHaveBeenCalled();
    press('查看作業：資料庫 · 同名練習');
    expect(open.mock.calls).toEqual([['course', 'submitted-next-week']]);
    ask('第一筆');
    ask('這份作業交了嗎？');
    ask('那明天呢？');
    // A date change cannot silently substitute tomorrow's same-title assignment.
    expect(names()).toEqual([]);
    expect(view.getByText('已載入的課程紀錄中沒有符合的作業，請到原課程核對。')).toBeTruthy();
    expect(open).toHaveBeenCalledTimes(1);
    expect(retry).not.toHaveBeenCalled();
  });

  it('keeps a direct receipt query anchored to its original Taiwan day across a midnight status follow-up', () => {
    const { view, open, retry, press, ask, names } = openReceiptAssistant();
    ask('我明天還沒交的作業有哪些？');
    jest.setSystemTime(new Date('2026-11-08T00:01:00+08:00'));
    ask('那已交的呢？');
    expect(names()).toEqual(['查看作業：資料庫 · 同名練習']);
    expect(view.getByText('截止範圍：「明天」（台灣時間），依作業參考期限篩選。')).toBeTruthy();
    press('查看作業：資料庫 · 同名練習');
    expect(open.mock.calls).toEqual([['course', 'submitted-tomorrow']]);
    expect(retry).not.toHaveBeenCalled();
  });

  it('clarifies unsupported dates and retains the course and submitted filter when the user supplies a supported date', () => {
    const { view, open, retry, press, ask, names } = openReceiptAssistant();
    const clarification = '想查哪一天或哪一週的作業參考期限？可以指定「明天」或「下週」。';
    ask('資料庫下下週截止的已繳交作業有哪些？');
    expect(view.getByText(clarification)).toBeTruthy();
    expect(names()).toEqual([]);
    ask('那明天呢？');
    expect(names()).toEqual(['查看作業：資料庫 · 同名練習']);
    press('查看作業：資料庫 · 同名練習');
    expect(open.mock.calls).toEqual([['course', 'submitted-tomorrow']]);
    ask('那下下週呢？');
    expect(view.getByText(clarification)).toBeTruthy();
    expect(names()).toEqual([]);
    ask('那下週呢？');
    expect(names()).toEqual(['查看作業：資料庫 · 同名練習']);
    press('查看作業：資料庫 · 同名練習');
    expect(open.mock.calls).toEqual([['course', 'submitted-tomorrow'], ['course', 'submitted-next-week']]);
    expect(retry).not.toHaveBeenCalled();
  });

  it.each([
    '我昨天已交的作業有哪些？',
    '我昨天繳交的作業有哪些？',
    '我昨天交了哪些作業？',
  ])('keeps an unconfirmed submission-date request in clarification until the user explicitly asks about deadlines: %s', (initialQuestion) => {
    const { view, open, retry, press, ask, names } = openReceiptAssistant();
    const clarification = '這裡目前只能依作業參考期限查日期，不能按繳交時間篩選。請明確指定要查哪一天截止的作業。';
    for (const question of [initialQuestion, '那還沒交的呢？', '那明天呢？']) {
      ask(question);
      expect(view.getByText(clarification)).toBeTruthy();
      expect(names()).toEqual([]);
      expect(view.queryByText(/^截止範圍：/)).toBeNull();
    }
    expect(open).not.toHaveBeenCalled();
    expect(retry).not.toHaveBeenCalled();
    ask('我明天截止的作業有哪些已繳交？');
    expect(view.queryByText(clarification)).toBeNull();
    expect(names()).toEqual(['查看作業：資料庫 · 同名練習']);
    expect(view.getByText('截止範圍：「明天」（台灣時間），依作業參考期限篩選。')).toBeTruthy();
    expect(view.getByRole('button', { name: '查看作業：資料庫 · 同名練習' }).props.accessibilityValue.text)
      .toMatch(/已載入繳交紀錄.*參考期限/);
    press('查看作業：資料庫 · 同名練習');
    expect(open.mock.calls).toEqual([['course', 'submitted-tomorrow']]);
    expect(retry).not.toHaveBeenCalled();
  });

  it('a new complete receipt question drops the previous date, named course and selected source', () => {
    const { view, open, retry, ask, names } = openReceiptAssistant();
    ask('資料庫明天截止的已繳交作業有哪些？');
    ask('第一筆');
    ask('這份作業交了嗎？');
    expect(names()).toEqual(['查看作業：資料庫 · 同名練習']);
    ask('我已繳交的作業有哪些？');
    expect(names()).toEqual([
      '查看作業：工程倫理 · 同名練習', '查看作業：資料庫 · 同名練習', '查看作業：資料庫 · 同名練習',
    ].sort());
    expect(view.queryByText(/^截止範圍：/)).toBeNull();
    expect(view.queryByText('這份作業的繳交紀錄')).toBeNull();
    expect(open).not.toHaveBeenCalled();
    expect(retry).not.toHaveBeenCalled();
  });

  it.each(['refreshed snapshot', 'another account snapshot'] as const)(
    'clears the receipt context and stale exact-open action for a %s',
    (change) => {
      const { view, data, open, retry, press, ask, names } = openReceiptAssistant();
      ask('資料庫明天截止的已繳交作業有哪些？');
      let button = view.getByRole('button', { name: '查看作業：資料庫 · 同名練習' });
      while (button.parent && !button.props.onPress) button = button.parent;
      const staleOpen = button.props.onPress;
      expect(typeof staleOpen).toBe('function');
      const courseId = change === 'refreshed snapshot' ? 'course' : 'another-account-course';
      const courseTitle = change === 'refreshed snapshot' ? '資料庫' : '另一帳號的課程';
      const next: NuniStudyAgenda = { ...data,
        tasks: [task('submitted-tomorrow', { courseId, courseTitle, title: '更新後的紀錄',
          dueAt: '2026-11-10T11:00:00+08:00', submittedAt: '2026-11-07T10:00:00+08:00' })],
        workspaces: [{ id: courseId, title: courseTitle, state: 'active', memberRole: 'student' }],
        studiedCourseCount: 1,
      };
      // Replace the loaded source as the real screen does after refresh or account validation.
      view.rerender(<StudyAgenda data={next} loading={false} error="" retry={retry} open={open} />);
      expect(names()).toEqual([]);
      expect(view.queryByText(/^截止範圍：/)).toBeNull();
      act(() => staleOpen());
      expect(open).not.toHaveBeenCalled();
      press('問課業助理');
      ask('我已繳交的作業有哪些？');
      expect(names()).toEqual([`查看作業：${courseTitle} · 更新後的紀錄`]);
      press(`查看作業：${courseTitle} · 更新後的紀錄`);
      expect(open.mock.calls).toEqual([[courseId, 'submitted-tomorrow']]);
      expect(retry).not.toHaveBeenCalled();
    },
  );
});

it('connects local event records to the deadline preview', async () => {
  const view = render(
    <StudyAgenda
      data={agenda([
        task('local', {
          dueAt: '2026-10-26T19:00:00+08:00',
        }),
      ])}
      loading={false}
      error=""
      retry={jest.fn()}
      open={jest.fn()}
    />,
  );
  await act(async () => {});
  fireEvent.press(view.getByText('匯出未繳期限 ICS'));
  fireEvent.press(view.getByRole('checkbox'));
  fireEvent.press(view.getByRole('button', { name: /預覽/ }));
  expect(view.getByText(/與個人事件衝突：本機活動/)).toBeTruthy();
  expect(view.getByText(/個人事件未知/)).toBeTruthy();
});

it('keeps a failed local read unknown instead of treating it as free', async () => {
  const { loadPersonalImports } = require('../services/personalImports');
  loadPersonalImports.mockRejectedValueOnce(new Error('本機讀取失敗'));
  const view = render(
    <StudyAgenda
      data={agenda([
        task('failed', {
          dueAt: '2026-10-26T19:00:00+08:00',
        }),
      ])}
      loading={false}
      error=""
      retry={jest.fn()}
      open={jest.fn()}
    />,
  );
  await act(async () => {});
  fireEvent.press(view.getByText('匯出未繳期限 ICS'));
  fireEvent.press(view.getByRole('checkbox'));
  fireEvent.press(view.getByRole('button', { name: /預覽/ }));
  expect(view.getByText(/個人事件未知/)).toBeTruthy();
  expect(view.queryByText(/與個人事件衝突/)).toBeNull();
});
