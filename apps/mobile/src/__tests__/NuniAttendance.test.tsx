import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { NuniError, type NuniWorkspace } from '@campus/shared/src/nuni';
import { NuniCourses } from '../screens/nuni/NuniCourses';

const courseId = 'cw_11111111-1111-4111-8111-111111111111';
const secondCourseId = 'cw_22222222-2222-4222-8222-222222222222';
const sessionId = 'cws_33333333-3333-4333-8333-333333333333';
const accountId = 'pa_44444444-4444-4444-8444-444444444444';
const studentId = 'pa_55555555-5555-4555-8555-555555555555';
const base = `class-workspaces/${courseId}/classroom-sessions`;
const mockRequest = jest.fn();
const mockBffRequest = jest.fn();
let mockSession = { platformAccountId: accountId, isPlatformOperator: false, context: 'first' };

jest.mock('../state/nuniSession', () => ({
  useNuniSession: () => ({
    session: mockSession,
    request: mockRequest,
    bffRequest: mockBffRequest,
    loading: false,
    pendingLogout: false,
  }),
}));
jest.mock('../state/theme', () => ({ useTheme: () => require('../ui/theme').theme }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'intent-unique-key' }));

let course: NuniWorkspace;
let classroom: Record<string, unknown>;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { resolve, promise };
}
async function response(
  path: string,
  _context?: string,
  input?: Record<string, unknown>,
): Promise<unknown> {
  if (path === `class-workspaces/${courseId}`) return course;
  if (path === `class-workspaces/${secondCourseId}`)
    return { ...course, id: secondCourseId, title: '第二門課程' };
  if (path.endsWith('/materials/page')) return { materials: [], nextCursor: null };
  if (path.endsWith('/assignments')) return { assignments: [] };
  if (path.endsWith('/quizzes')) return { quizzes: [] };
  if (path.endsWith('/classroom-sessions')) return { sessions: [classroom] };
  if (path.endsWith('/check-in')) {
    classroom = { ...classroom, checkedInByMe: true };
    return { accepted: true };
  }
  if (path.endsWith('/roster'))
    return {
      present: [{ platformAccountId: studentId, displayName: '已簽到同學' }],
      absent: [{ platformAccountId: accountId, displayName: '缺席同學' }],
      late: [],
    };
  if (path.endsWith('/members'))
    return {
      members: [
        { platformAccountId: accountId, displayName: '授課老師', role: 'owner-teacher' },
        { platformAccountId: studentId, displayName: '修課同學', memberRole: 'student' },
      ],
    };
  throw new Error(`Unhandled fixture path: ${path} ${String(!!input)}`);
}

beforeEach(() => {
  mockRequest.mockReset();
  mockBffRequest.mockReset();
  mockSession = { platformAccountId: accountId, isPlatformOperator: false, context: 'first' };
  course = { id: courseId, title: '服務設計', memberRole: 'student', state: 'active' };
  classroom = {
    id: sessionId,
    title: '本週討論',
    state: 'open',
    checkedInByMe: false,
    checkInCount: 1,
    shortCode: 'ABC123',
  };
  mockRequest.mockImplementation(response);
});

async function openAttendance() {
  const view = render(<NuniCourses initialWorkspaceId={courseId} />);
  fireEvent.press(await view.findByRole('button', { name: '點名' }));
  await view.findByText('進行中：本週討論');
  return view;
}

it('students can open attendance without fetching either teacher roster endpoint', async () => {
  const view = await openAttendance();
  expect(view.queryByRole('button', { name: '名冊' })).toBeNull();
  expect(view.queryByText('課堂短碼：ABC123')).toBeNull();
  expect(mockRequest.mock.calls.some(([path]) => /\/(roster|members)$/.test(path))).toBe(false);
});

it.each([undefined, ' ABC123 '])(
  'checks in with the existing classroom resource and confirms server state (%s)',
  async (code) => {
    const view = await openAttendance();
    if (code) fireEvent.changeText(view.getByLabelText('簽到碼（若老師有提供）'), code);
    fireEvent.press(view.getByRole('button', { name: '簽到' }));
    await view.findByText('簽到完成。');
    expect(mockRequest).toHaveBeenCalledWith(
      `${base}/${sessionId}/check-in`,
      'first',
      code ? { code: 'ABC123' } : {},
    );
    expect(view.getByText('已簽到')).toBeTruthy();
    expect(view.queryByRole('button', { name: '簽到' })).toBeNull();
  },
);

it('keeps the entered code and allows retry when check-in is rejected', async () => {
  mockRequest.mockImplementation((path, context, input) =>
    path.endsWith('/check-in')
      ? Promise.reject(new NuniError(422, 'INVALID_CODE'))
      : response(path, context, input),
  );
  const view = await openAttendance();
  fireEvent.changeText(view.getByLabelText('簽到碼（若老師有提供）'), 'WRONG1');
  fireEvent.press(view.getByRole('button', { name: '簽到' }));
  await view.findByText('簽到未完成，請確認老師提供的簽到碼。');
  expect(view.getByLabelText('簽到碼（若老師有提供）').props.value).toBe('WRONG1');
  expect(view.queryByText('簽到完成。')).toBeNull();
  expect(view.getByRole('button', { name: '簽到' }).props.accessibilityState.disabled).toBe(false);
});

