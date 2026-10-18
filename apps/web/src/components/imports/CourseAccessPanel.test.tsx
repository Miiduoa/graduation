import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { PersonalImportRow } from '@campus/shared';
import type { NuniWorkspace } from '@campus/shared/src/nuni';
import { CourseAccessPanel } from './CourseAccessPanel';

const state = vi.hoisted(() => ({
  request: vi.fn(),
  context: 'a'.repeat(43),
  signedIn: true,
}));
vi.mock('@/features/nuni/Session', () => ({
  browserRequest: (...args: unknown[]) => state.request(...args),
  useOptionalNuniSession: () => ({
    session: state.signedIn
      ? { platformAccountId: 'pa_11111111-1111-4111-8111-111111111111',
          context: state.context, isPlatformOperator: false }
      : null,
    loading: false,
    pendingLogout: false,
  }),
}));

const id = (prefix: string, n = 1) =>
  `${prefix}_00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const row = {
  id: 'source-1',
  kind: 'timetable',
  schoolId: 'pu',
  academicYear: '115',
  semester: '1',
  title: '資料庫',
  courseCode: 'IM301',
  teacher: '王老師',
  className: '資管三B',
} as PersonalImportRow;
const workspace: NuniWorkspace = {
  id: id('cw'),
  title: '資料庫｜資管三B',
  state: 'active',
  memberRole: 'student',
};
const approved = {
  id: id('car'),
  kind: 'student',
  state: 'approved',
  version: 2,
  workspaceId: workspace.id,
  courseId: id('ccd'),
  metadata: {
    schoolId: 'pu', academicYear: '115', semester: '1',
    title: row.title, courseCode: row.courseCode, teacher: row.teacher, className: row.className,
  },
  statement: '',
  decisionReason: '已核實',
  createdAt: '2026-10-14T04:00:00.000Z',
  membershipActive: true,
};
beforeEach(() => {
  state.request.mockReset();
  state.context = 'a'.repeat(43);
  state.signedIn = true;
});

it('offers a personal-record link only after an approved request and active student workspace', async () => {
  state.request.mockResolvedValue({ requests: [approved], nextCursor: null });
  const refresh = vi.fn();
  const choose = vi.fn();
  const view = render(<CourseAccessPanel row={row} workspaces={[]} onRefreshWorkspaces={refresh} onSelectLinkedCourse={choose} />);
  fireEvent.click(screen.getByText('查找課班與申請加入'));
  fireEvent.click(screen.getByRole('button', { name: '重新查詢申請狀態' }));
  await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  expect(screen.queryByRole('button', { name: /選擇已核准課班/ })).toBeNull();
  view.rerender(<CourseAccessPanel row={row} workspaces={[workspace]} onRefreshWorkspaces={refresh} onSelectLinkedCourse={choose} />);
  const button = await screen.findByRole('button', { name: /選擇已核准課班/ });
  fireEvent.click(button);
  expect(choose).toHaveBeenCalledTimes(1);
  expect(choose).toHaveBeenCalledWith(workspace.id);
  view.rerender(<CourseAccessPanel row={{ ...row, linkedCourseId: workspace.id }} workspaces={[workspace]} onRefreshWorkspaces={refresh} onSelectLinkedCourse={choose} />);
  expect(state.request).toHaveBeenCalledWith('course-access/requests', state.context, { cursor: null });
  expect(screen.getByText(/儲存個人紀錄後才生效/)).toBeTruthy();
});

it('does not expose a shortcut for a mismatched student, campus term or revoked membership', async () => {
  state.request.mockResolvedValue({ requests: [approved], nextCursor: null });
  const choose = vi.fn();
  const view = render(<CourseAccessPanel row={row} workspaces={[{ ...workspace, memberRole: 'owner-teacher' }]} onSelectLinkedCourse={choose} />);
  fireEvent.click(screen.getByText('查找課班與申請加入'));
  fireEvent.click(screen.getByRole('button', { name: '重新查詢申請狀態' }));
  await screen.findByText(/尚未核對到可安全直接連結的課班/);
  expect(screen.queryByRole('button', { name: /選擇已核准課班/ })).toBeNull();
  view.rerender(<CourseAccessPanel row={{ ...row, semester: '2' }} workspaces={[workspace]} onSelectLinkedCourse={choose} />);
  expect(screen.queryByRole('button', { name: /選擇已核准課班/ })).toBeNull();
  expect(choose).not.toHaveBeenCalled();
});

it('discards pending status results after an account changes', async () => {
  let resolve!: (value: unknown) => void;
  state.request.mockReturnValue(new Promise((finish) => { resolve = finish; }));
  const choose = vi.fn();
  const view = render(<CourseAccessPanel row={row} workspaces={[workspace]} onSelectLinkedCourse={choose} />);
  fireEvent.click(screen.getByText('查找課班與申請加入'));
  fireEvent.click(screen.getByRole('button', { name: '重新查詢申請狀態' }));
  state.context = 'b'.repeat(43);
  view.rerender(<CourseAccessPanel row={row} workspaces={[]} onSelectLinkedCourse={choose} />);
  await act(async () => resolve({ requests: [approved], nextCursor: null }));
  expect(screen.queryByRole('button', { name: /選擇已核准課班/ })).toBeNull();
  expect(choose).not.toHaveBeenCalled();
});

it.each(['grades', 'events'] as const)('allows %s records to search without sending grades or event details', async kind => {
  state.request.mockResolvedValue({ candidates: [], truncated: false });
  render(<CourseAccessPanel row={{ ...row, kind, grade: '95', date: '2026-10-15', source: { type: 'paste', line: 1, rawText: 'private' } }} workspaces={[]} />);
  fireEvent.click(screen.getByRole('button', { name: '查找可能對應課班' }));
  await waitFor(() => expect(state.request).toHaveBeenCalled());
  expect(state.request.mock.calls[0][2]).toEqual(approved.metadata);
});
it('reads server teacher metadata without replacing the imported teacher hint', async () => {
  state.request.mockResolvedValue({ status: 'reviewed', workspaceId: workspace.id, membershipActive: true, memberRole: 'student', course: { ...approved.metadata, teacher: '經核對的老師', id: id('ccd'), workspaceId: workspace.id, version: 1, verification: 'administrator-reviewed' } });
  render(<CourseAccessPanel row={{ ...row, linkedCourseId: workspace.id }} workspaces={[workspace]} />);
  fireEvent.click(screen.getByRole('button', { name: '核對目前課班與教師資料' }));
  expect(await screen.findByText('經管理員核對的授課者：經核對的老師')).toBeTruthy();
  expect(row.teacher).toBe('王老師');
});
it('discards a linked-course readback after switching the linked workspace', async () => {
  let resolve!: (value: unknown) => void;
  state.request.mockReturnValue(new Promise(finish => { resolve = finish; }));
  const view = render(<CourseAccessPanel row={{ ...row, linkedCourseId: workspace.id }} workspaces={[workspace]} />);
  fireEvent.click(screen.getByRole('button', { name: '核對目前課班與教師資料' }));
  view.rerender(<CourseAccessPanel row={{ ...row, linkedCourseId: id('cw', 2) }} workspaces={[workspace]} />);
  await act(async () => resolve({ status: 'reviewed', workspaceId: workspace.id, membershipActive: true, memberRole: 'student', course: { ...approved.metadata, teacher: '過期老師', id: id('ccd'), workspaceId: workspace.id, version: 1, verification: 'administrator-reviewed' } }));
  expect(screen.queryByText(/過期老師/)).toBeNull();
});
