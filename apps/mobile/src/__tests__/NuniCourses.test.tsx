import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { NuniError, type NuniWorkspace } from '@campus/shared/src/nuni';
import { NuniCourses } from '../screens/nuni/NuniCourses';

const courseId = 'cw_11111111-1111-4111-8111-111111111111';
const assignmentId = 'cwa_22222222-2222-4222-8222-222222222222';
const quizId = 'cwq_33333333-3333-4333-8333-333333333333';
const accountId = 'pa_44444444-4444-4444-8444-444444444444';
const date = '2026-10-09T03:00:00.000Z';
let mockSession = {
  platformAccountId: accountId,
  isPlatformOperator: false,
  context: 'context-first',
};
const mockRequest = jest.fn();
let mockUuid = 0;
jest.mock('../state/nuniSession', () => ({
  useNuniSession: () => ({
    session: mockSession,
    request: mockRequest,
    loading: false,
    pendingLogout: false,
  }),
}));
jest.mock('../state/theme', () => ({ useTheme: () => require('../ui/theme').theme }));
jest.mock('expo-crypto', () => ({ randomUUID: () => `intent-${++mockUuid}-unique-key` }));

let course: NuniWorkspace;
let assignment: Record<string, unknown>;
let quiz: Record<string, unknown>;
function receipt(body = '我的訪談內容') {
  return {
    assignmentId,
    platformAccountId: accountId,
    displayName: '測試學生',
    body,
    state: 'submitted',
    submittedAt: date,
    teacherFeedback: null,
    reviewedAt: null,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function response(
  path: string,
  _context?: string,
  input?: Record<string, unknown>,
): Promise<unknown> {
  if (path === 'class-workspaces')
    return input
      ? { ...course, title: input.title, memberRole: 'owner-teacher' }
      : { workspaces: [course] };
  if (path === 'class-workspaces/join') return course;
  if (path === `class-workspaces/${courseId}`) return course;
  if (path.endsWith('/materials')) return { materials: [] };
  if (path.endsWith('/assignments'))
    return input
      ? { ...assignment, title: input.title, instructions: input.instructions }
      : { assignments: [assignment] };
  if (path.endsWith('/quizzes')) return { quizzes: [quiz] };
  if (path.endsWith('/invites')) return { code: 'ABC123' };
  if (path.endsWith('/submissions')) return { submissions: [receipt()] };
  if (path.endsWith('/feedback'))
    return { ...receipt(), teacherFeedback: input!.feedback, reviewedAt: date };
  if (path.endsWith(`/assignments/${assignmentId}/submit`)) {
    assignment = {
      ...assignment,
      mySubmission: receipt(input!.body as string),
      submissionCount: 1,
    };
    return assignment;
  }
  if (path.endsWith(`/quizzes/${quizId}/submit`)) {
    quiz = {
      ...quiz,
      responseCount: 1,
      myResponse: {
        quizId,
        platformAccountId: accountId,
        displayName: '測試學生',
        answer: input!.answer,
        state: 'submitted',
        submittedAt: date,
        teacherFeedback: null,
        reviewedAt: null,
      },
    };
    return quiz;
  }
  throw new Error(`Unhandled fixture path: ${path}`);
}
beforeEach(() => {
  mockUuid = 0;
  mockRequest.mockReset();
  mockSession = {
    platformAccountId: accountId,
    isPlatformOperator: false,
    context: 'context-first',
  };
  course = { id: courseId, title: '服務設計課程', state: 'active', memberRole: 'student' };
  const activity = {
    workspaceId: courseId,
    state: 'open',
    createdAt: date,
    closedAt: null,
    dueAt: null,
    unitId: null,
    unitTitle: null,
  };
  assignment = {
    ...activity,
    id: assignmentId,
    title: '校園訪談',
    instructions: '請記錄訪談重點。',
    submissionCount: 0,
    mySubmission: null,
  };
  quiz = {
    ...activity,
    id: quizId,
    title: '需求練習',
    prompt: '說明觀察到的需求。',
    responseCount: 0,
    myResponse: null,
  };
  mockRequest.mockImplementation(response);
});
async function openCourse() {
  const view = render(<NuniCourses />);
  fireEvent.press(await view.findByRole('button', { name: '服務設計課程' }));
  await view.findByText('校園訪談');
  return view;
}

it('groups real roles and opens the same platform course contract using captured session context', async () => {
  const view = render(<NuniCourses />);
  await view.findByText('修習課程 · 1');
  expect(view.getByText('授課與協作 · 0')).toBeTruthy();
  expect(mockRequest).toHaveBeenCalledWith('class-workspaces', 'context-first', undefined);
  fireEvent.press(view.getByRole('button', { name: '服務設計課程' }));
  await view.findByText('1 份待繳作業');
  expect(view.queryByRole('button', { name: '產生學生邀請碼' })).toBeNull();
});
it('adds a server-confirmed receipt and removes the assignment from pending work', async () => {
  const view = await openCourse();
  fireEvent.changeText(view.getByLabelText('作業內容：校園訪談'), '我的訪談內容');
  fireEvent.press(view.getByRole('button', { name: '繳交作業' }));
  await view.findByText('已收到伺服器繳交紀錄。');
  expect(view.getByText('0 份待繳作業')).toBeTruthy();
  expect(view.getByText('已繳交')).toBeTruthy();
  expect(view.getByText('我的訪談內容')).toBeTruthy();
});
it('locks a double tap and preserves the payload and idempotency key after an unknown response', async () => {
  const view = await openCourse();
  const uncertain = deferred<unknown>();
  mockRequest.mockImplementation((path, context, input) =>
    path.endsWith('/submit') ? uncertain.promise : response(path, context, input),
  );
  fireEvent.changeText(view.getByLabelText('作業內容：校園訪談'), '保留這次內容');
  const button = view.getByRole('button', { name: '繳交作業' });
  act(() => {
    fireEvent.press(button);
    fireEvent.press(button);
  });
  const writes = () => mockRequest.mock.calls.filter(([path]) => path.endsWith('/submit'));
  expect(writes()).toHaveLength(1);
  await act(async () => {
    uncertain.resolve(Promise.reject(new NuniError(0, 'NETWORK_ERROR')));
  });
  await view.findByRole('button', { name: '重試確認這次送出' });
  const first = writes()[0][2];
  expect(view.getByLabelText('作業內容：校園訪談').props.editable).toBe(false);
  mockRequest.mockImplementation(response);
  fireEvent.press(view.getByRole('button', { name: '重試確認這次送出' }));
  await view.findByText('已收到伺服器繳交紀錄。');
  expect(writes()[1][2]).toEqual(first);
});
it('keeps a draft when switching activity tabs and submits a quiz via its own endpoint', async () => {
  const view = await openCourse();
  fireEvent.changeText(view.getByLabelText('作業內容：校園訪談'), '尚未送出的草稿');
  fireEvent.press(view.getByRole('button', { name: '測驗 1' }));
  fireEvent.changeText(view.getByLabelText('測驗內容：需求練習'), '改善課程入口');
  fireEvent.press(view.getByRole('button', { name: '繳交測驗' }));
  await view.findByText('已收到伺服器繳交紀錄。');
  expect(mockRequest.mock.calls.some(([path]) => path.endsWith(`/quizzes/${quizId}/submit`))).toBe(
    true,
  );
  fireEvent.press(view.getByRole('button', { name: '作業 1' }));
  expect(view.getByLabelText('作業內容：校園訪談').props.value).toBe('尚未送出的草稿');
});
it('does not expose forms for archived or closed activities', async () => {
  course = { ...course, state: 'archived' };
  const view = await openCourse();
  expect(view.queryByRole('button', { name: '繳交作業' })).toBeNull();
  expect(view.getByText('這門課已封存，現在只能查看保留的紀錄。')).toBeTruthy();
});
it('distinguishes failed loads from an empty course list and retries', async () => {
  mockRequest.mockRejectedValueOnce(new NuniError(0, 'NETWORK_ERROR'));
  const view = render(<NuniCourses />);
  await view.findByText('目前無法連線。請保留填寫內容，稍後重試。');
  expect(view.queryByText('尚未加入修習課程。請向老師取得邀請碼。')).toBeNull();
  fireEvent.press(view.getByRole('button', { name: '更新課程' }));
  await view.findByText('修習課程 · 1');
});
it('clears drafts and loaded content immediately when the verified account context changes', async () => {
  const view = await openCourse();
  fireEvent.changeText(view.getByLabelText('作業內容：校園訪談'), '前一位同學的草稿');
  mockSession = {
    ...mockSession,
    context: 'context-second',
    platformAccountId: 'pa_55555555-5555-4555-8555-555555555555',
  };
  mockRequest.mockResolvedValue({ workspaces: [] });
  view.rerender(<NuniCourses />);
  await view.findByText('尚未加入修習課程。請向老師取得邀請碼。');
  expect(view.queryByText('校園訪談')).toBeNull();
  expect(view.queryByDisplayValue('前一位同學的草稿')).toBeNull();
});
it('offers owner invites and records real teacher feedback', async () => {
  course = { ...course, memberRole: 'owner-teacher' };
  const view = await openCourse();
  fireEvent.press(view.getByRole('button', { name: '產生學生邀請碼' }));
  await view.findByText('學生邀請碼：ABC123');
  fireEvent.press(view.getByRole('button', { name: '查看收件：校園訪談' }));
  await view.findByText('測試學生');
  fireEvent.changeText(view.getByLabelText('給 測試學生 的回饋'), '請補上受訪者的具體例子。');
  fireEvent.press(view.getByRole('button', { name: '儲存老師回饋' }));
  await view.findByText('已回饋：請補上受訪者的具體例子。');
});
it('permits co-teacher teaching work without granting owner invitations', async () => {
  course = { ...course, memberRole: 'co-teacher' };
  const view = await openCourse();
  expect(view.queryByRole('button', { name: '產生學生邀請碼' })).toBeNull();
  expect(view.getByRole('button', { name: '查看收件：校園訪談' })).toBeTruthy();
  fireEvent.press(view.getByRole('button', { name: '新增作業' }));
  fireEvent.changeText(view.getByLabelText('作業標題'), '第二次訪談');
  fireEvent.changeText(view.getByLabelText('作業說明'), '確認訪談問題');
  fireEvent.press(view.getByRole('button', { name: '發布作業' }));
  await view.findByText('作業已發布。');
  expect(view.getByText('第二次訪談')).toBeTruthy();
});
it('joins with a real invitation and does not promote the account to a school role', async () => {
  const view = render(<NuniCourses />);
  await view.findByText('修習課程 · 1');
  fireEvent.press(view.getByRole('button', { name: '加入課程' }));
  fireEvent.changeText(view.getByLabelText('老師提供的邀請碼'), 'ABC123');
  fireEvent.press(view.getByRole('button', { name: '確認加入' }));
  await view.findByText('校園訪談');
  await waitFor(() =>
    expect(mockRequest).toHaveBeenCalledWith(
      'class-workspaces/join',
      'context-first',
      expect.objectContaining({ code: 'ABC123' }),
    ),
  );
  expect(mockRequest.mock.calls.every(([path]) => path.startsWith('class-workspaces'))).toBe(true);
});
it('does not turn a denied submission into success or remove pending work', async () => {
  const view = await openCourse();
  mockRequest.mockRejectedValueOnce(new NuniError(403, 'FORBIDDEN'));
  fireEvent.changeText(view.getByLabelText('作業內容：校園訪談'), '保留未確認的內容');
  fireEvent.press(view.getByRole('button', { name: '繳交作業' }));
  await view.findByText('你目前沒有這項操作的權限。');
  expect(view.queryByText('已繳交')).toBeNull();
  expect(view.getByText('1 份待繳作業')).toBeTruthy();
  expect(view.getByLabelText('作業內容：校園訪談').props.value).toBe('保留未確認的內容');
});
it('ignores the previous account course list when its slow response arrives late', async () => {
  const first = deferred<unknown>();
  mockRequest.mockImplementationOnce(() => first.promise);
  const view = render(<NuniCourses />);
  mockSession = { ...mockSession, context: 'context-replaced' };
  mockRequest.mockResolvedValueOnce({ workspaces: [] });
  view.rerender(<NuniCourses />);
  await view.findByText('尚未加入修習課程。請向老師取得邀請碼。');
  await act(async () => {
    first.resolve({ workspaces: [course] });
  });
  expect(view.queryByRole('button', { name: course.title })).toBeNull();
});
it('removes teacher receipts and controls when an updated course grants only student access', async () => {
  course = { ...course, memberRole: 'owner-teacher' };
  const view = await openCourse();
  fireEvent.press(view.getByRole('button', { name: '查看收件：校園訪談' }));
  await view.findByText('測試學生');
  course = { ...course, memberRole: 'student' };
  fireEvent.press(view.getByRole('button', { name: '更新內容' }));
  await view.findByRole('button', { name: '繳交作業' });
  expect(view.queryByText('測試學生')).toBeNull();
  expect(view.queryByRole('button', { name: '產生學生邀請碼' })).toBeNull();
});
it('retains an uncertain publishing request across tabs and retries the original intent', async () => {
  course = { ...course, memberRole: 'owner-teacher' };
  const view = await openCourse();
  fireEvent.press(view.getByRole('button', { name: '新增作業' }));
  fireEvent.changeText(view.getByLabelText('作業標題'), '待確認的新作業');
  fireEvent.changeText(view.getByLabelText('作業說明'), '請完成校園訪談');
  mockRequest.mockRejectedValueOnce(new NuniError(503, 'UNAVAILABLE'));
  fireEvent.press(view.getByRole('button', { name: '發布作業' }));
  await view.findByRole('button', { name: '重試確認這次送出' });
  const first = mockRequest.mock.calls.find(
    ([path, _context, input]) => path.endsWith('/assignments') && input,
  )?.[2];
  fireEvent.press(view.getByRole('button', { name: '教材 0' }));
  fireEvent.press(view.getByRole('button', { name: '作業 1' }));
  expect(view.getByLabelText('作業標題').props.value).toBe('待確認的新作業');
  fireEvent.press(view.getByRole('button', { name: '重試確認這次送出' }));
  await view.findByText('作業已發布。');
  const writes = mockRequest.mock.calls.filter(
    ([path, _context, input]) => path.endsWith('/assignments') && input,
  );
  expect(writes).toHaveLength(2);
  expect(writes[1][2]).toEqual(first);
});

it.each(['student', 'archived'] as const)(
  'does not let an older publishing response cancel a newer %s authority refresh',
  async (change) => {
    course = { ...course, memberRole: 'owner-teacher' };
    const view = await openCourse();
    fireEvent.press(view.getByRole('button', { name: '查看收件：校園訪談' }));
    await view.findByText('測試學生');
    const writing = deferred<unknown>();
    const authority = deferred<unknown>();
    let interceptAuthority = true;
    mockRequest.mockImplementation((path, context, input) => {
      if (path.endsWith('/assignments') && input) return writing.promise;
      if (path === `class-workspaces/${courseId}` && interceptAuthority) {
        interceptAuthority = false;
        return authority.promise;
      }
      return response(path, context, input);
    });
    fireEvent.press(view.getByRole('button', { name: '新增作業' }));
    fireEvent.changeText(view.getByLabelText('作業標題'), '回覆尚在途中');
    fireEvent.changeText(view.getByLabelText('作業說明'), '已送出但仍等待回覆');
    fireEvent.press(view.getByRole('button', { name: '發布作業' }));
    fireEvent.press(view.getByRole('button', { name: '更新內容' }));
    await act(async () => {
      writing.resolve({ ...assignment, title: '回覆尚在途中' });
    });
    expect(view.getByText('正在讀取課程內容…')).toBeTruthy();
    expect(view.queryByText('測試學生')).toBeNull();
    expect(view.queryByRole('button', { name: '產生學生邀請碼' })).toBeNull();
    // The delayed write must wait for the newer read; it may not replace or cancel it.
    expect(
      mockRequest.mock.calls.filter(([path]) => path === `class-workspaces/${courseId}`),
    ).toHaveLength(2);
    course =
      change === 'student'
        ? { ...course, memberRole: 'student' }
        : { ...course, state: 'archived' };
    await act(async () => {
      authority.resolve(course);
    });
    await waitFor(() => expect(view.queryByText('正在讀取課程內容…')).toBeNull());
    expect(view.queryByRole('button', { name: '產生學生邀請碼' })).toBeNull();
    expect(view.queryByRole('button', { name: '新增作業' })).toBeNull();
    expect(view.queryByText('測試學生')).toBeNull();
  },
);

it('keeps newer archive verification masked when an older submission receipt arrives', async () => {
  const view = await openCourse();
  const writing = deferred<unknown>();
  const authority = deferred<unknown>();
  let interceptAuthority = true;
  mockRequest.mockImplementation((path, context, input) => {
    if (path.endsWith('/submit')) return writing.promise;
    if (path === `class-workspaces/${courseId}` && interceptAuthority) {
      interceptAuthority = false;
      return authority.promise;
    }
    return response(path, context, input);
  });
  fireEvent.changeText(view.getByLabelText('作業內容：校園訪談'), '已完成的繳交');
  fireEvent.press(view.getByRole('button', { name: '繳交作業' }));
  fireEvent.press(view.getByRole('button', { name: '更新內容' }));
  assignment = { ...assignment, mySubmission: receipt('已完成的繳交'), submissionCount: 1 };
  await act(async () => {
    writing.resolve(assignment);
  });
  expect(view.getByText('正在讀取課程內容…')).toBeTruthy();
  expect(view.queryByRole('button', { name: '更新作業繳交' })).toBeNull();
  course = { ...course, state: 'archived' };
  await act(async () => {
    authority.resolve(course);
  });
  await view.findByText('這門課已封存，現在只能查看保留的紀錄。');
  expect(view.getByText('已繳交')).toBeTruthy();
  expect(view.queryByRole('button', { name: '更新作業繳交' })).toBeNull();
});

it('does not restore teacher receipts when an old feedback response races a newer denied read', async () => {
  course = { ...course, memberRole: 'owner-teacher' };
  const view = await openCourse();
  fireEvent.press(view.getByRole('button', { name: '查看收件：校園訪談' }));
  await view.findByText('測試學生');
  const feedback = deferred<unknown>();
  const denied = deferred<unknown>();
  let firstRead = true;
  mockRequest.mockImplementation((path, context, input) => {
    if (path.endsWith('/feedback')) return feedback.promise;
    if (path.endsWith('/submissions')) {
      if (firstRead) {
        firstRead = false;
        return denied.promise;
      }
      return Promise.reject(new NuniError(403, 'FORBIDDEN'));
    }
    return response(path, context, input);
  });
  fireEvent.changeText(view.getByLabelText('給 測試學生 的回饋'), '稍後完成的回饋');
  fireEvent.press(view.getByRole('button', { name: '儲存老師回饋' }));
  fireEvent.press(view.getByRole('button', { name: '查看收件：校園訪談' }));
  await act(async () => {
    feedback.resolve({ ...receipt(), teacherFeedback: '稍後完成的回饋', reviewedAt: date });
  });
  expect(view.queryByText('測試學生')).toBeNull();
  expect(
    view.getByRole('button', { name: '查看收件：校園訪談' }).props.accessibilityState.disabled,
  ).toBe(true);
  await act(async () => {
    denied.resolve(Promise.reject(new NuniError(403, 'FORBIDDEN')));
  });
  await view.findByText('你目前沒有這項操作的權限。');
  expect(view.queryByText('測試學生')).toBeNull();
  expect(view.queryByText('已回饋：稍後完成的回饋')).toBeNull();
});
