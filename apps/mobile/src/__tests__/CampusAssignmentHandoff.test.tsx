import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { AIButton } from '../ui/aiFirst';
import { resolveCampusAssignmentTarget as resolveMergeBaseTarget } from './fixtures/campusAssignmentMergeBase';
import { CampusAssignmentOpenButton } from '../screens/CampusAssignmentOpenButton';
import { CampusEvidencePlanCard } from '../screens/CampusEvidencePlanCard';
import { CampusAssistantScreen } from '../screens/CampusAssistantScreen';
import { askCampusAssistant } from '../features/campusAssistant';
import { refreshCampusSenseSnapshot, type CampusSenseSnapshot } from '../services/campusSenseSnapshot';
import { confirmCampusAgentWrite } from '../features/campusAssistantActions';
import type { CampusEvidencePlan } from '../services/offlineCampusPlanner';

let mockUid: string | null = 'A';
let mockSchool = 'pu';
jest.mock('../state/auth', () => ({ useAuth: () => ({ user: mockUid ? { uid: mockUid } : null }) }));
jest.mock('../state/school', () => ({ useSchool: () => ({ selectionReady: true, selection: { schoolId: mockSchool }, school: { id: mockSchool, name: '測試校園' } }) }));
jest.mock('../features/campusAssistant', () => ({
  askCampusAssistant: jest.fn(),
  getOnDeviceAssistantReadiness: jest.fn(async () => ({ available: true, ready: false, modelId: 'qwen2.5-0.5b' })),
  OnDeviceAssistantError: class extends Error {},
}));
jest.mock('../features/campusAssistantActions', () => ({ confirmCampusAgentWrite: jest.fn() }));
jest.mock('../services/campusSenseSnapshot', () => ({
  ...jest.requireActual('../services/campusSenseSnapshot'),
  refreshCampusSenseSnapshot: jest.fn(),
}));
jest.mock('../screens/CampusAssignmentReminderAction', () => ({ CampusAssignmentReminderAction: () => null }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

const now = Date.parse('2026-10-27T06:00:00Z');
const assignment = { title: '資料庫報告', groupName: '資料庫', dueAt: '2026-10-27T12:00:00Z' };
function snapshot(): CampusSenseSnapshot {
  return {
    userId: 'A', schoolId: 'pu', checkedAt: new Date(now).toISOString(),
    schedule: { status: 'unavailable', count: null },
    assignments: { status: 'available', count: 1, items: [{ ...assignment,
      source: { kind: 'group-assignment', groupId: 'course_1', assignmentId: 'work_1' },
    }] },
    announcements: { status: 'unavailable', items: [] },
  };
}
function plan(): CampusEvidencePlan {
  return {
    title: '今日優先行動', overview: '依據已同步資料', checkedAt: new Date(now).toISOString(),
    limitations: [], content: '本機規劃',
    steps: [{ ...assignment, expectedSource: snapshot().assignments.items[0].source, id: 'assignment-0', detail: '核對繳交要求',
      evidence: 'authorized-assignments', priority: 'urgent', route: '/classroom' }],
  };
}
function context(value = snapshot()) {
  return { userId: 'A', schoolId: 'pu', snapshot: value, isCurrent: () => true };
}
beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Date, 'now').mockReturnValue(now);
  jest.mocked(askCampusAssistant).mockReset();
  jest.mocked(refreshCampusSenseSnapshot).mockReset();
  mockUid = 'A'; mockSchool = 'pu';
});
afterEach(() => jest.restoreAllMocks());

test('opens only the verified homework page, with no prefills or automatic write', () => {
  const navigate = jest.fn();
  const view = render(<CampusAssignmentOpenButton assignment={assignment} context={context()}
    navigation={{ navigate }} disabled={false} />);
  expect(navigate).not.toHaveBeenCalled();
  fireEvent.press(view.getByText('查看這份作業'));
  expect(navigate).toHaveBeenCalledWith('學習', {
    initial: false,
    screen: 'HomeworkSubmit',
    params: { groupId: 'course_1', assignmentId: 'work_1' },
  });
  expect(confirmCampusAgentWrite).not.toHaveBeenCalled();
});

const matchOptions = [true, false];
const resyncCases = ['same', 'different'].flatMap((id) =>
  matchOptions.flatMap((title) =>
    matchOptions.flatMap((course) =>
      matchOptions.map((deadline) => ({ id, title, course, deadline })))));

describe.each(['before', 'after'] as const)('%s resync', (phase) => {
  describe.each(['old', 'new'] as const)('%s screen callback', (screen) => {
    test.each(resyncCases)('ID $id, title $title, course $course, deadline $deadline', (matches) => {
      const navigate = jest.fn();
      const oldSnapshot = snapshot();
      const newSnapshot = snapshot();
      newSnapshot.checkedAt = new Date(now + 1000).toISOString();
      jest.mocked(Date.now).mockReturnValue(now + 1000);
      newSnapshot.assignments.items[0] = {
        title: matches.title ? '  資料庫報告  ' : '另一份報告',
        groupName: matches.course ? assignment.groupName : '另一門課',
        dueAt: matches.deadline ? assignment.dueAt : '2026-10-27T13:00:00Z',
        source: { kind: 'group-assignment', groupId: 'course_1',
          assignmentId: matches.id === 'same' ? 'work_1' : 'work_2' },
      };
      const refreshed = phase === 'after' ? newSnapshot : oldSnapshot;
      const button = (value: CampusSenseSnapshot, item: typeof assignment) => (
        <CampusAssignmentOpenButton assignment={item} context={context(value)}
          navigation={{ navigate }} disabled={false} />
      );
      const newAssignment = { ...assignment, title: ' 資料庫報告 ' };
      const view = render(button(oldSnapshot, assignment));
      // Retain the old event callback to model a tap on the previous screen
      // after React has rendered the next snapshot.
      const oldPress = view.UNSAFE_getByType(AIButton).props.onPress;
      view.rerender(button(refreshed, newAssignment));
      const newPress = view.UNSAFE_queryByType(AIButton)?.props.onPress;

      const target = resolveMergeBaseTarget({
        assignment: screen === 'old' ? assignment : newAssignment,
        snapshot: screen === 'old' ? oldSnapshot : refreshed,
        scope: { uid: 'A', schoolId: 'pu' },
      });
      const press = screen === 'old' ? oldPress : newPress;
      expect(Boolean(press)).toBe(Boolean(target));
      act(() => { press?.(); });
      expect(navigate.mock.calls).toEqual(target ? [[
        '學習', { initial: false, screen: target.route, params: target.params },
      ]] : []);
    });
  });
});