it('does not claim success when the follow-up read has no check-in receipt', async () => {
  mockRequest.mockImplementation((path, context, input) =>
    path.endsWith('/check-in')
      ? Promise.resolve({ accepted: true })
      : response(path, context, input),
  );
  const view = await openAttendance();
  fireEvent.press(view.getByRole('button', { name: '簽到' }));
  await view.findByText('尚未查到簽到紀錄，請確認簽到碼後重試。');
  expect(view.queryByText('簽到完成。')).toBeNull();
});

it('retries confirmation without posting again after the receipt read fails', async () => {
  let sent = false;
  let failRead = true;
  mockRequest.mockImplementation((path, context, input) => {
    if (path.endsWith('/check-in')) sent = true;
    if (path === base && sent && failRead) return Promise.reject(new NuniError(0, 'NETWORK_ERROR'));
    return response(path, context, input);
  });
  const view = await openAttendance();
  fireEvent.press(view.getByRole('button', { name: '簽到' }));
  await view.findByText('簽到已送出，但目前無法確認結果。請更新簽到狀態。');
  expect(view.queryByText('簽到完成。')).toBeNull();
  failRead = false;
  fireEvent.press(view.getByRole('button', { name: '更新簽到狀態' }));
  await view.findByText('簽到完成。');
  expect(mockRequest.mock.calls.filter(([path]) => path.endsWith('/check-in'))).toHaveLength(1);
});

it('checks server state before retrying a check-in whose response was lost', async () => {
  mockRequest.mockImplementation((path, context, input) => {
    if (path.endsWith('/check-in')) {
      classroom = { ...classroom, checkedInByMe: true };
      return Promise.reject(new NuniError(0, 'NETWORK_ERROR'));
    }
    return response(path, context, input);
  });
  const view = await openAttendance();
  fireEvent.press(view.getByRole('button', { name: '簽到' }));
  await view.findByText('尚未確認簽到結果，請更新簽到狀態。');
  expect(view.getByRole('button', { name: '簽到' }).props.accessibilityState.disabled).toBe(true);
  fireEvent.press(view.getByRole('button', { name: '更新簽到狀態' }));
  await view.findByText('簽到完成。');
  expect(mockRequest.mock.calls.filter(([path]) => path.endsWith('/check-in'))).toHaveLength(1);
});

it('posts a pending check-in only once when tapped repeatedly', async () => {
  const pending = deferred<unknown>();
  mockRequest.mockImplementation((path, context, input) =>
    path.endsWith('/check-in') ? pending.promise : response(path, context, input),
  );
  const view = await openAttendance();
  const button = view.getByRole('button', { name: '簽到' });
  act(() => {
    fireEvent.press(button);
    fireEvent.press(button);
  });
  expect(mockRequest.mock.calls.filter(([path]) => path.endsWith('/check-in'))).toHaveLength(1);
  await act(async () => pending.resolve({ accepted: true }));
});

it.each(['owner-teacher', 'co-teacher'] as const)(
  'allows %s to view members and grouped attendance',
  async (role) => {
    course.memberRole = role;
    const view = await openAttendance();
    await view.findByText('已簽到同學');
    expect(view.getByText('缺席同學')).toBeTruthy();
    expect(view.getByText('出席 1')).toBeTruthy();
    expect(view.getByText('缺席 1')).toBeTruthy();
    expect(view.queryByRole('button', { name: '簽到' })).toBeNull();
    fireEvent.press(view.getByRole('button', { name: '名冊' }));
    await view.findByText('修課同學');
    expect(view.getByText('授課老師')).toBeTruthy();
    expect(mockRequest).toHaveBeenCalledWith(
      `class-workspaces/${courseId}/members`,
      'first',
      undefined,
    );
  },
);

it('does not expose pending teacher roster data after a role change', async () => {
  course.memberRole = 'owner-teacher';
  const roster = deferred<unknown>();
  mockRequest.mockImplementation((path, context, input) =>
    path.endsWith('/roster') ? roster.promise : response(path, context, input),
  );
  const view = render(<NuniCourses initialWorkspaceId={courseId} />);
  fireEvent.press(await view.findByRole('button', { name: '點名' }));
  await waitFor(() =>
    expect(mockRequest.mock.calls.some(([path]) => path.endsWith('/roster'))).toBe(true),
  );
  course = { ...course, memberRole: 'student' };
  fireEvent.press(view.getByRole('button', { name: '更新內容' }));
  await view.findByRole('button', { name: '簽到' });
  await act(async () =>
    roster.resolve({
      present: [{ platformAccountId: studentId, displayName: '過期名冊姓名' }],
      absent: [],
      late: [],
    }),
  );
  expect(view.queryByText('過期名冊姓名')).toBeNull();
  expect(view.queryByRole('button', { name: '名冊' })).toBeNull();
});

