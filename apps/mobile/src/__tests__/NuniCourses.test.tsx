import React from 'react';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { NuniError, type NuniMaterial, type NuniWorkspace } from '@campus/shared/src/nuni';
import { NuniCourses } from '../screens/nuni/NuniCourses';
import { NuniDraftProvider } from '../state/nuniDrafts';

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
const fileSubmitFlag = { on: false };
jest.mock('../screens/nuni/assignmentFileSubmit', () => {
  const actual = jest.requireActual('../screens/nuni/assignmentFileSubmit') as Record<
    string,
    unknown
  >;
  return {
    ...actual,
    assignmentFileSubmitEnabledNative: () => fileSubmitFlag.on,
  };
});
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
function quizReceipt(answer = '我原本的回答') {
  return {
    quizId,
    platformAccountId: accountId,
    displayName: '測試學生',
    answer,
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
  if (path.endsWith('/materials/page')) return { materials: [], nextCursor: null };
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
      myResponse: quizReceipt(input!.answer as string),
    };
    return quiz;
  }
  throw new Error(`Unhandled fixture path: ${path}`);
}
beforeEach(() => {
  mockUuid = 0;
  fileSubmitFlag.on = false;
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

function material(number: number, title = `第 ${number} 份教材`): NuniMaterial {
  return {
    id: `cwm_66666666-6666-4666-8666-${String(number).padStart(12, '0')}`,
    workspaceId: courseId,
    title,
    body: `教材內容 ${number}`,
    unitId: null,
    unitTitle: null,
    createdByPlatformAccountId: accountId,
    createdAt: date,
  };
}

it('appends older materials once, deduplicates overlapping pages and reports a partial count', async () => {
  const older = deferred<unknown>();
  mockRequest.mockImplementation((path, context, input, _method, query) =>
    path.endsWith('/materials/page')
      ? query
        ? older.promise
        : Promise.resolve({ materials: [material(1)], nextCursor: 'older_page' })
      : response(path, context, input),
  );
  const view = await openCourse();
  fireEvent.press(view.getByRole('button', { name: '教材 1+' }));
  expect(view.getByText('已載入 1 筆教材，還有較早內容。')).toBeTruthy();
  const more = view.getByRole('button', { name: '載入較早教材' });
  act(() => {
    fireEvent.press(more);
    fireEvent.press(more);
  });
  expect(
    mockRequest.mock.calls.filter(
      ([path, , , , query]) => path.endsWith('/materials/page') && query,
    ),
  ).toHaveLength(1);
  expect(mockRequest).toHaveBeenCalledWith(
    `class-workspaces/${courseId}/materials/page`,
    'context-first',
    undefined,
    undefined,
    { cursor: 'older_page' },
  );
  await act(async () => older.resolve({ materials: [material(1), material(2)], nextCursor: null }));
  expect(view.getAllByText('第 1 份教材')).toHaveLength(1);
  expect(view.getByText('第 2 份教材')).toBeTruthy();
  expect(view.getByText('共 2 筆教材。')).toBeTruthy();
  expect(view.getByRole('button', { name: '教材 2' })).toBeTruthy();
  expect(view.queryByRole('button', { name: '載入較早教材' })).toBeNull();
  expect(mockRequest.mock.calls.some(([path]) => path.endsWith('/materials'))).toBe(false);
});

it('keeps the loaded materials and retries the same cursor after a network failure', async () => {
  let olderAttempts = 0;
  mockRequest.mockImplementation((path, context, input, _method, query) => {
    if (!path.endsWith('/materials/page')) return response(path, context, input);
    if (!query) return Promise.resolve({ materials: [material(1)], nextCursor: 'retry_cursor' });
    if (++olderAttempts === 1) return Promise.reject(new NuniError(0, 'NETWORK_ERROR'));
    return Promise.resolve({ materials: [material(2)], nextCursor: null });
  });
  const view = await openCourse();
  fireEvent.press(view.getByRole('button', { name: '教材 1+' }));
  fireEvent.press(view.getByRole('button', { name: '載入較早教材' }));
  await view.findByRole('button', { name: '重試載入較早教材' });
  expect(view.getByText('第 1 份教材')).toBeTruthy();
  fireEvent.press(view.getByRole('button', { name: '重試載入較早教材' }));
  await view.findByText('第 2 份教材');
  const cursors = mockRequest.mock.calls.filter(
    ([path, , , , query]) => path.endsWith('/materials/page') && query,
  );
  expect(cursors.map((call) => call[4])).toEqual([
    { cursor: 'retry_cursor' },
    { cursor: 'retry_cursor' },
  ]);
});

it('offers a fresh first page for an invalid cursor instead of retrying that cursor', async () => {
  let firstPages = 0;
  mockRequest.mockImplementation((path, context, input, _method, query) => {
    if (!path.endsWith('/materials/page')) return response(path, context, input);
    if (query) return Promise.reject(new NuniError(422, 'CLASS_WORKSPACE_MATERIAL_CURSOR_INVALID'));
    return Promise.resolve({
      materials: [material(++firstPages)],
      nextCursor: firstPages === 1 ? 'expired_cursor' : null,
    });
  });
  const view = await openCourse();
  fireEvent.press(view.getByRole('button', { name: '教材 1+' }));
  fireEvent.press(view.getByRole('button', { name: '載入較早教材' }));
  await view.findByText('教材頁面已失效，請更新教材後再試。');
  expect(view.getByText('第 1 份教材')).toBeTruthy();
  expect(view.queryByRole('button', { name: '重試載入較早教材' })).toBeNull();
  fireEvent.press(view.getByRole('button', { name: '更新教材' }));
  await view.findByText('第 2 份教材');
  expect(view.queryByText('第 1 份教材')).toBeNull();
  expect(firstPages).toBe(2);
});

it.each([403, 404])(
  'removes loaded course data and teacher controls after page access returns %s',
  async (status) => {
    course = { ...course, memberRole: 'owner-teacher' };
    mockRequest.mockImplementation((path, context, input, _method, query) =>
      path.endsWith('/materials/page')
        ? query
          ? Promise.reject(new NuniError(status, status === 403 ? 'FORBIDDEN' : 'NOT_FOUND'))
          : Promise.resolve({ materials: [material(1)], nextCursor: 'older_page' })
        : response(path, context, input),
    );
    const view = await openCourse();
    fireEvent.press(view.getByRole('button', { name: '教材 1+' }));
    fireEvent.press(view.getByRole('button', { name: '新增教材' }));
    fireEvent.changeText(view.getByLabelText('教材標題'), '不再有權限的草稿');
    fireEvent.press(view.getByRole('button', { name: '載入較早教材' }));
    await waitFor(() => expect(view.queryByText('第 1 份教材')).toBeNull());
    expect(view.queryByText('校園訪談', { includeHiddenElements: true })).toBeNull();
    expect(
      view.queryByRole('button', { name: '發布教材', includeHiddenElements: true }),
    ).toBeNull();
    expect(view.queryByRole('button', { name: '產生學生邀請碼' })).toBeNull();
    expect(view.queryByRole('button', { name: '載入較早教材' })).toBeNull();
    expect(view.getByRole('button', { name: '更新內容' })).toBeTruthy();
  },
);

it('ignores a pending older page when a reload starts a fresh page chain', async () => {
  const older = deferred<unknown>();
  let firstPages = 0;
  mockRequest.mockImplementation((path, context, input, _method, query) =>
    path.endsWith('/materials/page')
      ? query
        ? older.promise
        : Promise.resolve({
            materials: [material(++firstPages)],
            nextCursor: firstPages === 1 ? 'old_cursor' : 'fresh_cursor',
          })
      : response(path, context, input),
  );
  const view = await openCourse();
  fireEvent.press(view.getByRole('button', { name: '教材 1+' }));
  fireEvent.press(view.getByRole('button', { name: '載入較早教材' }));
  fireEvent.press(view.getByRole('button', { name: '更新內容' }));
  await view.findByText('第 2 份教材');
  await act(async () => older.resolve({ materials: [material(3)], nextCursor: null }));
  expect(view.queryByText('第 1 份教材')).toBeNull();
  expect(view.queryByText('第 3 份教材')).toBeNull();
  expect(view.getByRole('button', { name: '教材 1+' })).toBeTruthy();
  fireEvent.press(view.getByRole('button', { name: '載入較早教材' }));
  await view.findByText('第 3 份教材');
  expect(mockRequest.mock.calls.at(-1)?.[4]).toEqual({ cursor: 'fresh_cursor' });
});

it('reloads the newest page after confirmed material publication and rejects an earlier page reply', async () => {
  course = { ...course, memberRole: 'owner-teacher' };
  const older = deferred<unknown>();
  let published = false;
  mockRequest.mockImplementation((path, context, input, _method, query) => {
    if (path.endsWith('/materials') && input) {
      published = true;
      return Promise.resolve(material(2, input.title));
    }
    if (path.endsWith('/materials/page'))
      return query
        ? older.promise
        : Promise.resolve({
            materials: [material(published ? 2 : 1)],
            nextCursor: published ? 'after_publish' : 'before_publish',
          });
    return response(path, context, input);
  });
  const view = await openCourse();
  fireEvent.press(view.getByRole('button', { name: '教材 1+' }));
  fireEvent.press(view.getByRole('button', { name: '載入較早教材' }));
  fireEvent.press(view.getByRole('button', { name: '新增教材' }));
  fireEvent.changeText(view.getByLabelText('教材標題'), '新教材');
  fireEvent.changeText(view.getByLabelText('教材說明'), '新教材說明');
  fireEvent.press(view.getByRole('button', { name: '發布教材' }));
  await view.findByText('第 2 份教材');
  await act(async () => older.resolve({ materials: [material(3)], nextCursor: null }));
  expect(view.queryByText('第 1 份教材')).toBeNull();
  expect(view.queryByText('第 3 份教材')).toBeNull();
  expect(view.getByRole('button', { name: '教材 1+' })).toBeTruthy();
  expect(
    mockRequest.mock.calls.filter(
      ([path, , , , query]) => path.endsWith('/materials/page') && !query,
    ),
  ).toHaveLength(2);
});

it.each(['student', 'archived'] as const)(
  'waits for newer %s authority verification when an earlier material publication finishes',
  async (change) => {
    course = { ...course, memberRole: 'owner-teacher' };
    const view = await openCourse();
    fireEvent.press(view.getByRole('button', { name: '教材 0' }));
    fireEvent.press(view.getByRole('button', { name: '新增教材' }));
    fireEvent.changeText(view.getByLabelText('教材標題'), '等待確認教材');
    fireEvent.changeText(view.getByLabelText('教材說明'), '等待伺服器的內容');
    const writing = deferred<unknown>();
    const authority = deferred<unknown>();
    let firstAuthorityRead = true;
    mockRequest.mockImplementation((path, context, input) => {
      if (path.endsWith('/materials') && input) return writing.promise;
      if (path === `class-workspaces/${courseId}` && firstAuthorityRead) {
        firstAuthorityRead = false;
        return authority.promise;
      }
      return response(path, context, input);
    });
    fireEvent.press(view.getByRole('button', { name: '發布教材' }));
    fireEvent.press(view.getByRole('button', { name: '更新內容' }));
    await act(async () => writing.resolve(material(1)));
    expect(view.getByText('正在讀取課程內容…')).toBeTruthy();
    expect(view.queryByRole('button', { name: '發布教材' })).toBeNull();
    expect(
      mockRequest.mock.calls.filter(([path]) => path === `class-workspaces/${courseId}`),
    ).toHaveLength(2);
    course =
      change === 'student'
        ? { ...course, memberRole: 'student' }
        : { ...course, state: 'archived' };
    await act(async () => authority.resolve(course));
    await waitFor(() => expect(view.queryByText('正在讀取課程內容…')).toBeNull());
    expect(view.queryByRole('button', { name: '發布教材' })).toBeNull();
    expect(view.queryByRole('button', { name: '新增教材' })).toBeNull();
    expect(view.queryByRole('button', { name: '產生學生邀請碼' })).toBeNull();
  },
);

it.each(['account', 'course'])(
  'ignores an older material page after replacing the account or reopening the course (%s)',
  async (change) => {
    const older = deferred<unknown>();
    mockRequest.mockImplementation((path, context, input, _method, query) =>
      path.endsWith('/materials/page')
        ? query
          ? older.promise
          : Promise.resolve({ materials: [material(1)], nextCursor: 'older_page' })
        : response(path, context, input),
    );
    const view = await openCourse();
    fireEvent.press(view.getByRole('button', { name: '教材 1+' }));
    fireEvent.press(view.getByRole('button', { name: '載入較早教材' }));
    if (change === 'account') {
      mockSession = {
        ...mockSession,
        context: 'other-account',
        platformAccountId: 'pa_55555555-5555-4555-8555-555555555555',
      };
      mockRequest.mockResolvedValue({ workspaces: [] });
      view.rerender(<NuniCourses />);
      await view.findByText('尚未加入修習課程。請向老師取得邀請碼。');
    } else {
      fireEvent.press(view.getByRole('button', { name: '返回我的課程' }));
      fireEvent.press(await view.findByRole('button', { name: '服務設計課程' }));
      await view.findByText('校園訪談');
      fireEvent.press(view.getByRole('button', { name: '教材 1+' }));
    }
    await act(async () => older.resolve({ materials: [material(2)], nextCursor: null }));
    expect(view.queryByText('第 2 份教材')).toBeNull();
    if (change === 'course') expect(view.getByRole('button', { name: '教材 1+' })).toBeTruthy();
  },
);

it('groups real roles and opens the same platform course contract using captured session context', async () => {
  const view = render(<NuniCourses />);
  await view.findByText('修習課程 · 1');
  expect(view.getByText('授課與協作 · 0')).toBeTruthy();
  expect(mockRequest).toHaveBeenCalledWith('class-workspaces', 'context-first', undefined);
  fireEvent.press(view.getByRole('button', { name: '服務設計課程' }));
  await view.findByText('待繳作業 1 · 待答測驗 1');
  expect(view.queryByRole('button', { name: '產生學生邀請碼' })).toBeNull();
});
it('adds a server-confirmed receipt and removes the assignment from pending work', async () => {
  const view = await openCourse();
  fireEvent.changeText(view.getByLabelText('作業內容：校園訪談'), '我的訪談內容');
  fireEvent.press(view.getByRole('button', { name: '繳交作業' }));
  await view.findByText('已收到伺服器繳交紀錄。');
  expect(view.getByText('待繳作業 0 · 待答測驗 1')).toBeTruthy();
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
it('accepts a 2000-character quiz answer and shows the confirmed editable receipt', async () => {
  const answer = '答'.repeat(2000);
  const view = await openCourse();
  fireEvent.press(view.getByRole('button', { name: '測驗 1' }));
  const input = view.getByLabelText('測驗內容：需求練習');
  expect(input.props.maxLength).toBe(2000);
  fireEvent.changeText(input, answer);
  fireEvent.press(view.getByRole('button', { name: '繳交測驗' }));
  await view.findByText('已收到伺服器繳交紀錄。');
  expect(view.getByText(answer)).toBeTruthy();
  expect(view.getByLabelText('測驗內容：需求練習').props.value).toBe(answer);
  expect(view.getByRole('button', { name: '更新測驗繳交' })).toBeTruthy();
  expect(mockRequest).toHaveBeenCalledWith(
    `class-workspaces/${courseId}/quizzes/${quizId}/submit`,
    'context-first',
    expect.objectContaining({ answer }),
  );
});
it('rejects an over-limit quiz answer before sending and retains it for correction', async () => {
  const view = await openCourse();
  fireEvent.press(view.getByRole('button', { name: '測驗 1' }));
  const answer = '答'.repeat(2001);
  // Also validate programmatically restored drafts, not only native maxLength enforcement.
  fireEvent.changeText(view.getByLabelText('測驗內容：需求練習'), answer);
  fireEvent.press(view.getByRole('button', { name: '繳交測驗' }));
  expect(view.getByText('測驗內容：需求練習最多 2000 字，請縮短內容後再送出。')).toBeTruthy();
  expect(mockRequest.mock.calls.some(([path]) => path.endsWith('/submit'))).toBe(false);
  expect(view.getByLabelText('測驗內容：需求練習').props.value).toBe(answer);
  expect(view.queryByText('已繳交')).toBeNull();
});
it.each(['assignment', 'quiz'] as const)(
  'hydrates a saved %s before editing and replaces it only with a confirmed receipt',
  async (kind) => {
    assignment = { ...assignment, mySubmission: receipt('已交作業'), submissionCount: 1 };
    quiz = { ...quiz, myResponse: quizReceipt('已交測驗'), responseCount: 1 };
    const view = await openCourse();
    if (kind === 'quiz') fireEvent.press(view.getByRole('button', { name: '測驗 1' }));
    const label = kind === 'assignment' ? '作業內容：校園訪談' : '測驗內容：需求練習';
    const original = kind === 'assignment' ? '已交作業' : '已交測驗';
    expect(view.getByLabelText(label).props.value).toBe(original);
    fireEvent.changeText(view.getByLabelText(label), `${original}，補上例子`);
    fireEvent.press(
      view.getByRole('button', { name: kind === 'assignment' ? '更新作業繳交' : '更新測驗繳交' }),
    );
    await view.findByText('已收到伺服器繳交紀錄。');
    expect(view.getByText(`${original}，補上例子`)).toBeTruthy();
    expect(view.getByLabelText(label).props.value).toBe(`${original}，補上例子`);
    expect(view.queryByText(/這份內容已有更新/)).toBeNull();
  },
);
it('updates an untouched editor but requires a choice before overwriting a newer submission', async () => {
  assignment = { ...assignment, mySubmission: receipt('原始繳交'), submissionCount: 1 };
  const view = await openCourse();
  assignment = { ...assignment, mySubmission: receipt('網頁剛更新') };
  fireEvent.press(view.getByRole('button', { name: '更新內容' }));
  await waitFor(() =>
    expect(view.getByLabelText('作業內容：校園訪談').props.value).toBe('網頁剛更新'),
  );
  fireEvent.changeText(view.getByLabelText('作業內容：校園訪談'), '我的手機草稿');
  assignment = { ...assignment, mySubmission: receipt('另一份較新的內容') };
  fireEvent.press(view.getByRole('button', { name: '更新內容' }));
  await view.findByText(/這份內容已有更新/);
  expect(view.getByLabelText('作業內容：校園訪談').props.value).toBe('我的手機草稿');
  fireEvent.press(view.getByRole('button', { name: '更新作業繳交' }));
  expect(mockRequest.mock.calls.some(([path]) => path.endsWith('/submit'))).toBe(false);
  fireEvent.press(view.getByRole('button', { name: '保留草稿，儲存時覆寫' }));
  fireEvent.press(view.getByRole('button', { name: '更新作業繳交' }));
  await view.findByText('已收到伺服器繳交紀錄。');
  expect(view.getByText('我的手機草稿')).toBeTruthy();
  expect(view.queryByText(/這份內容已有更新/)).toBeNull();
});
it('preserves the draft comparison across account revalidation and can adopt the newer content', async () => {
  const cache = new Map<string, unknown>();
  const ui = () => (
    <NuniDraftProvider cache={cache}>
      <NuniCourses />
    </NuniDraftProvider>
  );
  assignment = { ...assignment, mySubmission: receipt('先前繳交'), submissionCount: 1 };
  const view = render(ui());
  fireEvent.press(await view.findByRole('button', { name: '服務設計課程' }));
  fireEvent.changeText(await view.findByLabelText('作業內容：校園訪談'), '還沒送出的修改');
  assignment = { ...assignment, mySubmission: receipt('回前景時讀到的新內容') };
  mockSession = { ...mockSession, context: 'context-revalidated' };
  view.rerender(ui());
  await view.findByText(/這份內容已有更新/);
  expect(view.getByLabelText('作業內容：校園訪談').props.value).toBe('還沒送出的修改');
  fireEvent.press(view.getByRole('button', { name: '改用目前內容' }));
  expect(view.getByLabelText('作業內容：校園訪談').props.value).toBe('回前景時讀到的新內容');
  expect(view.queryByText(/這份內容已有更新/)).toBeNull();
  expect(mockRequest.mock.calls.some(([path]) => path.endsWith('/submit'))).toBe(false);
});
it('prefills teacher feedback and prevents a refreshed response from being overwritten silently', async () => {
  course = { ...course, memberRole: 'owner-teacher' };
  let entry = { ...receipt(), teacherFeedback: '請補例子', reviewedAt: date };
  mockRequest.mockImplementation((path, context, input) =>
    path.endsWith('/submissions') ? { submissions: [entry] } : response(path, context, input),
  );
  const view = await openCourse();
  fireEvent.press(view.getByRole('button', { name: '查看收件：校園訪談' }));
  const input = await view.findByLabelText('給 測試學生 的回饋');
  expect(input.props.value).toBe('請補例子');
  fireEvent.changeText(input, '請補具體例子和訪談時間');
  entry = { ...entry, teacherFeedback: '共同授課老師的新回饋' };
  fireEvent.press(view.getByRole('button', { name: '查看收件：校園訪談' }));
  await view.findByText(/這份內容已有更新/);
  fireEvent.press(view.getByRole('button', { name: '儲存老師回饋' }));
  expect(mockRequest.mock.calls.some(([path]) => path.endsWith('/feedback'))).toBe(false);
  fireEvent.press(view.getByRole('button', { name: '保留草稿，儲存時覆寫' }));
  fireEvent.press(view.getByRole('button', { name: '儲存老師回饋' }));
  await view.findByText('已回饋：請補具體例子和訪談時間');
  expect(view.getByLabelText('給 測試學生 的回饋').props.value).toBe('請補具體例子和訪談時間');
  expect(view.queryByText(/這份內容已有更新/)).toBeNull();
});
it.each(['assignment', 'quiz'] as const)(
  'labels retained feedback as older after the server confirms a revised %s',
  async (kind) => {
    const previous = {
      teacherFeedback: '原本內容的回饋',
      reviewedAt: date,
      submittedAt: '2026-10-09T02:00:00.000Z',
    };
    assignment = { ...assignment, mySubmission: { ...receipt(), ...previous }, submissionCount: 1 };
    quiz = { ...quiz, myResponse: { ...quizReceipt(), ...previous }, responseCount: 1 };
    mockRequest.mockImplementation((path, context, input) => {
      if (path.endsWith('/submit')) {
        const updated = { ...previous, submittedAt: '2026-10-09T04:00:00.000Z' };
        return path.includes('/assignments/')
          ? { ...assignment, mySubmission: { ...receipt(input!.body as string), ...updated } }
          : { ...quiz, myResponse: { ...quizReceipt(input!.answer as string), ...updated } };
      }
      return response(path, context, input);
    });
    const view = await openCourse();
    if (kind === 'quiz') fireEvent.press(view.getByRole('button', { name: '測驗 1' }));
    expect(view.queryByText(/這則回饋早於最近一次繳交/)).toBeNull();
    fireEvent.changeText(
      view.getByLabelText(kind === 'assignment' ? '作業內容：校園訪談' : '測驗內容：需求練習'),
      '依照回饋修改的內容',
    );
    fireEvent.press(
      view.getByRole('button', { name: kind === 'assignment' ? '更新作業繳交' : '更新測驗繳交' }),
    );
    await view.findByText('這則回饋早於最近一次繳交，可請老師確認是否仍適用。');
    expect(view.getByText('老師回饋：原本內容的回饋')).toBeTruthy();
    expect(view.getByText('依照回饋修改的內容')).toBeTruthy();
    expect(view.getByText(/回饋時間：/)).toBeTruthy();
  },
);
it('tells teachers when a student revised the work after feedback and clears the note after a new review', async () => {
  course = { ...course, memberRole: 'owner-teacher' };
  const entry = {
    ...receipt('學生後來修改的內容'),
    teacherFeedback: '先前的回饋',
    submittedAt: '2026-10-09T04:00:00.000Z',
    reviewedAt: date,
  };
  mockRequest.mockImplementation((path, context, input) => {
    if (path.endsWith('/submissions')) return { submissions: [entry] };
    if (path.endsWith('/feedback'))
      return { ...entry, teacherFeedback: input!.feedback, reviewedAt: '2026-10-09T05:00:00.000Z' };
    return response(path, context, input);
  });
  const view = await openCourse();
  fireEvent.press(view.getByRole('button', { name: '查看收件：校園訪談' }));
  await view.findByText('學生在這則回饋之後更新了繳交內容，請確認回饋是否仍適用。');
  fireEvent.changeText(view.getByLabelText('給 測試學生 的回饋'), '已看過修改，請再補例子');
  fireEvent.press(view.getByRole('button', { name: '儲存老師回饋' }));
  await view.findByText('已回饋：已看過修改，請再補例子');
  expect(view.queryByText(/學生在這則回饋之後更新了/)).toBeNull();
});
it('requires a teacher to reconsider an unsaved review when the student changes the reviewed work', async () => {
  course = { ...course, memberRole: 'owner-teacher' };
  let entry = { ...receipt('老師正在看的原稿'), teacherFeedback: '先前回饋', reviewedAt: date };
  mockRequest.mockImplementation((path, context, input) =>
    path.endsWith('/submissions') ? { submissions: [entry] } : response(path, context, input),
  );
  const view = await openCourse();
  fireEvent.press(view.getByRole('button', { name: '查看收件：校園訪談' }));
  fireEvent.changeText(await view.findByLabelText('給 測試學生 的回饋'), '針對原稿寫到一半的回饋');
  entry = { ...entry, body: '學生已經補上例子的新版', submittedAt: '2026-10-09T04:00:00.000Z' };
  fireEvent.press(view.getByRole('button', { name: '查看收件：校園訪談' }));
  await view.findByText('學生已經補上例子的新版');
  expect(view.getByText(/這份內容已有更新/)).toBeTruthy();
  expect(view.getByLabelText('給 測試學生 的回饋').props.value).toBe('針對原稿寫到一半的回饋');
  fireEvent.press(view.getByRole('button', { name: '儲存老師回饋' }));
  expect(mockRequest.mock.calls.some(([path]) => path.endsWith('/feedback'))).toBe(false);
  fireEvent.press(view.getByRole('button', { name: '改用目前內容' }));
  expect(view.getByLabelText('給 測試學生 的回饋').props.value).toBe('先前回饋');
});
it('retries an uncertain quiz update with its original intent even after a newer receipt was read', async () => {
  quiz = { ...quiz, myResponse: quizReceipt('原始回答'), responseCount: 1 };
  const view = await openCourse();
  fireEvent.press(view.getByRole('button', { name: '測驗 1' }));
  fireEvent.changeText(view.getByLabelText('測驗內容：需求練習'), '手機修改');
  let attempts = 0;
  mockRequest.mockImplementation((path, context, input) => {
    if (path.endsWith(`/quizzes/${quizId}/submit`)) {
      if (++attempts === 1) return Promise.reject(new NuniError(0, 'NETWORK_ERROR'));
      // The provider replays the key by returning its current receipt without overwriting it.
      return quiz;
    }
    return response(path, context, input);
  });
  fireEvent.press(view.getByRole('button', { name: '更新測驗繳交' }));
  await view.findByRole('button', { name: '重試確認這次送出' });
  quiz = { ...quiz, myResponse: quizReceipt('網頁較新的回答') };
  fireEvent.press(view.getByRole('button', { name: '更新內容' }));
  await view.findByText('網頁較新的回答');
  expect(view.getByLabelText('測驗內容：需求練習').props.editable).toBe(false);
  expect(view.queryByRole('button', { name: '保留草稿，儲存時覆寫' })).toBeNull();
  fireEvent.press(view.getByRole('button', { name: '重試確認這次送出' }));
  await view.findByText('已收到伺服器繳交紀錄。');
  const writes = mockRequest.mock.calls.filter(([path]) =>
    path.endsWith(`/quizzes/${quizId}/submit`),
  );
  expect(writes).toHaveLength(2);
  expect(writes[1][2]).toEqual(writes[0][2]);
  expect(view.getByLabelText('測驗內容：需求練習').props.value).toBe('網頁較新的回答');
  expect(view.queryByText(/這份內容已有更新/)).toBeNull();
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
  expect(view.getByText('待繳作業 1 · 待答測驗 1')).toBeTruthy();
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

it('revalidates course access while restoring same-account input and an in-flight retry intent', async () => {
  const cache = new Map<string, unknown>();
  const ui = () => (
    <NuniDraftProvider cache={cache}>
      <NuniCourses />
    </NuniDraftProvider>
  );
  const view = render(ui());
  fireEvent.press(await view.findByRole('button', { name: '服務設計課程' }));
  fireEvent.changeText(await view.findByLabelText('作業內容：校園訪談'), '跨回前景仍保留內容');
  const firstWrite = deferred<unknown>();
  const authority = deferred<unknown>();
  let writes = 0;
  let checking = false;
  mockRequest.mockImplementation((path, context, input) => {
    if (path.endsWith('/submit') && ++writes === 1) return firstWrite.promise;
    if (path === `class-workspaces/${courseId}` && checking) return authority.promise;
    return response(path, context, input);
  });
  fireEvent.press(view.getByRole('button', { name: '繳交作業' }));
  const original = mockRequest.mock.calls.find(([path]) => path.endsWith('/submit'))![2];
  checking = true;
  mockSession = { ...mockSession, context: 'context-revalidated' };
  view.rerender(ui());
  expect(view.queryByLabelText('作業內容：校園訪談')).toBeNull();
  await act(async () => authority.resolve(course));
  expect(view.getByLabelText('作業內容：校園訪談').props.value).toBe('跨回前景仍保留內容');
  expect(view.getByLabelText('作業內容：校園訪談').props.editable).toBe(false);
  fireEvent.press(view.getByRole('button', { name: '重試確認這次送出' }));
  await view.findByText('已收到伺服器繳交紀錄。');
  const calls = mockRequest.mock.calls.filter(([path]) => path.endsWith('/submit'));
  expect(calls).toHaveLength(2);
  expect(calls[1][1]).toBe('context-revalidated');
  expect(calls[1][2]).toEqual(original);
  await act(async () => firstWrite.resolve(assignment));
});

it.each(['student', 'archived'] as const)(
  'does not restore a teacher publishing form after revalidation changes access to %s',
  async (change) => {
    course = { ...course, memberRole: 'owner-teacher' };
    const cache = new Map<string, unknown>();
    const ui = () => (
      <NuniDraftProvider cache={cache}>
        <NuniCourses />
      </NuniDraftProvider>
    );
    const view = render(ui());
    fireEvent.press(await view.findByRole('button', { name: '服務設計課程' }));
    fireEvent.press(await view.findByRole('button', { name: '新增作業' }));
    fireEvent.changeText(view.getByLabelText('作業標題'), '老師尚未發布的內容');
    course =
      change === 'student'
        ? { ...course, memberRole: 'student' }
        : { ...course, state: 'archived' };
    mockSession = { ...mockSession, context: 'context-revalidated' };
    view.rerender(ui());
    await view.findByText('校園訪談');
    expect(view.queryByLabelText('作業標題')).toBeNull();
    expect(view.queryByDisplayValue('老師尚未發布的內容')).toBeNull();
    expect(view.queryByRole('button', { name: '產生學生邀請碼' })).toBeNull();
    if (change === 'student')
      expect(view.getByLabelText('作業內容：校園訪談').props.value).toBe('');
  },
);

it('does not unlock an earlier uncertain intent when a revalidated retry returns 404', async () => {
  const cache = new Map<string, unknown>();
  const ui = () => (
    <NuniDraftProvider cache={cache}>
      <NuniCourses />
    </NuniDraftProvider>
  );
  const view = render(ui());
  fireEvent.press(await view.findByRole('button', { name: '服務設計課程' }));
  fireEvent.changeText(await view.findByLabelText('作業內容：校園訪談'), '未知收件的內容');
  let writes = 0;
  mockRequest.mockImplementation((path, context, input) =>
    path.endsWith('/submit')
      ? Promise.reject(new NuniError(++writes === 1 ? 503 : 404, 'UNAVAILABLE'))
      : response(path, context, input),
  );
  fireEvent.press(view.getByRole('button', { name: '繳交作業' }));
  await view.findByRole('button', { name: '重試確認這次送出' });
  mockSession = { ...mockSession, context: 'context-revalidated' };
  view.rerender(ui());
  fireEvent.press(await view.findByRole('button', { name: '重試確認這次送出' }));
  await view.findByText(/尚未確認這次送出結果/);
  expect(view.getByLabelText('作業內容：校園訪談').props.editable).toBe(false);
  const calls = mockRequest.mock.calls.filter(([path]) => path.endsWith('/submit'));
  expect(calls[1][2]).toEqual(calls[0][2]);
});

it('retains the student draft when filtering and moves a confirmed submission out of pending work', async () => {
  const view = await openCourse();
  fireEvent.changeText(view.getByLabelText('作業內容：校園訪談'), '切換篩選也要保留');
  fireEvent.press(view.getByRole('button', { name: '已繳交 0' }));
  expect(view.queryByLabelText('作業內容：校園訪談')).toBeNull();
  expect(view.getByText('尚無已繳交的作業紀錄。')).toBeTruthy();
  fireEvent.press(view.getByRole('button', { name: '待完成 1' }));
  expect(view.getByLabelText('作業內容：校園訪談').props.value).toBe('切換篩選也要保留');
  fireEvent.press(view.getByRole('button', { name: '繳交作業' }));
  await view.findByText('已收到伺服器繳交紀錄。');
  expect(view.getByText('待繳作業 0 · 待答測驗 1')).toBeTruthy();
  expect(view.getByText('切換篩選也要保留')).toBeTruthy();
  expect(view.getByRole('button', { name: '已繳交 1' })).toHaveAccessibilityState({
    selected: true,
  });
});

it('counts a pending quiz separately and confirms it through the same activity filters', async () => {
  assignment = { ...assignment, mySubmission: receipt(), submissionCount: 1 };
  const view = await openCourse();
  expect(view.getByText('待繳作業 0 · 待答測驗 1')).toBeTruthy();
  fireEvent.press(view.getByRole('button', { name: '測驗 1' }));
  fireEvent.press(view.getByRole('button', { name: '待完成 1' }));
  fireEvent.changeText(view.getByLabelText('測驗內容：需求練習'), '測驗也要計入待辦');
  fireEvent.press(view.getByRole('button', { name: '繳交測驗' }));
  await view.findByText('待繳作業 0 · 待答測驗 0');
  expect(view.getByText('已收到伺服器繳交紀錄。')).toBeTruthy();
  expect(view.getByText('測驗也要計入待辦')).toBeTruthy();
  expect(view.getByRole('button', { name: '已繳交 1' })).toHaveAccessibilityState({
    selected: true,
  });
});

it('prioritizes the earliest open unsubmitted assignment and leaves closed or submitted work visible in all', async () => {
  const fixtures = [
    {
      ...assignment,
      id: 'cwa_11111111-1111-4111-8111-111111111111',
      title: '已完成',
      mySubmission: { ...receipt(), assignmentId: 'cwa_11111111-1111-4111-8111-111111111111' },
      submissionCount: 1,
    },
    { ...assignment, id: 'cwa_33333333-3333-4333-8333-333333333333', title: '尚無期限' },
    {
      ...assignment,
      id: 'cwa_44444444-4444-4444-8444-444444444444',
      title: '已結束',
      state: 'closed',
      closedAt: date,
    },
    { ...assignment, title: '校園訪談', dueAt: '2026-10-15T03:00:00.000Z' },
    {
      ...assignment,
      id: 'cwa_55555555-5555-4555-8555-555555555555',
      title: '優先補交',
      dueAt: '2026-10-01T03:00:00.000Z',
    },
  ];
  mockRequest.mockImplementation((path, context, input) =>
    path.endsWith('/assignments') && !input
      ? { assignments: fixtures }
      : response(path, context, input),
  );
  const view = await openCourse();
  const titles = view.getAllByRole('header').map((node) => node.props.children);
  expect(titles.indexOf('優先補交')).toBeLessThan(titles.indexOf('校園訪談'));
  expect(titles.indexOf('校園訪談')).toBeLessThan(titles.indexOf('尚無期限'));
  expect(titles.indexOf('尚無期限')).toBeLessThan(titles.indexOf('已完成'));
  fireEvent.press(view.getByRole('button', { name: '待完成 3' }));
  expect(view.queryByText('已結束')).toBeNull();
  expect(view.queryByText('已完成')).toBeNull();
  expect(view.getByLabelText('作業內容：優先補交')).toBeTruthy();
});

it('does not treat an archived course as pending and retains all receipt records', async () => {
  course = { ...course, state: 'archived' };
  assignment = { ...assignment, mySubmission: receipt(), submissionCount: 1 };
  const view = await openCourse();
  expect(view.getByText('待繳作業 0 · 待答測驗 0')).toBeTruthy();
  fireEvent.press(view.getByRole('button', { name: '已繳交 1' }));
  expect(view.getByText('我的訪談內容')).toBeTruthy();
  expect(view.queryByRole('button', { name: '更新作業繳交' })).toBeNull();
});

it('does not show a student pending filter to a course teacher', async () => {
  course = { ...course, memberRole: 'co-teacher' };
  const view = await openCourse();
  expect(view.queryByRole('button', { name: /待完成/ })).toBeNull();
  expect(view.getByRole('button', { name: '查看收件：校園訪談' })).toBeTruthy();
});

it('hides camera and file buttons while the assignment file flag is off', async () => {
  const view = await openCourse();
  expect(view.queryByRole('button', { name: '拍照' })).toBeNull();
  expect(view.getByLabelText('作業內容：校園訪談')).toBeTruthy();
});

it('shows camera, album and file actions when the assignment file flag is on', async () => {
  fileSubmitFlag.on = true;
  assignment = {
    ...assignment,
    dueAt: '2026-10-08T03:00:00.000Z',
  };
  const view = await openCourse();
  expect(view.getByRole('button', { name: '拍照' })).toBeTruthy();
  expect(view.getByRole('button', { name: '相簿' })).toBeTruthy();
  expect(view.getByRole('button', { name: '檔案' })).toBeTruthy();
  expect(view.getByText('遲交、仍可繳')).toBeTruthy();
});

it('opens the deep-linked assignment submit area even if drafts hid that card', async () => {
  fileSubmitFlag.on = true;
  const otherId = 'cwa_55555555-5555-4555-8555-555555555555';
  assignment = { ...assignment, mySubmission: receipt(), submissionCount: 1 };
  mockRequest.mockImplementation((path, context, input) =>
    path.endsWith('/assignments') && !input
      ? {
          assignments: [
            assignment,
            {
              ...assignment,
              id: otherId,
              title: '另一份待繳',
              mySubmission: null,
              submissionCount: 0,
            },
          ],
        }
      : response(path, context, input),
  );
  const cache = new Map<string, unknown>([
    [`course:${courseId}:tab`, 'materials'],
    [`course:${courseId}:activity-filter`, 'pending'],
  ]);
  const view = render(
    <NuniDraftProvider cache={cache}>
      <NuniCourses initialWorkspaceId={courseId} initialAssignmentId={assignmentId} />
    </NuniDraftProvider>,
  );
  const card = await view.findByTestId(`assignment-${assignmentId}`);
  expect(within(card).getByLabelText('作業繳交區：校園訪談')).toBeTruthy();
  expect(within(card).getByLabelText('作業內容：校園訪談')).toBeTruthy();
  expect(within(card).getByRole('button', { name: '拍照' })).toBeTruthy();
  expect(within(card).getByRole('button', { name: '更新作業繳交' })).toBeTruthy();
  expect(view.queryByLabelText('作業繳交區：另一份待繳')).toBeNull();
  expect(view.queryByText('老師尚未發布教材。')).toBeNull();
});