test('rechecks expiry at tap time and shows recovery instead of navigating stale data', () => {
  const navigate = jest.fn();
  const view = render(<CampusAssignmentOpenButton assignment={assignment} context={context()}
    navigation={{ navigate }} disabled={false} />);
  jest.mocked(Date.now).mockReturnValue(now + 900_001);
  fireEvent.press(view.getByText('查看這份作業'));
  expect(navigate).not.toHaveBeenCalled();
  expect(view.getByText(/作業來源已過期或不再相符/)).toBeTruthy();
});

test.each(['disabled', 'old-session'])('ignores navigation when %s', (reason) => {
  const navigate = jest.fn();
  const ctx = { ...context(), isCurrent: () => reason !== 'old-session' };
  const view = render(<CampusAssignmentOpenButton assignment={assignment} context={ctx}
    navigation={{ navigate }} disabled={reason === 'disabled'} />);
  fireEvent.press(view.getByText('查看這份作業'));
  expect(navigate).not.toHaveBeenCalled();
});

test('keeps the generic course entry when an older snapshot has no source IDs', () => {
  const value = snapshot();
  delete value.assignments.items[0].source;
  const onOpenRoute = jest.fn();
  const navigate = jest.fn();
  const view = render(<CampusEvidencePlanCard plan={plan()} disabled={false}
    navigation={{ navigate }} reminderContext={context(value)} onOpenRoute={onOpenRoute} />);
  expect(view.queryByText('查看這份作業')).toBeNull();
  fireEvent.press(view.getByText('開啟課程與作業核對'));
  expect(onOpenRoute).toHaveBeenCalledWith('/classroom');
  expect(navigate).not.toHaveBeenCalled();
});

test('daily and undated task entries retain exact assignment navigation', () => {
  const value = snapshot();
  value.assignments.items.push({ title: '未訂截止的作業', groupName: '程式設計', dueAt: null,
    source: { kind: 'group-assignment', groupId: 'course_2', assignmentId: 'work_2' } });
  value.assignments.count = 2;
  const fullPlan = plan();
  fullPlan.steps = [];
  fullPlan.agenda = {
    timetableAvailable: false, assignmentsAvailable: true, ignoredCourses: 0,
    days: [{ date: '2026-10-27', label: '10/27（週二）', courses: [], gaps: [], conflicts: [],
      deadlines: [{ ...assignment, expectedSource: value.assignments.items[0].source, timeLabel: '20:00', overdue: false }] }],
    outsideWindow: [{ title: '未訂截止的作業', groupName: '程式設計', dueAt: null, expectedSource: value.assignments.items[1].source, reason: 'undated' }],
  };
  const navigate = jest.fn();
  const view = render(<CampusEvidencePlanCard plan={fullPlan} disabled={false}
    navigation={{ navigate }} reminderContext={context(value)} />);
  fireEvent.press(view.getByText('查看這份作業'));
  expect(navigate).toHaveBeenLastCalledWith('學習', {
    initial: false,
    screen: 'HomeworkSubmit',
    params: { groupId: 'course_1', assignmentId: 'work_1' },
  });
  fireEvent.press(view.getByText('查看其他 1 項作業'));
  fireEvent.press(view.getAllByText('查看這份作業')[1]);
  expect(navigate).toHaveBeenLastCalledWith('學習', {
    initial: false,
    screen: 'HomeworkSubmit',
    params: { groupId: 'course_2', assignmentId: 'work_2' },
  });
});

test('the full assistant wires sync, local plan and exact homework handoff', async () => {
  jest.mocked(refreshCampusSenseSnapshot).mockResolvedValueOnce(snapshot());
  jest.mocked(askCampusAssistant).mockResolvedValueOnce({
    source: 'device', tool: 'campus-plan', content: '本機規劃', hasActions: false, plan: plan(),
  });
  const navigate = jest.fn();
  const view = render(<CampusAssistantScreen navigation={{ navigate }} />);
  fireEvent.press(view.getByText('校園工具'));
  await act(async () => fireEvent.press(view.getByText('今日重點')));
  fireEvent.press(view.getByText('查看這份作業'));
  expect(navigate).toHaveBeenCalledWith('學習', {
    initial: false,
    screen: 'HomeworkSubmit',
    params: { groupId: 'course_1', assignmentId: 'work_1' },
  });
  expect(confirmCampusAgentWrite).not.toHaveBeenCalled();
  mockSchool = 'other';
  view.rerender(<CampusAssistantScreen navigation={{ navigate }} />);
  expect(view.queryByText('查看這份作業')).toBeNull();
});
