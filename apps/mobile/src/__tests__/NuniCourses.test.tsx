import * as photoPdf from '../screens/nuni/nativePhotoPdf';
import React from 'react';
import { AppState, ScrollView, type AppStateStatus } from 'react-native';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { createNuniClasses, NuniError, type NuniMaterial, type NuniWorkspace } from '@campus/shared/src/nuni';
import { NuniCourses } from '../screens/nuni/NuniCourses';
import { NuniDraftProvider } from '../state/nuniDrafts';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { materialBookmarkStorageKey } from '@campus/shared/src/materialBookmarks';

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
const mockUpload = jest.fn();
let mockUuid = 0;
const fileSubmitFlag = { on: false };
const mockScrollAssignment = { reveal: jest.fn() };
jest.mock('../screens/nuni/scrollAssignment', () => ({
  revealAssignmentSubmitArea: (...args: unknown[]) => mockScrollAssignment.reveal(...args),
}));
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
    bffRequest: mockRequest,
    upload: mockUpload,
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
  mockScrollAssignment.reveal.mockReset();
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
  expect(view.getByText(/目前無法連線，連線中斷/)).toBeTruthy();
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
  expect(view.getByRole('button', { name: '授課 0' })).toBeTruthy();
  expect(view.queryByText('授課與協作 · 0')).toBeNull();
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
  expect(view.getByText('準時')).toBeTruthy();
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
  expect(view.queryByText('已作答')).toBeNull();
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
it('keeps scoped teacher feedback drafts when switching receipt filters', async () => {
  course = { ...course, memberRole: 'owner-teacher' };
  const pending = receipt('待回饋內容');
  const done = {
    ...receipt('已回饋內容'),
    platformAccountId: 'pa_55555555-5555-4555-8555-555555555555',
    displayName: '已回同學',
    teacherFeedback: '先前已回',
    reviewedAt: date,
  };
  mockRequest.mockImplementation((path, context, input) =>
    path.endsWith('/submissions')
      ? { submissions: [pending, done] }
      : response(path, context, input),
  );
  const view = await openCourse();
  fireEvent.press(view.getByRole('button', { name: '查看收件：校園訪談' }));
  await view.findByText('測試學生');
  fireEvent.changeText(view.getByLabelText('給 測試學生 的回饋'), '篩選後仍應留下的草稿');
  expect(view.getByRole('button', { name: '尚未回饋 1' }).props.accessibilityState.selected).toBe(true);
  fireEvent.press(view.getByRole('button', { name: '已回饋 1' }));
  expect(view.getByRole('button', { name: '已回饋 1' }).props.accessibilityState.selected).toBe(true);
  expect(view.getByRole('button', { name: '尚未回饋 1' }).props.accessibilityState.selected).toBe(false);
  fireEvent.press(view.getByRole('button', { name: '尚未回饋 1' }));
  expect(view.getByLabelText('給 測試學生 的回饋').props.value).toBe('篩選後仍應留下的草稿');
});
it('places resubmitted work with older feedback into the pending-review filter', async () => {
  course = { ...course, memberRole: 'owner-teacher' };
  const revised = {
    ...receipt('學生新稿'),
    teacherFeedback: '針對舊稿',
    reviewedAt: '2026-10-08T03:00:00.000Z',
    submittedAt: '2026-10-09T04:00:00.000Z',
  };
  mockRequest.mockImplementation((path, context, input) =>
    path.endsWith('/submissions') ? { submissions: [revised] } : response(path, context, input),
  );
  const view = await openCourse();
  fireEvent.press(view.getByRole('button', { name: '查看收件：校園訪談' }));
  await view.findByText('學生新稿');
  expect(view.getByText('已回饋：針對舊稿')).toBeTruthy();
  expect(
    view.getByText('學生在這則回饋之後更新了繳交內容，請確認回饋是否仍適用。'),
  ).toBeTruthy();
  expect(view.getByRole('button', { name: '尚未回饋 1' })).toBeTruthy();
});
it('keeps mixed-offset current feedback reviewed without showing a stale warning', async () => {
  course = { ...course, memberRole: 'owner-teacher' };
  const current = {
    ...receipt('學生新稿'),
    teacherFeedback: '已看過新稿',
    submittedAt: '2026-10-11T10:00:00',
    reviewedAt: '2026-10-11T03:00:00Z',
  };
  mockRequest.mockImplementation((path, context, input) =>
    path.endsWith('/submissions') ? { submissions: [current] } : response(path, context, input),
  );
  const view = await openCourse();
  fireEvent.press(view.getByRole('button', { name: '查看收件：校園訪談' }));
  await view.findByText('學生新稿');
  expect(view.getByRole('button', { name: '已回饋 1' })).toBeTruthy();
  expect(
    view.queryByText('學生在這則回饋之後更新了繳交內容，請確認回饋是否仍適用。'),
  ).toBeNull();
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
  expect(view.queryByText('準時')).toBeNull();
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
  expect(view.getByText('準時')).toBeTruthy();
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
  expect(view.queryByRole('button', { name: '照片轉 PDF' })).toBeNull();
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
  expect(view.getByRole('button', { name: '照片轉 PDF' })).toBeTruthy();
  expect(view.getByRole('button', { name: '檔案' })).toBeTruthy();
  expect(view.getByText('已過截止時間，現在送出會標為遲交')).toBeTruthy();
  expect(
    view.getByText('網路不穩時再送一次，不會重複交。選好的照片可以刪除或調整順序後再送出。'),
  ).toBeTruthy();
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
  const submit = await view.findByTestId(`assignment-submit-${assignmentId}`);
  expect(within(card).getByLabelText('作業繳交區：校園訪談')).toBeTruthy();
  expect(within(card).getByLabelText('作業內容：校園訪談')).toBeTruthy();
  expect(within(card).getByRole('button', { name: '拍照' })).toBeTruthy();
  expect(within(card).getByRole('button', { name: '更新作業繳交' })).toBeTruthy();
  expect(view.queryByLabelText('作業繳交區：另一份待繳')).toBeNull();
  expect(view.queryByTestId(`assignment-submit-${otherId}`)).toBeNull();
  expect(view.queryByText('老師尚未發布教材。')).toBeNull();
  fireEvent(submit, 'layout');
  expect(mockScrollAssignment.reveal).toHaveBeenCalled();
  expect(mockScrollAssignment.reveal.mock.calls[0][0]).toBeTruthy();
  expect(mockScrollAssignment.reveal.mock.calls[0][1]).toBeTruthy();
  expect(view.getByTestId('nuni-courses-scroll')).toBeTruthy();
});

it('does not scroll a submit area when no assignment is deep-linked', async () => {
  const view = await openCourse();
  expect(view.queryByTestId(`assignment-submit-${assignmentId}`)).toBeNull();
  expect(mockScrollAssignment.reveal).not.toHaveBeenCalled();
});

it('opens the deep-linked quiz answer area and keeps the submitted receipt visible', async () => {
  quiz = { ...quiz, myResponse: quizReceipt('已交測驗'), responseCount: 1 };
  const cache = new Map<string, unknown>([
    [`course:${courseId}:tab`, 'materials'],
    [`course:${courseId}:activity-filter`, 'pending'],
  ]);
  const view = render(
    <NuniDraftProvider cache={cache}>
      <NuniCourses initialWorkspaceId={courseId} initialAssignmentId={quizId} />
    </NuniDraftProvider>,
  );
  const card = await view.findByTestId(`quiz-${quizId}`);
  const submit = await view.findByTestId(`quiz-submit-${quizId}`);
  expect(within(card).getByLabelText('測驗作答區：需求練習')).toBeTruthy();
  expect(within(card).getByText('已作答')).toBeTruthy();
  expect(within(card).getByText('已交測驗')).toBeTruthy();
  expect(view.queryByText('老師尚未發布教材。')).toBeNull();
  fireEvent(submit, 'layout');
  expect(mockScrollAssignment.reveal).toHaveBeenCalled();
});

it('explains a missing linked assignment instead of a blank course page', async () => {
  const view = render(
    <NuniCourses
      initialWorkspaceId={courseId}
      initialAssignmentId="cwa_99999999-9999-4999-8999-999999999999"
    />,
  );
  expect(
    await view.findByText(
      '找不到這份作業。可能已被老師刪除，或你沒有查看權限。請從作業列表選擇其他作業。',
    ),
  ).toBeTruthy();
  expect(view.getByText('校園訪談')).toBeTruthy();
  expect(mockScrollAssignment.reveal).not.toHaveBeenCalled();
});

