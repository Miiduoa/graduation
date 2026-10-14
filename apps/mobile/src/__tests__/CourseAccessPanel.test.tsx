import React from 'react';
import type { ReactNode } from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import type { PersonalImportRow } from '@campus/shared';
import type { NuniWorkspace } from '@campus/shared/src/nuni';
import { CourseAccessPanel } from '../components/CourseAccessPanel';

const mockRequest = jest.fn();
const mockSession = {
  platformAccountId: 'pa_11111111-1111-4111-8111-111111111111',
  context: 'a'.repeat(43),
  isPlatformOperator: false,
};
jest.mock('../state/nuniSession', () => ({
  useNuniSession: () => ({
    session: mockSession, loading: false, pendingLogout: false, request: mockRequest,
  }),
}));
jest.mock('../ui/components', () => {
  const { Pressable, Text } = require('react-native');
  return {
    Button: ({
      text, disabled, onPress,
    }: { text: string; disabled?: boolean; onPress?: () => void; children?: ReactNode }) => (
      <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!disabled }}
        disabled={disabled} onPress={onPress}>
        <Text>{text}</Text>
      </Pressable>
    ),
  };
});

const id = (prefix: string) => `${prefix}_00000000-0000-4000-8000-000000000001`;
const row = {
  id: 'import-1', kind: 'timetable', schoolId: 'pu', academicYear: '115', semester: '1',
  title: '資料庫', courseCode: 'IM301', teacher: '王老師', className: '資管三B',
} as PersonalImportRow;
const workspace: NuniWorkspace = { id: id('cw'), title: '資料庫｜資管三B', state: 'active', memberRole: 'student' };
const approval = {
  id: id('car'), kind: 'student', state: 'approved', version: 2,
  workspaceId: workspace.id, courseId: id('ccd'),
  metadata: { schoolId: 'pu', academicYear: '115', semester: '1', title: row.title,
    courseCode: row.courseCode, teacher: row.teacher, className: row.className },
  statement: '', decisionReason: null, createdAt: '2026-10-14T04:00:00.000Z', membershipActive: true,
};

beforeEach(() => {
  mockRequest.mockReset();
  mockSession.context = 'a'.repeat(43);
});

test('an approved student can select an existing course without auto-saving the personal row', async () => {
  mockRequest.mockResolvedValue({ requests: [approval], nextCursor: null });
  const reload = jest.fn(), choose = jest.fn();
  const screen = render(<CourseAccessPanel row={row} workspaces={[workspace]}
    onRefreshWorkspaces={reload} onSelectLinkedCourse={choose} />);
  fireEvent.press(screen.getByText('查找課班與申請加入'));
  fireEvent.press(screen.getByText('重新查詢我的申請'));
  await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  const link = screen.getByText('選擇已核准課班：資料庫｜資管三B');
  fireEvent.press(link);
  expect(choose).toHaveBeenCalledTimes(1);
  expect(choose).toHaveBeenCalledWith(workspace.id);
  expect(row.linkedCourseId).toBeUndefined();
  expect(mockRequest).toHaveBeenCalledWith('course-access/requests', mockSession.context, { cursor: null });
});

test('no quick link is offered for a revoked or non-student membership', async () => {
  mockRequest.mockResolvedValue({ requests: [approval], nextCursor: null });
  const choose = jest.fn();
  const screen = render(<CourseAccessPanel row={row}
    workspaces={[{ ...workspace, memberRole: 'owner-teacher' }]} onSelectLinkedCourse={choose} />);
  fireEvent.press(screen.getByText('查找課班與申請加入'));
  fireEvent.press(screen.getByText('重新查詢我的申請'));
  await waitFor(() => expect(screen.getByText(/尚未核對到可直接連結的課班/)).toBeTruthy());
  expect(screen.queryByText(/選擇已核准課班：/)).toBeNull();
  expect(choose).not.toHaveBeenCalled();
});
