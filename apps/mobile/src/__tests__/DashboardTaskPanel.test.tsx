import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { DashboardTaskPanel } from '../components/DashboardTaskPanel';
import type { NextBestAction } from '../data';

jest.mock('../state/theme', () => ({ useTheme: () => require('../ui/theme').theme }));

const task: NextBestAction = {
  id: 'attendance-1',
  title: '確認出缺紀錄',
  description: '更新的課程紀錄',
  priority: 1,
  urgency: 'low',
  reason: '資料結構有一筆待確認紀錄',
  nextStep: '查看紀錄',
  actionLabel: '查看紀錄',
  evidenceRefs: [],
  requiresConfirmation: false,
  source: 'inbox',
};

function props() {
  return {
    displayName: '同學',
    tasks: [] as NextBestAction[],
    status: 'loading' as const,
    onRetry: jest.fn(),
    onOpenTask: jest.fn(),
    onOpenCourses: jest.fn(),
    onOpenSchool: jest.fn(),
    onOpenCampus: jest.fn(),
  };
}

test('keeps every service entry usable while records are loading', () => {
  const actions = props();
  const view = render(<DashboardTaskPanel {...actions} />);
  fireEvent.press(view.getByRole('button', { name: '課程與作業' }));
  fireEvent.press(view.getByRole('button', { name: '校務服務' }));
  fireEvent.press(view.getByRole('button', { name: '校園服務' }));
  expect(actions.onOpenCourses).toHaveBeenCalledTimes(1);
  expect(actions.onOpenSchool).toHaveBeenCalledTimes(1);
  expect(actions.onOpenCampus).toHaveBeenCalledTimes(1);
  expect(view.queryByText(/目前沒有校務提醒/)).toBeNull();
});

test('does not report an empty day or offer stale actions after a failed refresh', () => {
  const actions = props();
  const view = render(<DashboardTaskPanel {...actions} status="error" tasks={[task]} />);
  expect(view.getByRole('alert')).toHaveTextContent(/校務提醒未能更新/);
  expect(view.queryByText(task.title)).toBeNull();
  expect(view.queryByText(/目前沒有校務提醒/)).toBeNull();
  fireEvent.press(view.getByRole('button', { name: '重試校務提醒' }));
  expect(actions.onRetry).toHaveBeenCalledTimes(1);
});

test('opens the exact loaded task and keeps platform course work distinct from an empty school inbox', () => {
  const actions = props();
  const view = render(<DashboardTaskPanel {...actions} status="ready" tasks={[task]} />);
  fireEvent.press(view.getByRole('button', { name: task.title }));
  expect(actions.onOpenTask).toHaveBeenCalledWith(task);
  view.rerender(<DashboardTaskPanel {...actions} status="ready" tasks={[]} />);
  expect(view.getByText(/Campus One 作業與測驗請到「課程與作業」查看/)).toBeTruthy();
});