it('shows 遲交, Taipei time, and download on teacher receipts', async () => {
  course = { ...course, memberRole: 'owner-teacher' };
  fileSubmitFlag.on = true;
  const fileId = 'cwf_77777777-7777-4777-8777-777777777777';
  mockRequest.mockImplementation((path: string, context?: string, input?: Record<string, unknown>) => {
    if (path.endsWith('/submissions')) {
      return {
        submissions: [
          {
            ...receipt(),
            submittedAt: '2026-10-22T03:49:43.000Z',
            late: true,
            files: [
              {
                id: fileId,
                originalName: 'shot.jpg',
                contentType: 'image/jpeg',
                byteSize: 12,
                kind: 'image',
                downloadPath: `class-workspaces/${courseId}/assignments/${assignmentId}/files/${fileId}/content`,
                downloadExp: '1',
                downloadSig: 'sig',
              },
            ],
          },
        ],
      };
    }
    return response(path, context, input);
  });
  const view = await openCourse();
  fireEvent.press(view.getByRole('button', { name: '查看收件：校園訪談' }));
  expect(await view.findByText('遲交')).toBeTruthy();
  expect(view.getByText('2026/10/22 上午11:49:43')).toBeTruthy();
  expect(view.getByRole('button', { name: '查看' })).toBeTruthy();
  expect(view.getByRole('button', { name: '下載' })).toBeTruthy();
});

it('shows cross-course recent teacher feedback on the Nuni courses landing and opens the activity', async () => {
  assignment = {
    ...assignment,
    mySubmission: {
      ...receipt(),
      teacherFeedback: '訪談重點清楚',
      reviewedAt: '2026-10-10T02:00:00.000Z',
    },
  };
  const view = render(
    <NuniDraftProvider>
      <NuniCourses />
    </NuniDraftProvider>,
  );
  expect(await view.findByText('最近老師回饋 · 1')).toBeTruthy();
  expect(view.getByText('訪談重點清楚')).toBeTruthy();
  fireEvent.press(view.getByRole('button', { name: '開啟「校園訪談」完整回饋' }));
  expect(await view.findByText('請記錄訪談重點。')).toBeTruthy();
  expect(view.getByText(/老師回饋：訪談重點清楚/)).toBeTruthy();
});

it('marks earlier feedback after resubmission on the courses landing', async () => {
  assignment = {
    ...assignment,
    mySubmission: {
      ...receipt(),
      teacherFeedback: '針對舊稿',
      reviewedAt: '2026-10-08T02:00:00.000Z',
      submittedAt: '2026-10-09T04:00:00.000Z',
    },
  };
  const view = render(
    <NuniDraftProvider>
      <NuniCourses />
    </NuniDraftProvider>,
  );
  expect(await view.findByText(/早於最近繳交/)).toBeTruthy();
  expect(
    view.getByText('這則回饋早於你最近一次繳交，請到作業頁確認是否仍適用。'),
  ).toBeTruthy();
});

it('reports partial feedback load failure with retry instead of false empty success', async () => {
  mockRequest.mockImplementation((path: string, context?: string, input?: Record<string, unknown>) => {
    if (path.endsWith('/assignments') && !input) {
      throw new NuniError(500, 'REQUEST_FAILED');
    }
    return response(path, context, input);
  });
  const view = render(
    <NuniDraftProvider>
      <NuniCourses />
    </NuniDraftProvider>,
  );
  expect(await view.findByText(/有 1 門課程的回饋讀取失敗/)).toBeTruthy();
  expect(view.getByRole('button', { name: '重試讀取回饋' })).toBeTruthy();
  expect(view.queryByText('目前還沒有跨課程的老師回饋。')).toBeNull();
});

it('ignores stale recent-feedback responses after the Nuni session account changes', async () => {
  const slow = deferred<{ assignments: unknown[] }>();
  mockRequest.mockImplementation((path: string, context?: string, input?: Record<string, unknown>) => {
    if (path === 'class-workspaces' && !input) {
      if (context === 'context-second') {
        return {
          workspaces: [
            {
              ...course,
              id: 'cw_99999999-9999-4999-8999-999999999999',
              title: '新帳號課',
            },
          ],
        };
      }
      return { workspaces: [course] };
    }
    if (path.endsWith('/assignments') && !input) {
      if (context === 'context-first') {
        return slow.promise.then(() => ({
          assignments: [
            {
              ...assignment,
              mySubmission: {
                ...receipt(),
                teacherFeedback: '舊帳號回饋不應顯示',
                reviewedAt: date,
              },
            },
          ],
        }));
      }
      return { assignments: [] };
    }
    if (path.endsWith('/quizzes') && !input) return { quizzes: [] };
    return response(path, context, input);
  });
  const view = render(
    <NuniDraftProvider>
      <NuniCourses />
    </NuniDraftProvider>,
  );
  await view.findByText('服務設計課程');
  mockSession = {
    platformAccountId: 'pa_99999999-9999-4999-8999-999999999999',
    isPlatformOperator: false,
    context: 'context-second',
  };
  view.rerender(
    <NuniDraftProvider>
      <NuniCourses />
    </NuniDraftProvider>,
  );
  await view.findByText('新帳號課');
  await act(async () => {
    slow.resolve({ assignments: [] });
  });
  expect(view.queryByText('舊帳號回饋不應顯示')).toBeNull();
});

it('saves teacher feedback and advances to the next awaiting receipt after success', async () => {
  course = { ...course, memberRole: 'owner-teacher' };
  const peerId = 'pa_55555555-5555-4555-8555-555555555555';
  mockScrollAssignment.reveal.mockClear();
  mockRequest.mockImplementation((path: string, context?: string, input?: Record<string, unknown>) => {
    if (path.endsWith('/submissions')) {
      return {
        submissions: [
          receipt(),
          {
            ...receipt(),
            platformAccountId: peerId,
            displayName: '陳同學',
            body: '第二份',
            submittedAt: '2026-10-08T01:00:00.000Z',
          },
        ],
      };
    }
    if (path.endsWith('/feedback')) {
      return {
        ...receipt(),
        teacherFeedback: input!.feedback,
        reviewedAt: date,
      };
    }
    return response(path, context, input);
  });
  const view = await openCourse();
  fireEvent.press(view.getByRole('button', { name: '查看收件：校園訪談' }));
  expect(await view.findByText('待回饋第 1／2 份')).toBeTruthy();
  fireEvent.changeText(view.getByLabelText('給 測試學生 的回饋'), '第一份回饋');
  fireEvent.press(view.getAllByRole('button', { name: '儲存回饋並查看下一份' })[0]!);
  expect(await view.findByText(/已移到 陳同學 的繳交/)).toBeTruthy();
  expect(view.getByText(/目前批改這一份/)).toBeTruthy();
  await waitFor(() => expect(mockScrollAssignment.reveal).toHaveBeenCalled());
});

it('retains draft feedback when save-and-next fails', async () => {
  course = { ...course, memberRole: 'owner-teacher' };
  mockRequest.mockImplementation((path: string, context?: string, input?: Record<string, unknown>) => {
    if (path.endsWith('/submissions')) return { submissions: [receipt()] };
    if (path.endsWith('/feedback')) throw new NuniError(500, 'REQUEST_FAILED');
    return response(path, context, input);
  });
  const view = await openCourse();
  fireEvent.press(view.getByRole('button', { name: '查看收件：校園訪談' }));
  const editor = await view.findByLabelText('給 測試學生 的回饋');
  fireEvent.changeText(editor, '失敗仍應保留');
  fireEvent.press(view.getByRole('button', { name: '儲存回饋並查看下一份' }));
  expect(await view.findByText(/尚未確認這次送出結果/)).toBeTruthy();
  expect(view.getByDisplayValue('失敗仍應保留')).toBeTruthy();
  expect(view.queryByText(/已移到/)).toBeNull();
});

