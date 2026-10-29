import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { CampusAttentionCard } from '../screens/CampusAttentionCard';
import { safeNavigate } from '../utils/safeNavigate';
import { CAMPUS_SENSE_MAX_AGE_MS, type CampusSenseSnapshot } from '../services/campusSenseSnapshot';

const mockReminder = jest.fn(() => null);
jest.mock('../screens/CampusAssignmentReminderAction', () => ({
  CampusAssignmentReminderAction: (props: unknown) => mockReminder(props),
}));
jest.mock('../utils/safeNavigate', () => ({ safeNavigate: jest.fn() }));


const NOW = Date.parse('2026-10-29T10:00:00Z');
const snapshot: CampusSenseSnapshot = {
  userId: 'alice', schoolId: 'pu',
  checkedAt: new Date(NOW - 60_000).toISOString(),
  schedule: { status: 'unavailable', count: null },
  assignments: {
    status: 'available', count: 3,
    items: [
      { title: '資料庫作業', groupName: '資料庫', dueAt: new Date(NOW + 2 * 3600_000).toISOString(),
        source: { kind: 'group-assignment', groupId: 'db-course', assignmentId: 'work-one' } },
      { title: '報告進度', groupName: '英文', dueAt: null },
      { title: '另一份作業', groupName: '程式', dueAt: new Date(NOW + 2 * 86_400_000).toISOString() },
    ],
  },
  announcements: { status: 'unavailable', items: [] },
};

beforeEach(() => {
  mockReminder.mockClear();
  jest.mocked(safeNavigate).mockClear();
});
afterEach(() => jest.restoreAllMocks());

test('shows actual source deadlines after a verified sync and opens only a checked task', () => {
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
  const navigation = { navigate: jest.fn() };
  const view = render(<CampusAttentionCard snapshot={snapshot}
    context={{ userId: 'alice', schoolId: 'pu', isCurrent: () => true, navigation }}
    disabled={false} />);
  expect(view.getByText('先確認這幾件事')).toBeTruthy();
  expect(view.getByText('24 小時內截止')).toBeTruthy();
  expect(view.getByText('資料庫作業')).toBeTruthy();
  expect(view.getByText(/僅顯示可能需要注意的期限/)).toBeTruthy();
  expect(mockReminder).toHaveBeenCalledTimes(1);
  expect(mockReminder).toHaveBeenCalledWith(expect.objectContaining({
    step: expect.objectContaining({
      evidence: 'authorized-assignments',
      route: '/classroom',
      dueAt: snapshot.assignments.items[0].dueAt,
    }),
    userId: 'alice',
    schoolId: 'pu',
  }));
  fireEvent.press(view.getByText('查看這份作業'));
  expect(safeNavigate).toHaveBeenCalledWith(navigation, 'HomeworkSubmit', {
    groupId: 'db-course', assignmentId: 'work-one',
  });
});

test('does not render stale or other-account data even when passed a stale prop', () => {
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
  const other = render(<CampusAttentionCard snapshot={snapshot}
    context={{ userId: 'bob', schoolId: 'pu', isCurrent: () => true }}
    disabled={false} />);
  expect(other.queryByText('資料庫作業')).toBeNull();

  jest.spyOn(Date, 'now').mockReturnValue(
    Date.parse(snapshot.checkedAt) + CAMPUS_SENSE_MAX_AGE_MS + 1,
  );
  const stale = render(<CampusAttentionCard snapshot={snapshot}
    context={{ userId: 'alice', schoolId: 'pu', isCurrent: () => true }}
    disabled={false} />);
  expect(stale.queryByText('資料庫作業')).toBeNull();
  expect(safeNavigate).not.toHaveBeenCalled();
});
