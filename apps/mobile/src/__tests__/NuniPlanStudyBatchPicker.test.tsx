import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { NuniPlanStudyBatchPicker, livePlanStudyCandidates } from '../screens/NuniPlanStudyBatchPicker';
import type { CampusEvidencePlan, CampusPlanStep } from '../services/offlineCampusPlanner';
import type { NuniPlanAssignmentSource } from '../services/nuniPlanAssignmentTarget';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
const uuid = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const accountId = `pa_${uuid(1)}`;
const source = (id: number): NuniPlanAssignmentSource => ({
  accountId, schoolId: 'pu', academicYear: '115', semester: '1',
  workspaceId: `cw_${uuid(1)}`, assignmentId: `cwa_${uuid(id)}`,
});
const step = (id: number): CampusPlanStep => ({
  id: `assignment-${id}`, title: `作業 ${id}`, detail: '待準備', groupName: '資料庫',
  priority: 'normal', evidence: 'authorized-assignments', route: '/classroom',
  dueAt: `2099-01-${String(id + 1).padStart(2, '0')}T23:59:00+08:00`, nuniSource: source(id),
});
const plan = (steps: CampusPlanStep[]): CampusEvidencePlan => ({
  title: '學習計畫', overview: '先處理截止作業', checkedAt: '2026-11-08T10:00:00.000Z',
  steps, limitations: [], content: '學習計畫',
});

test('the selector sends exactly the two to four explicitly selected source locators', () => {
  const onPrepare = jest.fn();
  const view = render(<NuniPlanStudyBatchPicker plan={plan([1, 2, 3, 4, 5].map(step))}
    accountId={accountId} schoolId="pu" disabled={false} onPrepare={onPrepare} />);
  expect(view.getByRole('button', { name: '預覽 0 份作業的準備安排' })).toBeDisabled();
  const checkbox = (id: number) => view.getByRole('checkbox', { name: `選取作業：作業 ${id}（資料庫）` });
  fireEvent.press(checkbox(1));
  expect(view.getByRole('button', { name: '預覽 1 份作業的準備安排' })).toBeDisabled();
  [2, 3, 4].forEach((id) => fireEvent.press(checkbox(id)));
  expect(checkbox(5)).toBeDisabled();
  fireEvent.press(checkbox(5));
  fireEvent.press(view.getByRole('button', { name: '預覽 4 份作業的準備安排' }));
  expect(onPrepare).toHaveBeenLastCalledWith([1, 2, 3, 4].map(source));
  fireEvent.press(checkbox(1));
  fireEvent.press(checkbox(2));
  expect(checkbox(5)).toBeEnabled();
  fireEvent.press(view.getByRole('button', { name: '預覽 2 份作業的準備安排' }));
  expect(onPrepare).toHaveBeenLastCalledWith([source(3), source(4)]);
});

test('agenda and priority duplicates share one choice while same-title different assignments remain distinct', () => {
  const first = step(1);
  const second = { ...step(2), title: first.title };
  const live = plan([first, second]);
  live.agenda = { timetableAvailable: true, assignmentsAvailable: true, ignoredCourses: 0, outsideWindow: [],
    days: [{ date: '2099-01-02', label: '週五', courses: [], gaps: [], conflicts: [], deadlines: [{
      title: first.title, groupName: first.groupName!, dueAt: first.dueAt!,
      nuniSource: first.nuniSource, timeLabel: '23:59', overdue: false,
    }] }] };
  expect(livePlanStudyCandidates(live, accountId, 'pu').map((row) => row.source.assignmentId))
    .toEqual([source(1).assignmentId, source(2).assignmentId]);
});

test('quizzes, expired deadlines, another account and historical source-free entries cannot become batch candidates', () => {
  const rows: CampusPlanStep[] = [step(1),
    { ...step(2), kind: 'quiz', evidence: 'authorized-quizzes' },
    { ...step(3), dueAt: '2020-01-01T23:59:00+08:00' },
    { ...step(4), nuniSource: { ...source(4), accountId: `pa_${uuid(9)}` } },
    { ...step(5), nuniSource: undefined },
    { ...step(6), dueAt: '2099-02-30T23:59:00+08:00' },
    { ...step(7), nuniSource: { ...source(7), schoolId: 'nthu' } }];
  const live = plan(rows);
  expect(livePlanStudyCandidates(live, accountId, 'pu')).toHaveLength(1);
  const view = render(<NuniPlanStudyBatchPicker plan={live} accountId={accountId} schoolId="pu"
    disabled={false} onPrepare={jest.fn()} />);
  expect(view.queryByText('一起安排作業準備時間')).toBeNull();
});

test('a locked assistant cannot change the selected set or start another preview', () => {
  const live = plan([step(1), step(2)]);
  const onPrepare = jest.fn();
  const view = render(<NuniPlanStudyBatchPicker plan={live} accountId={accountId} schoolId="pu"
    disabled={false} onPrepare={onPrepare} />);
  for (const row of view.getAllByRole('checkbox')) fireEvent.press(row);
  view.rerender(<NuniPlanStudyBatchPicker plan={live} accountId={accountId} schoolId="pu"
    disabled onPrepare={onPrepare} />);
  for (const row of view.getAllByRole('checkbox')) { expect(row).toBeDisabled(); fireEvent.press(row); }
  fireEvent.press(view.getByRole('button', { name: '預覽 2 份作業的準備安排' }));
  expect(onPrepare).not.toHaveBeenCalled();
});