it('reveals an earlier awaiting receipt after save-and-next on a long queue', async () => {
  course = { ...course, memberRole: 'owner-teacher' };
  mockScrollAssignment.reveal.mockClear();
  const earlyId = 'pa_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const midId = accountId;
  const lateId = 'pa_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  mockRequest.mockImplementation((path: string, context?: string, input?: Record<string, unknown>) => {
    if (path.endsWith('/submissions')) {
      return {
        submissions: [
          {
            ...receipt(),
            platformAccountId: earlyId,
            displayName: '早交同學',
            body: '最早待回饋',
            submittedAt: '2026-10-08T01:00:00.000Z',
          },
          {
            ...receipt(),
            platformAccountId: midId,
            displayName: '測試學生',
            body: '中間待回饋',
            submittedAt: '2026-10-08T02:00:00.000Z',
          },
          {
            ...receipt(),
            platformAccountId: lateId,
            displayName: '晚交同學',
            body: '最晚待回饋',
            submittedAt: '2026-10-08T03:00:00.000Z',
          },
        ],
      };
    }
    if (path.endsWith('/feedback')) {
      return {
        ...receipt(),
        platformAccountId: midId,
        displayName: '測試學生',
        teacherFeedback: input!.feedback,
        reviewedAt: date,
      };
    }
    return response(path, context, input);
  });
  const view = await openCourse();
  fireEvent.press(view.getByRole('button', { name: '查看收件：校園訪談' }));
  await view.findByText('待回饋第 1／3 份');
  // Sorted pending newest-first: 晚交、測試學生、早交 — mid is the second save-next button.
  fireEvent.changeText(view.getByLabelText('給 測試學生 的回饋'), '中間回饋');
  fireEvent.press(view.getAllByRole('button', { name: '儲存回饋並查看下一份' })[1]!);
  // After mid leaves the awaiting list, nextAwaiting returns the first remaining (晚交, above).
  expect(await view.findByText(/已移到 晚交同學 的繳交/)).toBeTruthy();
  await waitFor(() => expect(mockScrollAssignment.reveal).toHaveBeenCalled());
  expect(view.getByTestId(`teacher-receipt-${assignmentId}-${lateId}`)).toBeTruthy();
});

it('does not advance or reveal when save-and-next replay returns different feedback', async () => {
  course = { ...course, memberRole: 'owner-teacher' };
  mockScrollAssignment.reveal.mockClear();
  const peerId = 'pa_55555555-5555-4555-8555-555555555555';
  let feedbackCalls = 0;
  mockRequest.mockImplementation((path: string, context?: string, input?: Record<string, unknown>) => {
    if (path.endsWith('/submissions')) {
      return {
        submissions: [
          receipt(),
          {
            ...receipt(),
            platformAccountId: peerId,
            displayName: '陳同學',
            body: '第二份',
            submittedAt: '2026-10-08T01:00:00.000Z',
          },
        ],
      };
    }
    if (path.endsWith('/feedback')) {
      feedbackCalls += 1;
      if (feedbackCalls === 1) throw new NuniError(0, 'REQUEST_FAILED');
      return {
        ...receipt(),
        teacherFeedback: '另一位老師已補充新的回饋',
        reviewedAt: date,
      };
    }
    return response(path, context, input);
  });
  const view = await openCourse();
  fireEvent.press(view.getByRole('button', { name: '查看收件：校園訪談' }));
  fireEvent.changeText(await view.findByLabelText('給 測試學生 的回饋'), '原本送出的回饋');
  fireEvent.press(view.getAllByRole('button', { name: '儲存回饋並查看下一份' })[0]!);
  expect(await view.findByText(/尚未確認這次送出結果/)).toBeTruthy();
  fireEvent.press(view.getByRole('button', { name: '重試確認這次送出' }));
  expect(await view.findByText('這份回饋已有新的內容，上方顯示目前儲存的版本。')).toBeTruthy();
  expect(view.queryByText(/已移到 陳同學/)).toBeNull();
  expect(mockScrollAssignment.reveal).not.toHaveBeenCalled();
  expect(view.getByDisplayValue('另一位老師已補充新的回饋')).toBeTruthy();
});

it('drops a pending receipt reveal when the course session context changes', async () => {
  course = { ...course, memberRole: 'owner-teacher' };
  mockScrollAssignment.reveal.mockClear();
  const peerId = 'pa_55555555-5555-4555-8555-555555555555';
  const slow = deferred<{
    assignmentId: string;
    platformAccountId: string;
    displayName: string;
    body: string;
    state: string;
    submittedAt: string;
    teacherFeedback: string;
    reviewedAt: string;
  }>();
  mockRequest.mockImplementation((path: string, context?: string, input?: Record<string, unknown>) => {
    if (path.endsWith('/submissions')) {
      return {
        submissions: [
          receipt(),
          {
            ...receipt(),
            platformAccountId: peerId,
            displayName: '陳同學',
            body: '第二份',
            submittedAt: '2026-10-08T01:00:00.000Z',
          },
        ],
      };
    }
    if (path.endsWith('/feedback')) return slow.promise;
    return response(path, context, input);
  });
  const view = await openCourse();
  fireEvent.press(view.getByRole('button', { name: '查看收件：校園訪談' }));
  fireEvent.changeText(await view.findByLabelText('給 測試學生 的回饋'), '第一份回饋');
  fireEvent.press(view.getAllByRole('button', { name: '儲存回饋並查看下一份' })[0]!);
  mockSession = { ...mockSession, context: 'context-second' };
  view.rerender(<NuniCourses />);
  await act(async () => {
    slow.resolve({
      ...receipt(),
      teacherFeedback: '第一份回饋',
      reviewedAt: date,
    });
  });
  expect(view.queryByText(/已移到 陳同學/)).toBeNull();
  expect(mockScrollAssignment.reveal).not.toHaveBeenCalled();
});

function materialPageFixture(total = 220, pageSize = 50) {
  const all = Array.from({ length: total }, (_, index) =>
    material(index + 1, index === 179 ? '遠端目標教材 180' : index === 219 ? '頁尾目標 220' : undefined),
  );
  const pages: { materials: NuniMaterial[]; nextCursor: string | null }[] = [];
  for (let start = 0; start < total; start += pageSize) {
    const slice = all.slice(start, start + pageSize);
    const pageIndex = start / pageSize;
    pages.push({
      materials: slice,
      nextCursor: start + pageSize < total ? `page_${pageIndex + 1}` : null,
    });
  }
  return { all, pages };
}

it('searches only loaded material pages and keeps honest older-content empty copy', async () => {
  const { pages } = materialPageFixture(220, 50);
  mockRequest.mockImplementation((path, context, input, _method, query) => {
    if (!path.endsWith('/materials/page')) return response(path, context, input);
    if (!query) return Promise.resolve(pages[0]);
    if (query.cursor === 'page_1') return Promise.resolve(pages[1]);
    throw new Error(`unexpected cursor ${JSON.stringify(query)}`);
  });
  const view = await openCourse();
  fireEvent.press(view.getByRole('button', { name: '教材 50+' }));
  expect(view.getByText('已載入 50 筆教材，還有較早內容。')).toBeTruthy();
  fireEvent.changeText(view.getByLabelText('在這門課找已載入教材'), '遠端目標教材');
  expect(view.getByText('已載入教材中沒有相符結果，還有較早內容')).toBeTruthy();
  expect(view.queryByText('遠端目標教材 180')).toBeNull();
  expect(view.getByRole('button', { name: '載入較早教材' })).toBeTruthy();
  fireEvent.press(view.getByRole('button', { name: '載入較早教材' }));
  await view.findByText('已載入教材中沒有相符結果，還有較早內容');
  expect(view.getByRole('button', { name: '教材 100+' })).toBeTruthy();
  fireEvent.changeText(view.getByLabelText('在這門課找已載入教材'), '第 2 份');
  expect(view.getByText('已載入 100 筆，符合 1 筆，還有較早內容。')).toBeTruthy();
  expect(view.getByText('第 2 份教材')).toBeTruthy();
  expect(
    mockRequest.mock.calls.filter(([path]) => path.endsWith('/materials')).length,
  ).toBe(0);
});