it('clears the members tab when a refreshed course role becomes student', async () => {
  course.memberRole = 'owner-teacher';
  const view = render(<NuniCourses initialWorkspaceId={courseId} />);
  fireEvent.press(await view.findByRole('button', { name: '名冊' }));
  await view.findByText('修課同學');
  course = { ...course, memberRole: 'student' };
  fireEvent.press(view.getByRole('button', { name: '更新內容' }));
  await waitFor(() => expect(view.queryByRole('button', { name: '名冊' })).toBeNull());
  expect(view.queryByText('修課同學')).toBeNull();
  await waitFor(() =>
    expect(view.getByRole('button', { name: '作業 0' }).props.accessibilityState.selected).toBe(
      true,
    ),
  );
});

it('ignores an old attendance read after switching courses', async () => {
  const pending = deferred<unknown>();
  mockRequest.mockImplementation((path, context, input) =>
    path === base ? pending.promise : response(path, context, input),
  );
  const view = render(<NuniCourses initialWorkspaceId={courseId} />);
  fireEvent.press(await view.findByRole('button', { name: '點名' }));
  await waitFor(() => expect(mockRequest).toHaveBeenCalledWith(base, 'first', undefined));
  view.rerender(<NuniCourses initialWorkspaceId={secondCourseId} />);
  await view.findByText('第二門課程');
  await act(async () => pending.resolve({ sessions: [{ ...classroom, title: '過期的課堂' }] }));
  expect(view.queryByText('進行中：過期的課堂')).toBeNull();
});

it('ignores check-in completion after the account context changes', async () => {
  const pending = deferred<unknown>();
  mockRequest.mockImplementation((path, context, input) =>
    path.endsWith('/check-in') ? pending.promise : response(path, context, input),
  );
  const view = await openAttendance();
  fireEvent.press(view.getByRole('button', { name: '簽到' }));
  mockSession = { ...mockSession, platformAccountId: studentId, context: 'second' };
  view.rerender(<NuniCourses initialWorkspaceId={courseId} />);
  await view.findByRole('button', { name: '點名' });
  await act(async () => pending.resolve({ accepted: true }));
  expect(view.queryByText('簽到完成。')).toBeNull();
  expect(mockRequest.mock.calls.filter(([path]) => path === base)).toHaveLength(1);
});

it.each(['classroom-sessions', 'check-in', 'roster', 'members'])(
  'clears course details after access is denied by %s',
  async (endpoint) => {
    if (endpoint === 'roster' || endpoint === 'members') course.memberRole = 'owner-teacher';
    mockRequest.mockImplementation((path, context, input) =>
      path.endsWith(`/${endpoint}`)
        ? Promise.reject(new NuniError(403, 'FORBIDDEN'))
        : response(path, context, input),
    );
    const view = render(<NuniCourses initialWorkspaceId={courseId} />);
    fireEvent.press(
      await view.findByRole('button', { name: endpoint === 'members' ? '名冊' : '點名' }),
    );
    if (endpoint === 'check-in') fireEvent.press(await view.findByRole('button', { name: '簽到' }));
    await view.findByText('目前無法存取這門課程，請更新內容後確認權限。');
    expect(view.queryByText('服務設計')).toBeNull();
    expect(view.queryByRole('button', { name: '名冊' })).toBeNull();
    expect(view.queryByRole('button', { name: '簽到' })).toBeNull();
  },
);

it('keeps archived attendance readable without offering check-in', async () => {
  course.state = 'archived';
  const view = await openAttendance();
  expect(view.queryByRole('button', { name: '簽到' })).toBeNull();
});

it('preserves the in-flight check-in and confirmation across tabs', async () => {
  const pending = deferred<unknown>();
  mockRequest.mockImplementation((path, context, input) =>
    path.endsWith('/check-in') ? pending.promise : response(path, context, input),
  );
  const view = await openAttendance();
  fireEvent.press(view.getByRole('button', { name: '簽到' }));
  fireEvent.press(view.getByRole('button', { name: '作業 0' }));
  fireEvent.press(view.getByRole('button', { name: '點名' }));
  const button = await view.findByRole('button', { name: '正在確認簽到…' });
  fireEvent.press(button);
  expect(button.props.accessibilityState.disabled).toBe(true);
  await act(async () => pending.resolve({ accepted: true }));
  await view.findByText('簽到待確認，請更新簽到狀態。');
  fireEvent.press(view.getByRole('button', { name: '簽到' }));
  expect(mockRequest.mock.calls.filter(([path]) => path.endsWith('/check-in'))).toHaveLength(1);
});
