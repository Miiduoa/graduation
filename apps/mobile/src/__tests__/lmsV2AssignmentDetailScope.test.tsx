import React from 'react';
import { act, cleanupAsync, render } from '@testing-library/react-native/pure';
import CourseAssignmentDetailV2Screen from '../screens/lmsV2/CourseAssignmentDetailV2Screen';

jest.mock('@react-navigation/native', () => ({
  useRoute: () => ({ params: globalThis.__lmsAssignmentRouteParams }),
  useNavigation: () => ({ navigate: jest.fn() }),
}));
jest.mock('../state/auth', () => ({
  useAuth: () => ({ user: { uid: globalThis.__lmsAssignmentUid } }),
}));

const mockDeferred = new Map<string, { resolve: (value: unknown) => void }>();

function mockPending(key: string) {
  let resolve!: (value: unknown) => void;
  const promise = new Promise(r => { resolve = r; });
  mockDeferred.set(key, { resolve });
  return promise;
}

jest.mock('../services/supabaseClient', () => ({
  getSupabaseClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: globalThis.__lmsAssignmentUid } }, error: null }) },
    from: (table: string) => ({
      select: () => ({
        eq: (_field: string, value: string) => ({
          eq: () => ({
            maybeSingle: () => mockPending(`${table}:${value}`),
          }),
          maybeSingle: () => mockPending(`${table}:${value}`),
        }),
      }),
    }),
  }),
}));
jest.mock('../services/lmsV2WriteTools', () => ({
  submitAssignmentDraft: jest.fn(),
  submitAssignmentFinal: jest.fn(),
  readOwnAssignmentDraft: jest.fn(async () => null),
}));

declare global {
  var __lmsAssignmentRouteParams: { courseId: string; assignmentId: string; courseName?: string };
  var __lmsAssignmentUid: string;
}

async function waitForPending(key: string) {
  await act(async () => {
    for (let i = 0; i < 20 && !mockDeferred.has(key); i += 1) {
      await Promise.resolve();
    }
  });
  expect(mockDeferred.has(key)).toBe(true);
}

async function resolveAssignment(id: string, title: string, body: string) {
  await waitForPending(`assignments:${id}`);
  await act(async () => {
    mockDeferred.get(`assignments:${id}`)?.resolve({ data: { id, title, description: '', due_at: null, max_points: 100 }, error: null });
  });
  await waitForPending(`submissions:${id}`);
  await act(async () => {
    mockDeferred.get(`submissions:${id}`)?.resolve({ data: { id: `sub-${id}`, body_text: body, submitted_at: null, grade: null, feedback: null, graded_at: null }, error: null });
  });
}

beforeEach(() => {
  mockDeferred.clear();
  globalThis.__lmsAssignmentUid = 'user-a';
  globalThis.__lmsAssignmentRouteParams = {
    courseId: 'course-a',
    assignmentId: 'assign-a',
    courseName: '資料庫',
  };
});
afterEach(async () => {
  await cleanupAsync();
});

it('replaces the editor from committed data and ignores a slower previous assignment', async () => {
  const view = render(<CourseAssignmentDetailV2Screen />);
  expect(view.getByText('載入中…')).toBeTruthy();
  await waitForPending('assignments:assign-a');
  globalThis.__lmsAssignmentRouteParams = {
    courseId: 'course-a',
    assignmentId: 'assign-b',
    courseName: '資料庫',
  };
  view.rerender(<CourseAssignmentDetailV2Screen />);
  expect(view.getByText('載入中…')).toBeTruthy();
  await waitForPending('assignments:assign-b');
  await resolveAssignment('assign-a', '舊作業', '舊內容不該出現');
  expect(view.queryByDisplayValue('舊內容不該出現')).toBeNull();
  expect(view.getByText('載入中…')).toBeTruthy();
  await resolveAssignment('assign-b', '新作業', '新作業內容');
  expect(view.getByText('新作業')).toBeTruthy();
  expect(view.getByDisplayValue('新作業內容')).toBeTruthy();
  expect(view.queryByDisplayValue('舊內容不該出現')).toBeNull();
});