it('finds materialId targets beyond page 100 through legal materialsPage cursors', async () => {
  const { pages, all } = materialPageFixture(220, 50);
  const target = all[179]!;
  mockRequest.mockImplementation((path, context, input, _method, query) => {
    if (!path.endsWith('/materials/page')) return response(path, context, input);
    if (!query) return Promise.resolve(pages[0]);
    const index = Number(String(query.cursor).replace('page_', ''));
    return Promise.resolve(pages[index]!);
  });
  const view = render(
    <NuniCourses initialWorkspaceId={courseId} initialMaterialId={target.id} />,
  );
  await view.findByText('目標教材', {}, { timeout: 5000 });
  expect(view.getByText('遠端目標教材 180')).toBeTruthy();
  expect(view.getByLabelText('目標教材：遠端目標教材 180')).toBeTruthy();
  expect(view.getByTestId(`material-${target.id}`)).toBeTruthy();
  const pageCalls = mockRequest.mock.calls.filter(([path]) => path.endsWith('/materials/page'));
  expect(pageCalls.map((call) => call[4]?.cursor ?? null)).toEqual([
    null,
    'page_1',
    'page_2',
    'page_3',
  ]);
  fireEvent(view.getByTestId(`material-${target.id}`), 'layout');
  expect(mockScrollAssignment.reveal).toHaveBeenCalled();
});

it('clears a hiding search when opening a material target and keeps the target visible', async () => {
  mockRequest.mockImplementation((path, context, input) => {
    if (!path.endsWith('/materials/page')) return response(path, context, input);
    return Promise.resolve({
      materials: [material(1, '服務設計導讀'), material(2, '關聯與主鍵')],
      nextCursor: null,
    });
  });
  const cache = new Map<string, unknown>([[`course:${courseId}:tab`, 'assignments']]);
  const view = render(
    <NuniDraftProvider cache={cache}>
      <NuniCourses
        initialWorkspaceId={courseId}
        initialMaterialId={material(2, '關聯與主鍵').id}
      />
    </NuniDraftProvider>,
  );
  await view.findByText('目標教材');
  expect(view.getByText('關聯與主鍵')).toBeTruthy();
  fireEvent.changeText(view.getByLabelText('在這門課找已載入教材'), '服務設計');
  expect(view.getByText('服務設計導讀')).toBeTruthy();
  expect(view.getByText('關聯與主鍵')).toBeTruthy();
  expect(view.getByLabelText('目標教材：關聯與主鍵')).toBeTruthy();
});

it('pauses target seeking at the auto page budget without claiming the material is missing', async () => {
  const cursors = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'];
  mockRequest.mockImplementation((path, context, input, _method, query) => {
    if (!path.endsWith('/materials/page')) return response(path, context, input);
    if (!query) return Promise.resolve({ materials: [material(1)], nextCursor: cursors[0] });
    const at = cursors.indexOf(String(query.cursor));
    return Promise.resolve({
      materials: [material(at + 2)],
      nextCursor: cursors[at + 1] ?? null,
    });
  });
  const missingId = material(99).id;
  const view = render(
    <NuniCourses initialWorkspaceId={courseId} initialMaterialId={missingId} />,
  );
  await view.findByText('尚未找到這份教材，已暫停自動載入。可繼續尋找或載入較早教材。');
  expect(view.queryByText(/找不到這份教材/)).toBeNull();
  expect(view.getByRole('button', { name: '繼續尋找' })).toBeTruthy();
  expect(view.getByText('第 1 份教材')).toBeTruthy();
  const olderCalls = mockRequest.mock.calls.filter(
    ([path, , , , query]) => path.endsWith('/materials/page') && query,
  );
  expect(olderCalls).toHaveLength(4);
});

it('stops an A→B→A materials cursor cycle and keeps loaded rows', async () => {
  mockRequest.mockImplementation((path, context, input, _method, query) => {
    if (!path.endsWith('/materials/page')) return response(path, context, input);
    if (!query) return Promise.resolve({ materials: [material(1)], nextCursor: 'cursor-a' });
    if (query.cursor === 'cursor-a')
      return Promise.resolve({ materials: [material(2)], nextCursor: 'cursor-b' });
    if (query.cursor === 'cursor-b')
      return Promise.resolve({ materials: [material(3)], nextCursor: 'cursor-a' });
    throw new Error(`unexpected ${JSON.stringify(query)}`);
  });
  const view = await openCourse();
  fireEvent.press(view.getByRole('button', { name: '教材 1+' }));
  fireEvent.press(view.getByRole('button', { name: '載入較早教材' }));
  await view.findByText('第 2 份教材');
  fireEvent.press(view.getByRole('button', { name: '載入較早教材' }));
  await view.findByText(/較早教材未能繼續載入/);
  expect(view.getByText('第 3 份教材')).toBeTruthy();
  expect(view.queryByText('共 3 筆教材。')).toBeNull();
  expect(view.getByRole('button', { name: '更新教材' })).toBeTruthy();
  expect(view.queryByRole('button', { name: '載入較早教材' })).toBeNull();
  const olderCalls = mockRequest.mock.calls.filter(
    ([path, , , , query]) => path.endsWith('/materials/page') && query,
  );
  expect(olderCalls).toHaveLength(2);
});

it('keeps search query and loaded materials after a mid-page 503, then retries the same cursor', async () => {
  let olderAttempts = 0;
  mockRequest.mockImplementation((path, context, input, _method, query) => {
    if (!path.endsWith('/materials/page')) return response(path, context, input);
    if (!query) return Promise.resolve({ materials: [material(1, '可搜尋教材')], nextCursor: 'next' });
    if (++olderAttempts === 1) return Promise.reject(new NuniError(503, 'UNAVAILABLE'));
    return Promise.resolve({ materials: [material(2, '可搜尋的較早教材')], nextCursor: null });
  });
  const view = await openCourse();
  fireEvent.press(view.getByRole('button', { name: '教材 1+' }));
  fireEvent.changeText(view.getByLabelText('在這門課找已載入教材'), '可搜尋');
  expect(view.getByText('已載入 1 筆，符合 1 筆，還有較早內容。')).toBeTruthy();
  fireEvent.press(view.getByRole('button', { name: '載入較早教材' }));
  await view.findByRole('button', { name: '重試載入較早教材' });
  expect(view.getByText('可搜尋教材')).toBeTruthy();
  expect(view.getByLabelText('在這門課找已載入教材').props.value).toBe('可搜尋');
  fireEvent.press(view.getByRole('button', { name: '重試載入較早教材' }));
  await view.findByText('可搜尋的較早教材');
  expect(view.getByText('已載入 2 筆，符合 2 筆。')).toBeTruthy();
  expect(
    mockRequest.mock.calls
      .filter(([path, , , , query]) => path.endsWith('/materials/page') && query)
      .map((call) => call[4]),
  ).toEqual([{ cursor: 'next' }, { cursor: 'next' }]);
});

it('ignores a late material target page after session A→B→A replacement', async () => {
  const older = deferred<unknown>();
  mockRequest.mockImplementation((path, context, input, _method, query) => {
    if (!path.endsWith('/materials/page')) return response(path, context, input);
    if (!query) return Promise.resolve({ materials: [material(1)], nextCursor: 'older_page' });
    return older.promise;
  });
  const targetId = material(2).id;
  const view = render(
    <NuniCourses initialWorkspaceId={courseId} initialMaterialId={targetId} />,
  );
  await view.findByRole('button', { name: '取消尋找' });
  fireEvent.changeText(view.getByLabelText('在這門課找已載入教材'), '舊身份搜尋');
  mockSession = {
    ...mockSession,
    context: 'context-second',
    platformAccountId: 'pa_55555555-5555-4555-8555-555555555555',
  };
  mockRequest.mockImplementation((path, context, input) => {
    if (path === 'class-workspaces') return { workspaces: [] };
    return response(path, context, input);
  });
  view.rerender(<NuniCourses />);
  await view.findByText('尚未加入修習課程。請向老師取得邀請碼。');
  mockSession = { ...mockSession, context: 'context-first', platformAccountId: accountId };
  mockRequest.mockImplementation((path, context, input) =>
    path.endsWith('/materials/page')
      ? { materials: [material(3, '重新登入後的教材')], nextCursor: null }
      : response(path, context, input),
  );
  view.rerender(<NuniCourses initialWorkspaceId={courseId} />);
  await view.findByText('校園訪談');
  fireEvent.press(view.getByRole('button', { name: '教材 1' }));
  expect(view.getByText('重新登入後的教材')).toBeTruthy();
  expect(view.getByLabelText('在這門課找已載入教材').props.value).toBe('');
  await act(async () => older.resolve({ materials: [material(2)], nextCursor: null }));
  expect(view.queryByText('第 2 份教材')).toBeNull();
  expect(view.queryByText('目標教材')).toBeNull();
});

