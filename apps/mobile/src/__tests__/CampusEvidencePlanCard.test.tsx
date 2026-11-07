import React from 'react';
import { Text } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import { CampusEvidencePlanCard } from '../screens/CampusEvidencePlanCard';
import { CampusAssignmentOpenButton } from '../screens/CampusAssignmentOpenButton';
import { CampusAssignmentReminderAction } from '../screens/CampusAssignmentReminderAction';
import { buildCampusStudyAgenda, resolveStudyWindow } from '../services/campusStudyAgenda';
import type { CampusEvidencePlan } from '../services/offlineCampusPlanner';
import type { CampusAssignmentIdentity } from '../services/campusAssignmentTarget';
import type { NuniPlanAssignmentSource, NuniPlanActivityIdentity } from '../services/nuniPlanAssignmentTarget';

jest.mock('../screens/CampusAssignmentOpenButton', () => ({ CampusAssignmentOpenButton: jest.fn(() => null) }));
jest.mock('../screens/CampusAssignmentReminderAction', () => ({ CampusAssignmentReminderAction: jest.fn(() => null) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

const source: NuniPlanAssignmentSource = {
  accountId: 'student-a', schoolId: 'pu', academicYear: '115', semester: '1',
  workspaceId: 'database-course', assignmentId: 'term-report',
};
const now = Date.parse('2026-11-08T08:00:00+08:00');
function plan(): CampusEvidencePlan {
  const task = { title: '資料庫報告', groupName: '資料庫', dueAt: '2026-11-08T18:00:00+08:00', nuniSource: source };
  return {
    title: '今日計畫', checkedAt: new Date(now).toISOString(), overview: '核對待辦', content: '今日計畫文字', limitations: [],
    steps: [
      { ...task, id: 'nuni-database-course-term-report', detail: '開啟正式課程核對。',
        priority: 'urgent', evidence: 'authorized-assignments', route: '/classroom' },
      { id: 'verify', title: '核對來源', detail: '資料可能更新。',
        priority: 'verify', evidence: 'verification', route: '/classroom' },
    ],
    agenda: buildCampusStudyAgenda({ now, window: resolveStudyWindow('今天', now)!, courses: [], assignments: [
      task,
      { title: '未定日期的練習', groupName: '資料庫', dueAt: null,
        nuniSource: { ...source, assignmentId: 'undated-practice' } },
    ] }),
  };
}
const reminderContext = { userId: 'firebase-user', schoolId: 'pu', snapshot: null, isCurrent: () => true };

beforeEach(() => jest.clearAllMocks());

test('one live renderer receives the exact source for steps, daily deadlines and expanded outside-window tasks', () => {
  const renderAction = jest.fn((assignment: CampusAssignmentIdentity & { nuniSource?: NuniPlanAssignmentSource }) => (
    <Text>{'平台作業入口：' + assignment.title}</Text>
  ));
  const view = render(<CampusEvidencePlanCard plan={plan()} disabled={false} renderAssignmentAction={renderAction} />);
  expect(view.getAllByText('平台作業入口：資料庫報告')).toHaveLength(2);
  expect(renderAction.mock.calls.map(([assignment]) => assignment.nuniSource)).toEqual([source, source]);
  expect(renderAction.mock.calls.some(([assignment]) => assignment.title === '核對來源')).toBe(false);
  expect(view.queryByText('平台作業入口：未定日期的練習')).toBeNull();
  fireEvent.press(view.getByRole('button', { name: '查看其他 1 項作業' }));
  expect(view.getByText('平台作業入口：未定日期的練習')).toBeTruthy();
  expect(renderAction).toHaveBeenCalledWith(expect.objectContaining({
    title: '未定日期的練習', nuniSource: { ...source, assignmentId: 'undated-practice' },
  }));
  expect(CampusAssignmentOpenButton).not.toHaveBeenCalled();
  expect(CampusAssignmentReminderAction).not.toHaveBeenCalled();
});

test('historical cards never invoke an injected renderer or restore actions even when live contexts are mistakenly supplied', () => {
  const renderAction = jest.fn(() => <Text>不應顯示的直接作業入口</Text>);
  const onOpenRoute = jest.fn();
  const view = render(<CampusEvidencePlanCard plan={plan()} historical disabled={false}
    renderAssignmentAction={renderAction} reminderContext={reminderContext}
    navigation={{ navigate: jest.fn() }} onOpenRoute={onOpenRoute} />);
  fireEvent.press(view.getByRole('button', { name: '查看其他 1 項作業' }));
  expect(renderAction).not.toHaveBeenCalled();
  expect(CampusAssignmentOpenButton).not.toHaveBeenCalled();
  expect(CampusAssignmentReminderAction).not.toHaveBeenCalled();
  expect(view.queryByText('不應顯示的直接作業入口')).toBeNull();
  fireEvent.press(view.getAllByRole('button', { name: '開啟課程與作業核對' })[0]);
  expect(onOpenRoute).toHaveBeenCalledWith('/classroom');
});

test('a live source field alone cannot construct an action without the current-session renderer', () => {
  const view = render(<CampusEvidencePlanCard plan={plan()} disabled={false} />);
  expect(view.queryByText('查看這份作業')).toBeNull();
  expect(CampusAssignmentOpenButton).not.toHaveBeenCalled();
  expect(CampusAssignmentReminderAction).not.toHaveBeenCalled();
});

test('an injected renderer that declines a source does not fall through into a Firebase action', () => {
  const renderAction = jest.fn(() => null);
  render(<CampusEvidencePlanCard plan={plan()} disabled={false} renderAssignmentAction={renderAction}
    reminderContext={reminderContext} navigation={{ navigate: jest.fn() }} />);
  expect(renderAction).toHaveBeenCalled();
  expect(CampusAssignmentOpenButton).not.toHaveBeenCalled();
});

test('without the platform renderer the existing live Firebase action still receives its own context', () => {
  const navigation = { navigate: jest.fn() };
  render(<CampusEvidencePlanCard plan={plan()} disabled={false}
    reminderContext={reminderContext} navigation={navigation} />);
  expect(CampusAssignmentOpenButton).toHaveBeenCalledWith(expect.objectContaining({
    assignment: expect.objectContaining({ title: '資料庫報告' }), context: reminderContext, navigation, disabled: false,
  }), undefined);
  expect(CampusAssignmentReminderAction).toHaveBeenCalled();
});

test('quiz steps, daily deadlines and undated work preserve their kind and live target without enabling assignment reminders', () => {
  const nuniQuizSource = { accountId: source.accountId, schoolId: source.schoolId,
    academicYear: source.academicYear, semester: source.semester, workspaceId: source.workspaceId, quizId: 'quiz-one' };
  const task = { kind: 'quiz' as const, title: '資料庫測驗', groupName: '資料庫',
    dueAt: '2026-11-08T18:00:00+08:00', nuniQuizSource };
  const quizPlan: CampusEvidencePlan = { ...plan(), steps: [{ ...task, id: 'quiz-one',
    detail: '參考期限 18:00，先核對課程。', priority: 'urgent', evidence: 'authorized-quizzes', route: '/classroom' }],
  agenda: buildCampusStudyAgenda({ now, window: resolveStudyWindow('今天', now)!, courses: [], assignments: null,
    quizzes: [task, { ...task, title: '未定日期測驗', dueAt: null }] }) };
  const renderAction = jest.fn((item: CampusAssignmentIdentity & NuniPlanActivityIdentity) => <Text>{'測驗入口：' + item.title}</Text>);
  const view = render(<CampusEvidencePlanCard plan={quizPlan} disabled={false} renderAssignmentAction={renderAction}
    reminderContext={reminderContext} navigation={{ navigate: jest.fn() }} />);
  expect(view.getAllByText('測驗入口：資料庫測驗')).toHaveLength(2);
  expect(view.getByText('依據：已授權測驗摘要')).toBeTruthy();
  expect(view.getByText('24 小時內 · 測驗參考期限')).toBeTruthy();
  expect(view.getByText('作業來源不可用，不能判定是否已全部完成。')).toBeTruthy();
  fireEvent.press(view.getByRole('button', { name: '查看其他 1 項課業' }));
  expect(view.getByText('測驗入口：未定日期測驗')).toBeTruthy();
  expect(renderAction.mock.calls.every(([item]) => item.kind === 'quiz' && item.nuniQuizSource === nuniQuizSource)).toBe(true);
  expect(CampusAssignmentOpenButton).not.toHaveBeenCalled();
  expect(CampusAssignmentReminderAction).not.toHaveBeenCalled();
  renderAction.mockClear();
  view.rerender(<CampusEvidencePlanCard plan={quizPlan} historical disabled={false}
    renderAssignmentAction={renderAction} reminderContext={reminderContext} navigation={{ navigate: jest.fn() }} />);
  expect(renderAction).not.toHaveBeenCalled();
  expect(view.queryByText('測驗入口：資料庫測驗')).toBeNull();
  expect(CampusAssignmentOpenButton).not.toHaveBeenCalled();
  expect(CampusAssignmentReminderAction).not.toHaveBeenCalled();
});
