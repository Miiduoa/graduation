import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import type { NuniStudyAgenda, NuniStudyTask } from '@campus/shared/src/nuniStudyAgenda';
import { StudyAgenda } from '../screens/nuni/StudyAgenda';

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