it('explains a missing linked material only after the page chain is exhausted', async () => {
  mockRequest.mockImplementation((path, context, input) => {
    if (!path.endsWith('/materials/page')) return response(path, context, input);
    return Promise.resolve({ materials: [material(1)], nextCursor: null });
  });
  const view = render(
    <NuniCourses
      initialWorkspaceId={courseId}
      initialMaterialId="cwm_66666666-6666-4666-8666-000000009999"
    />,
  );
  expect(
    await view.findByText(
      '找不到這份教材。可能已被老師刪除，或你沒有查看權限。請從教材列表選擇其他教材。',
    ),
  ).toBeTruthy();
  expect(view.getByText('第 1 份教材')).toBeTruthy();
});

it('cancels a material lookup before its pending page can append or reveal the target', async () => {
  const older = deferred<unknown>();
  mockRequest.mockImplementation((path, context, input, _method, query) => {
    if (!path.endsWith('/materials/page')) return response(path, context, input);
    if (!query) return { materials: [material(1)], nextCursor: 'pending_target' };
    return older.promise;
  });
  const view = render(
    <NuniCourses initialWorkspaceId={courseId} initialMaterialId={material(2).id} />,
  );
  await waitFor(() =>
    expect(mockRequest.mock.calls.some((call) => call[4]?.cursor === 'pending_target')).toBe(true),
  );
  fireEvent.press(view.getByRole('button', { name: '取消尋找' }));
  await act(async () => older.resolve({ materials: [material(2)], nextCursor: null }));
  expect(view.queryByText('第 2 份教材')).toBeNull();
  expect(view.queryByText('目標教材')).toBeNull();
  expect(view.getByText('第 1 份教材')).toBeTruthy();
  expect(view.getByRole('button', { name: '繼續尋找' })).toBeTruthy();
});

it('keeps pager progress on the newest first-page snapshot after overlapping refreshes', async () => {
  const olderFirstPage = deferred<unknown>();
  let firstPageReads = 0;
  mockRequest.mockImplementation((path, context, input, _method, query) => {
    if (!path.endsWith('/materials/page')) return response(path, context, input);
    if (query) return { materials: [material(4, '新快照較早教材')], nextCursor: null };
    firstPageReads += 1;
    if (firstPageReads === 1) return { materials: [material(1)], nextCursor: 'initial' };
    if (firstPageReads === 2) return olderFirstPage.promise;
    return { materials: [material(3, '最新第一頁')], nextCursor: 'latest' };
  });
  const view = await openCourse();
  fireEvent.press(view.getByRole('button', { name: '教材 1+' }));
  const refresh = view.getByRole('button', { name: '更新內容' });
  act(() => {
    fireEvent.press(refresh);
    fireEvent.press(refresh);
  });
  await view.findByText('最新第一頁');
  await act(async () =>
    olderFirstPage.resolve({ materials: [material(2, '過期第一頁')], nextCursor: 'obsolete' }),
  );
  expect(view.queryByText('過期第一頁')).toBeNull();
  fireEvent.press(view.getByRole('button', { name: '載入較早教材' }));
  await view.findByText('新快照較早教材');
  expect(view.getByText('最新第一頁')).toBeTruthy();
  expect(view.queryByText('過期第一頁')).toBeNull();
  expect(mockRequest.mock.calls.at(-1)?.[4]).toEqual({ cursor: 'latest' });
});

it('loads course memberships once and reuses the same activity reads for agenda and feedback', async () => {
  assignment = {
    ...assignment,
    mySubmission: { ...receipt(), teacherFeedback: '已經確認', reviewedAt: date },
  };
  const view = render(<NuniCourses />);
  await view.findByText('最近老師回饋 · 1');
  expect(mockRequest.mock.calls.filter(([path]) => path === 'class-workspaces')).toHaveLength(1);
  expect(mockRequest.mock.calls.filter(([path]) => path.endsWith('/assignments'))).toHaveLength(1);
  expect(mockRequest.mock.calls.filter(([path]) => path.endsWith('/quizzes'))).toHaveLength(1);
});

it('searches the course directory, separates roles and restores all courses after an empty result', async () => {
  const teacher = {
    ...course,
    id: 'cw_99999999-9999-4999-8999-999999999999',
    title: 'Web 專題',
    memberRole: 'owner-teacher',
  };
  const archived = {
    ...course,
    id: 'cw_88888888-8888-4888-8888-888888888888',
    title: '上學期課程',
    state: 'archived',
  };
  mockRequest.mockImplementation((path, context, input) =>
    path === 'class-workspaces' && !input
      ? { workspaces: [course, teacher, archived] }
      : response(path, context, input),
  );
  const view = render(<NuniCourses />);
  await view.findByRole('button', { name: 'Web 專題' });
  fireEvent.changeText(view.getByLabelText('搜尋我的課程'), ' ＷＥＢ ');
  expect(view.getByRole('button', { name: 'Web 專題' })).toBeTruthy();
  expect(view.queryByRole('button', { name: '服務設計課程' })).toBeNull();
  fireEvent.press(view.getByRole('button', { name: '已封存 1' }));
  expect(view.getByText('沒有符合的課程。試試其他名稱，或顯示所有課程。')).toBeTruthy();
  fireEvent.press(view.getByRole('button', { name: '顯示所有課程' }));
  expect(view.getByRole('button', { name: '上學期課程' })).toBeTruthy();
  expect(view.getByRole('button', { name: '服務設計課程' })).toBeTruthy();
  fireEvent.press(view.getByRole('button', { name: '授課 1' }));
  expect(view.getByRole('button', { name: 'Web 專題' })).toBeTruthy();
  expect(view.queryByRole('button', { name: '上學期課程' })).toBeNull();
});

it('opens a quiz directly from the cross-course agenda', async () => {
  const view = render(<NuniCourses />);
  fireEvent.press(await view.findByRole('button', { name: '開啟測驗：需求練習' }));
  expect(await view.findByLabelText('測驗內容：需求練習')).toBeTruthy();
  expect(view.getByRole('button', { name: '測驗 1' })).toHaveAccessibilityState({ selected: true });
  expect(view.queryByLabelText('作業內容：校園訪談')).toBeNull();
});

it('retains the editing draft when an activity is collapsed, searched away and restored', async () => {
  const view = await openCourse();
  fireEvent.changeText(view.getByLabelText('作業內容：校園訪談'), '尚未繳交的訪談草稿');
  fireEvent.press(view.getByRole('button', { name: '收合作業：校園訪談' }));
  expect(view.queryByLabelText('作業內容：校園訪談')).toBeNull();
  fireEvent.changeText(view.getByLabelText('搜尋這門課的作業'), '資料庫');
  expect(view.getByText('沒有符合的作業或測驗。請更換關鍵字，或清除搜尋。')).toBeTruthy();
  expect(view.queryByText('校園訪談')).toBeNull();
  fireEvent.press(view.getByRole('button', { name: '清除作業與測驗搜尋' }));
  fireEvent.press(view.getByRole('button', { name: '展開作業：校園訪談' }));
  expect(view.getByLabelText('作業內容：校園訪談').props.value).toBe('尚未繳交的訪談草稿');
  expect(mockRequest.mock.calls.some(([path]) => path.endsWith('/submit'))).toBe(false);
});

it('collapses a long activity list while letting each saved form be opened independently', async () => {
  const extra = Array.from({ length: 8 }, (_, index) => ({
    ...assignment,
    id: `cwa_77777777-7777-4777-8777-${String(index).padStart(12, '0')}`,
    title: `延伸作業 ${index + 1}`,
  }));
  mockRequest.mockImplementation((path, context, input) =>
    path.endsWith('/assignments') && !input
      ? { assignments: [assignment, ...extra] }
      : response(path, context, input),
  );
  const view = await openCourse();
  expect(view.getByLabelText('作業內容：校園訪談')).toBeTruthy();
  expect(view.queryByLabelText('作業內容：延伸作業 8')).toBeNull();
  fireEvent.press(view.getByRole('button', { name: '展開作業：延伸作業 8' }));
  expect(view.getByLabelText('作業內容：延伸作業 8')).toBeTruthy();
});

it('removes previous agenda and feedback after a rejected session refresh', async () => {
  let denied = false;
  assignment = { ...assignment, mySubmission: { ...receipt(), teacherFeedback: '上一份已載入回饋', reviewedAt: date } };
  mockRequest.mockImplementation((path, context, input) => {
    if (denied && (path.endsWith('/assignments') || path.endsWith('/quizzes'))) {
      throw new NuniError(401, 'SIGN_IN_REQUIRED');
    }
    return response(path, context, input);
  });
  const view = render(<NuniCourses />);
  await view.findByText('上一份已載入回饋');
  expect(view.getByRole('button', { name: '開啟測驗：需求練習' })).toBeTruthy();
  denied = true;
  fireEvent.press(view.getByRole('button', { name: '更新課程' }));
  await view.findByRole('button', { name: '重新讀取待辦' });
  expect(view.queryByText('上一份已載入回饋')).toBeNull();
  expect(view.queryByRole('button', { name: '開啟測驗：需求練習' })).toBeNull();
});

it.each([403, 404])('keeps a revoked course directory hidden while retrying a %i list response', async (status) => {
  let listReads = 0;
  const retry = deferred<unknown>();
  assignment = {
    ...assignment,
    mySubmission: { ...receipt(), teacherFeedback: '已撤銷課程的回饋', reviewedAt: date },
  };
  mockRequest.mockImplementation((path, context, input) => {
    if (path === 'class-workspaces' && !input) {
      listReads += 1;
      if (listReads === 2) throw new NuniError(status, 'CLASS_WORKSPACE_FORBIDDEN');
      if (listReads === 3) return retry.promise;
    }
    return response(path, context, input);
  });
  const view = render(<NuniCourses />);
  await view.findByText('已撤銷課程的回饋');
  expect(view.getByRole('button', { name: '服務設計課程' })).toBeTruthy();
  expect(view.getByRole('button', { name: '開啟測驗：需求練習' })).toBeTruthy();

  fireEvent.press(view.getByRole('button', { name: '更新課程' }));
  await waitFor(() => {
    expect(listReads).toBe(2);
    expect(view.queryByRole('button', { name: '服務設計課程' })).toBeNull();
    expect(view.getByRole('button', { name: '更新課程' })).toHaveAccessibilityState({ disabled: false });
  });
  fireEvent.press(view.getByRole('button', { name: '更新課程' }));
  await waitFor(() => expect(listReads).toBe(3));
  expect(view.getByText('正在讀取課程…')).toBeTruthy();
  expect(view.queryByRole('button', { name: '服務設計課程' })).toBeNull();
  expect(view.queryByRole('button', { name: '開啟測驗：需求練習' })).toBeNull();
  expect(view.queryByText('已撤銷課程的回饋')).toBeNull();
  expect(view.queryByLabelText('搜尋我的課程')).toBeNull();

  await act(async () => retry.resolve({ workspaces: [] }));
  await view.findByText('尚未加入修習課程。請向老師取得邀請碼。');
  expect(view.queryByText('已撤銷課程的回饋')).toBeNull();
});

it('limits empty feedback claims when the activity response may omit older records', async () => {
  const assignments = Array.from({ length: 100 }, (_, index) => ({
    ...assignment,
    id: `cwa_77777777-7777-4777-8777-${String(index).padStart(12, '0')}`,
    title: `近期作業 ${index + 1}`,
  }));
  mockRequest.mockImplementation((path, context, input) =>
    path.endsWith('/assignments') && !input
      ? { assignments }
      : response(path, context, input),
  );
  const view = render(<NuniCourses />);
  await view.findByText('已載入內容中尚無回饋，較早紀錄可能未包含。');
  expect(view.queryByText('目前還沒有跨課程的老師回饋。')).toBeNull();
});

it('withdraws the current assignment receipt and returns to the submission form', async () => {
  fileSubmitFlag.on = true;
  assignment = { ...assignment, mySubmission: receipt(), submissionCount: 1 };
  mockRequest.mockImplementation(async (path, context, input) => {
    if (path.endsWith('/withdraw-submission')) {
      assignment = { ...assignment, mySubmission: null, submissionCount: 0 };
      return assignment;
    }
    return response(path, context, input);
  });
  const view = await openCourse();
  fireEvent.press(view.getByRole('button', { name: '撤回繳交' }));
  await waitFor(() => expect(view.getByText('已撤回，截止前可以重新繳交。')).toBeTruthy());
  expect(view.queryByRole('button', { name: '撤回繳交' })).toBeNull();
  expect(view.getByRole('button', { name: '繳交作業' })).toBeTruthy();
  expect(mockRequest).toHaveBeenCalledWith(
    expect.stringContaining('/withdraw-submission'),
    mockSession.context,
    expect.objectContaining({ submittedAt: date }),
  );
});

it.each([false, true])('preserves text submission after deadline with attachments off (existing receipt: %s)', async (existing) => {
  fileSubmitFlag.on = false;
  assignment = {
    ...assignment,
    dueAt: '2020-10-31T12:00:00Z',
    mySubmission: existing ? receipt() : null,
    submissionCount: existing ? 1 : 0,
  };
  const view = await openCourse();
  expect(view.queryByText('已過截止時間，這份繳交不能再修改或撤回。')).toBeNull();
  fireEvent.changeText(view.getByLabelText('作業內容：校園訪談'), '關閉附件後的文字內容');
  fireEvent.press(view.getByRole('button', { name: existing ? '更新作業繳交' : '繳交作業' }));
  await waitFor(() => expect(mockRequest).toHaveBeenCalledWith(
    `class-workspaces/${courseId}/assignments/${assignmentId}/submit`,
    mockSession.context,
    expect.objectContaining({ body: '關閉附件後的文字內容' }),
  ));
  await view.findByText('關閉附件後的文字內容');
});

it('shows the assignment deadline state with the existing receipt', async () => {
  fileSubmitFlag.on = true;
  assignment = {
    ...assignment,
    dueAt: '2020-10-31T12:00:00Z',
    mySubmission: receipt(),
    submissionCount: 1,
  };
  const view = await openCourse();
  expect(view.getByText('已過截止時間，這份繳交不能再修改或撤回。')).toBeTruthy();
  expect(view.queryByRole('button', { name: '撤回繳交' })).toBeNull();
  expect(view.queryByRole('button', { name: '更新作業繳交' })).toBeNull();
});

it.each(['alignment', 'lost-response'])(
  'recovers uploaded revision after deadline and rerender: %s',
  async (failure) => {
    fileSubmitFlag.on = true;
    let now = Date.parse('2026-10-09T11:59:00Z');
    const clock = jest.spyOn(Date, 'now').mockImplementation(() => now);
    assignment = { ...assignment, dueAt: '2026-10-09T12:00:00Z', mySubmission: receipt() };
    const fileId = 'cwf_77777777-7777-4777-8777-777777777777';
    const metadata = {
      id: fileId,
      originalName: 'repair.pdf',
      contentType: 'application/pdf',
      byteSize: 12,
      kind: 'file',
      downloadPath: `class-workspaces/${courseId}/assignments/${assignmentId}/files/${fileId}/content`,
      downloadExp: '1',
      downloadSig: 'sig',
    };
    const picker = require('expo-document-picker');
    picker.getDocumentAsync.mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: 'file:///repair.pdf', name: 'repair.pdf', mimeType: 'application/pdf' }],
    });
    mockUpload.mockReset().mockResolvedValue(metadata);
    const submissions: Record<string, unknown>[] = [];
    mockRequest.mockImplementation((path, context, input) => {
      if (path.endsWith('/files/intents'))
        return { intents: [{ ...metadata, uploadPath: metadata.downloadPath }] };
      if (path.endsWith('/submit-files')) {
        submissions.push(input);
        if (submissions.length === 1)
          throw failure === 'alignment'
            ? new NuniError(503, 'ASSIGNMENT_FILE_STORE_UNAVAILABLE')
            : new TypeError('response lost');
        if (submissions.length === 2)
          throw new NuniError(503, 'ASSIGNMENT_FILE_STORE_UNAVAILABLE');
        return { ...assignment, mySubmission: { ...receipt(), files: [metadata] } };
      }
      return response(path, context, input);
    });
    const view = await openCourse();
    fireEvent.press(view.getByRole('button', { name: '檔案' }));
    await view.findByText('repair.pdf · 12 B');
    fireEvent.press(view.getByRole('button', { name: '更新作業繳交' }));
    await view.findByRole('button', { name: '重試確認這次送出' });
    now = Date.parse('2026-10-09T12:01:00Z');
    view.rerender(<NuniCourses />);
    fireEvent.press(view.getByRole('button', { name: '重試確認這次送出' }));
    await waitFor(() => expect(submissions).toHaveLength(2));
    await view.findByRole('button', { name: '重試確認這次送出' });
    view.rerender(<NuniCourses />);
    fireEvent.press(view.getByRole('button', { name: '重試確認這次送出' }));
    await view.findByText('repair.pdf · 檔案');
    expect(mockUpload).toHaveBeenCalledTimes(1);
    expect(submissions).toHaveLength(3);
    expect(submissions[2]).toEqual(submissions[0]);
    expect(submissions[1]).toEqual(submissions[0]);
    expect(view.queryByRole('button', { name: '更新作業繳交' })).toBeNull();
    clock.mockRestore();
  },
);

it.each(['superseded'])(
  'refreshes current receipt after replaced recovery: %s',
  async (failure) => {
    fileSubmitFlag.on = true;
    let now = Date.parse('2026-10-09T11:59:00Z');
    const clock = jest.spyOn(Date, 'now').mockImplementation(() => now);
    assignment = { ...assignment, dueAt: '2026-10-09T12:00:00Z', mySubmission: receipt() };
    const fileId = 'cwf_77777777-7777-4777-8777-777777777777';
    const metadata = {
      id: fileId,
      originalName: 'repair.pdf',
      contentType: 'application/pdf',
      byteSize: 12,
      kind: 'file',
      downloadPath: `class-workspaces/${courseId}/assignments/${assignmentId}/files/${fileId}/content`,
      downloadExp: '1',
      downloadSig: 'sig',
    };
    const picker = require('expo-document-picker');
    picker.getDocumentAsync.mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: 'file:///repair.pdf', name: 'repair.pdf', mimeType: 'application/pdf' }],
    });
    mockUpload.mockReset().mockResolvedValue(metadata);
    const submissions: Record<string, unknown>[] = [];
    mockRequest.mockImplementation((path, context, input) => {
      if (path.endsWith('/files/intents'))
        return { intents: [{ ...metadata, uploadPath: metadata.downloadPath }] };
      if (path.endsWith('/submit-files')) {
        submissions.push(input);
        if (submissions.length === 1)
          throw failure === 'alignment'
            ? new NuniError(503, 'ASSIGNMENT_FILE_STORE_UNAVAILABLE')
            : new TypeError('response lost');
        if (submissions.length === 2) {
          assignment = { ...assignment, mySubmission: { ...receipt(), body: 'new B', files: [] } };
          throw new NuniError(409, 'ASSIGNMENT_SUBMISSION_SUPERSEDED');
        }
        return { ...assignment, mySubmission: { ...receipt(), files: [metadata] } };
      }
      return response(path, context, input);
    });
    const view = await openCourse();
    fireEvent.press(view.getByRole('button', { name: '檔案' }));
    await view.findByText('repair.pdf · 12 B');
    fireEvent.press(view.getByRole('button', { name: '更新作業繳交' }));
    await view.findByRole('button', { name: '重試確認這次送出' });
    now = Date.parse('2026-10-09T12:01:00Z');
    view.rerender(<NuniCourses />);
    fireEvent.press(view.getByRole('button', { name: '重試確認這次送出' }));
    await waitFor(() => expect(submissions).toHaveLength(2));
    await view.findByText('這次繳交已被較新的提交取代，請以目前回執為準。');
    await view.findByText('new B');
    expect(view.queryByText('repair.pdf · 檔案')).toBeNull();
    expect(mockUpload).toHaveBeenCalledTimes(1);
    clock.mockRestore();
  },
);

it('舊版本缺少影像模組時保留既有附件操作並隱藏轉檔入口', async () => {
  const availability = jest.spyOn(photoPdf, 'photoPdfAvailable').mockReturnValue(false);
  try {
    fileSubmitFlag.on = true;
    const view = await openCourse();
    expect(view.queryByRole('button', { name: '照片轉 PDF' })).toBeNull();
    expect(view.getByRole('button', { name: '相簿' })).toBeTruthy();
    expect(view.getByRole('button', { name: '檔案' })).toBeTruthy();
  } finally {
    availability.mockRestore();
  }
});

it('自動收件晚到不覆蓋教師剛儲存的回饋，慢讀取不重疊', async () => {
  AppState.currentState = 'active';
  course = { ...course, memberRole: 'owner-teacher' };
  const view = await openCourse();
  jest.useFakeTimers();
  try {
    await act(async () => { fireEvent.press(view.getByRole('button', { name: '查看收件：校園訪談' })); });
    const older = deferred<unknown>();
    const fresh = { ...receipt(), teacherFeedback: '新的教師回饋', reviewedAt: date };
    mockRequest.mockImplementation((path, context, input) => {
      if (path.endsWith('/submissions')) return older.promise;
      return response(path, context, input);
    });
    const count = () => mockRequest.mock.calls.filter(([path]) => path.endsWith('/submissions')).length;
    await act(async () => { jest.advanceTimersByTime(60000); });
    const started = count();
    expect(started).toBe(2);
    await act(async () => { jest.advanceTimersByTime(10000); });
    expect(count()).toBe(started);
    fireEvent.changeText(view.getByLabelText('給 測試學生 的回饋'), '新的教師回饋');
    await act(async () => { fireEvent.press(view.getByRole('button', { name: '儲存老師回饋' })); });
    expect(view.getByText('已回饋：新的教師回饋')).toBeTruthy();
    const newer = deferred<unknown>();
    mockRequest.mockImplementation((path, context, input) => path.endsWith('/submissions') ? newer.promise : response(path, context, input));
    await act(async () => { older.resolve({ submissions: [receipt()] }); });
    expect(view.getByText('已回饋：新的教師回饋')).toBeTruthy();
    await act(async () => { newer.resolve({ submissions: [fresh] }); });
    expect(view.getByText('已回饋：新的教師回饋')).toBeTruthy();
    view.unmount();
  } finally { jest.useRealTimers(); }
});


it('背景回前景後丟棄較早收件，切換教材停止兩份自動清單', async () => {
  AppState.currentState = 'active';
  course = { ...course, memberRole: 'owner-teacher' };
  const listeners = new Set<(state: AppStateStatus) => void>();
  const spy = jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    listeners.add(listener);
    return { remove: () => { listeners.delete(listener); } };
  });
  const view = await openCourse();
  jest.useFakeTimers();
  try {
    await act(async () => { fireEvent.press(view.getByRole('button', { name: '查看收件：校園訪談' })); });
    const older = deferred<unknown>();
    const newer = deferred<unknown>();
    let reads = 0;
    mockRequest.mockImplementation((path, context, input) => {
      if (path.endsWith('/submissions')) return ++reads === 1 ? older.promise : newer.promise;
      return response(path, context, input);
    });
    await act(async () => { jest.advanceTimersByTime(60000); });
    expect(reads).toBe(1);
    await act(async () => {
      AppState.currentState = 'background';
      listeners.forEach((listener) => listener('background'));
      AppState.currentState = 'active';
      listeners.forEach((listener) => listener('active'));
    });
    await act(async () => { older.resolve({ submissions: [{ ...receipt(), body: '背景前快照' }] }); });
    expect(view.queryByText('背景前快照')).toBeNull();
    expect(reads).toBe(2);
    await act(async () => { newer.resolve({ submissions: [{ ...receipt(), body: '前景新快照' }] }); });
    expect(view.getByText('前景新快照')).toBeTruthy();
    fireEvent.press(view.getByRole('button', { name: '教材 0' }));
    const before = mockRequest.mock.calls.length;
    await act(async () => { jest.advanceTimersByTime(30000); });
    expect(mockRequest).toHaveBeenCalledTimes(before);
    view.unmount();
  } finally { jest.useRealTimers(); spy.mockRestore(); }
});

it('shares only the stable material entry through the system sheet', async () => {
  const { Share } = require('react-native');
  const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.sharedAction });
  const target = material(1, '合成分享教材');
  mockRequest.mockImplementation((path, context, input) => {
    if (!path.endsWith('/materials/page')) return response(path, context, input);
    return Promise.resolve({ materials: [target], nextCursor: null });
  });
  const view = render(<NuniCourses initialWorkspaceId={courseId} initialMaterialId={target.id} />);
  await view.findByText('目標教材');
  fireEvent.press(view.getByRole('button', { name: '分享教材入口' }));
  expect(share).toHaveBeenCalledWith({ message: expect.stringContaining(`workspaceId=${courseId}&materialId=${target.id}`) });
  expect(share.mock.calls[0][0].message).not.toContain(target.body);
  share.mockRestore();
});

it('從教材卡收藏後可在獨立清單找回，重新驗權並返回原教材', async () => {
  const subscription = jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove: jest.fn() });
  AppState.currentState = 'active';
  mockSession = { ...mockSession, platformAccountId: 'pa_bookmark-flow', context: 'bookmark-flow' };
  const target = material(1, '收藏流程教材');
  mockRequest.mockImplementation((path, context, input) => {
    if (path.endsWith('/materials/page')) return Promise.resolve({ materials: [target], nextCursor: null });
    return response(path, context, input);
  });
  const view = render(<NuniCourses initialWorkspaceId={courseId} initialMaterialId={target.id} />);
  try {
    const save = await view.findByRole('button', { name: '收藏到此裝置：收藏流程教材' });
    await waitFor(() => expect(save).toBeEnabled());
    fireEvent.press(save);
    await view.findByText('已收藏在此裝置。');
    const stored = JSON.parse((await AsyncStorage.getItem(materialBookmarkStorageKey('pa_bookmark-flow')))!);
    expect(stored.items).toEqual([{ courseId, materialId: target.id, savedAt: expect.any(String) }]);
    fireEvent.press(view.getByText('返回我的課程'));
    fireEvent.press(await view.findByRole('button', { name: '此裝置收藏 · 1' }));
    expect(view.queryByLabelText('跨課教材關鍵字')).toBeNull();
    const original = await view.findByRole('button', { name: '回到原教材：收藏流程教材' });
    const before = mockRequest.mock.calls.filter(([path]) => path.endsWith('/materials/page')).length;
    fireEvent.press(original);
    await view.findByLabelText('目標教材：收藏流程教材');
    expect(mockRequest.mock.calls.filter(([path]) => path.endsWith('/materials/page')).length).toBeGreaterThan(before);
    fireEvent.press(view.getByRole('button', { name: '返回此裝置收藏' }));
    await view.findByRole('button', { name: '回到原教材：收藏流程教材' });
  } finally {
    view.unmount();
    subscription.mockRestore();
  }
});

it.each([403, 404])('stops a linked material search and removes course content after %s', async (status) => {
  mockRequest.mockImplementation((path, context, input, _method, query) => {
    if (!path.endsWith('/materials/page')) return response(path, context, input);
    return query
      ? Promise.reject(new NuniError(status, 'ACCESS_DENIED'))
      : Promise.resolve({ materials: [material(1)], nextCursor: 'synthetic_older' });
  });
  const view = render(<NuniCourses initialWorkspaceId={courseId} initialMaterialId="cwm_missing" />);
  await waitFor(() => expect(
    mockRequest.mock.calls.filter(([path]) => path.endsWith('/materials/page')),
  ).toHaveLength(2));
  await waitFor(() => expect(view.queryByText('第 1 份教材')).toBeNull());
  expect(view.queryByText('校園訪談', { includeHiddenElements: true })).toBeNull();
  expect(view.queryByRole('button', { name: '繼續尋找' })).toBeNull();
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
  expect(mockRequest.mock.calls.filter(([path]) => path.endsWith('/materials/page'))).toHaveLength(2);
});

it('合成發布經共用寫入與輪詢後約一分鐘內出現在學生畫面', async () => {
  AppState.currentState = 'active';
  const subscription = jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove: jest.fn() });
  const view = await openCourse();
  jest.useFakeTimers();
  try {
    fireEvent.press(view.getByRole('button', { name: '教材 0' }));
    mockRequest.mockImplementation(async (path, context, input) => {
      if (!path.endsWith('/assignments')) return response(path, context, input);
      await new Promise((resolve) => setTimeout(resolve, input ? 200 : 300));
      if (!input) return { assignments: [assignment] };
      assignment = { ...assignment, title: input.title, instructions: input.instructions };
      return assignment;
    });
    fireEvent.press(view.getByRole('button', { name: '作業 1' }));
    await act(async () => { await jest.advanceTimersByTimeAsync(301); });
    const teacher = createNuniClasses((path, input) => mockRequest(path, 'teacher', input), accountId);
    const started = Date.now();
    const write = teacher.createAssignment(courseId, { title: '跨端新發布作業', instructions: '合成內容',
      dueAt: null, idempotencyKey: 'synthetic-publication' });
    for (let elapsed = 0; elapsed < 61000 && !view.queryByText('跨端新發布作業'); elapsed += 50)
      await act(async () => { await jest.advanceTimersByTimeAsync(50); });
    await write;
    expect(view.getByText('跨端新發布作業')).toBeTruthy();
    expect(Date.now() - started).toBeLessThanOrEqual(61000);
    expect(Date.now() - started).toBe(60300);
  } finally { view.unmount(); jest.useRealTimers(); subscription.mockRestore(); }
});

it('跨課搜尋進教材後返回保留關鍵字與結果並重新驗權', async () => {
  const target = material(1, '返回保留教材');
  mockRequest.mockImplementation((path, context, input) => {
    if (path.endsWith('/materials/page')) return Promise.resolve({ materials: [target], nextCursor: null });
    return response(path, context, input);
  });
  const view = render(<NuniCourses />);
  fireEvent.changeText(view.getByLabelText('跨課教材關鍵字'), '返回保留');
  fireEvent.press(view.getByText('搜尋教材'));
  await view.findByText('返回保留教材');
  fireEvent.press(view.getByText('返回保留教材'));
  await view.findByText('目標教材');
  const reads = mockRequest.mock.calls.filter(([path]) => path.endsWith('/materials/page')).length;
  fireEvent.press(view.getByText('返回我的課程'));
  await waitFor(() => expect(mockRequest.mock.calls.filter(([path]) => path.endsWith('/materials/page')).length).toBeGreaterThan(reads));
  expect(view.getByLabelText('跨課教材關鍵字').props.value).toBe('返回保留');
  expect(view.getByText('返回保留教材')).toBeTruthy();
  expect(view.getByText('目前搜尋：返回保留')).toBeTruthy();
});


it('長搜尋清單返回時等清單尺寸更新才還原保存位置，且一般課程不沿用', async () => {
  const targets = Array.from({ length: 40 }, (_, index) => material(index + 1, `長清單教材 ${index + 1}`));
  mockRequest.mockImplementation((path, context, input) => {
    if (path.endsWith('/materials/page')) return Promise.resolve({ materials: targets, nextCursor: null });
    return response(path, context, input);
  });
  const subscription = jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove: jest.fn() });
  const scroll = jest.spyOn(ScrollView.prototype, 'scrollTo');
  try {
    const view = render(<NuniCourses />);
    fireEvent.changeText(view.getByLabelText('跨課教材關鍵字'), '長清單教材');
    fireEvent.press(view.getByText('搜尋教材'));
    await view.findByText('長清單教材 35');
    fireEvent.scroll(view.getByTestId('nuni-courses-scroll'), {
      nativeEvent: { contentOffset: { y: 2400 } },
    });
    fireEvent.press(view.getByText('長清單教材 35'));
    await view.findByText('目標教材');
    fireEvent(view.getByTestId('nuni-courses-scroll'), 'contentSizeChange', 390, 600);
    scroll.mockClear();
    fireEvent.press(view.getByText('返回我的課程'));
    await view.findByText('長清單教材 35');
    expect(scroll).not.toHaveBeenCalled();
    fireEvent(view.getByTestId('nuni-courses-scroll'), 'contentSizeChange', 390, 3600);
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scroll).toHaveBeenLastCalledWith({ y: 2400, animated: false });
    fireEvent(view.getByTestId('nuni-courses-scroll'), 'contentSizeChange', 390, 3700);
    expect(scroll).toHaveBeenCalledTimes(1);

    fireEvent.press(await view.findByRole('button', { name: '服務設計課程' }));
    await view.findByText('返回我的課程');
    scroll.mockClear();
    fireEvent.press(view.getByText('返回我的課程'));
    await view.findByText('長清單教材 35');
    fireEvent(view.getByTestId('nuni-courses-scroll'), 'contentSizeChange', 390, 3600);
    expect(scroll).not.toHaveBeenCalled();
    view.unmount();
  } finally { scroll.mockRestore(); subscription.mockRestore(); }
});
