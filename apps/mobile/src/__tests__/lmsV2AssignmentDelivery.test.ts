import AsyncStorage from '@react-native-async-storage/async-storage';
import { getSupabaseClient } from '../services/supabaseClient';
import { isLmsV2Enabled } from '../services/lmsV2FeatureFlag';
import {
  saveAssignmentDeviceDraft,
  readOwnAssignmentDraft,
  deliverAssignmentFinal,
} from '../services/lmsV2AssignmentDelivery';

jest.mock('../services/supabaseClient', () => ({ getSupabaseClient: jest.fn() }));
jest.mock('../services/lmsV2FeatureFlag', () => ({ isLmsV2Enabled: jest.fn(() => true) }));
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() },
}));

const userId = '11111111-1111-4111-8111-111111111111';
const assignmentId = '22222222-2222-4222-8222-222222222222';
const courseId = '33333333-3333-4333-8333-333333333333';
const opts = { courseId, assignmentId, contentText: '設計研究報告' };

function mockClient(settings: { error?: Error; verified?: boolean; graded?: boolean } = {}) {
  const upsert = jest.fn();
  const sb = {
    auth: {
      getUser: jest.fn().mockResolvedValue({ data: { user: { id: userId } }, error: null }),
      getSession: jest.fn().mockResolvedValue({
        data: { session: { user: { id: userId } } }, error: null,
      }),
    },
    from: jest.fn((table: string) => {
      if (table === 'assignments') {
        const q: any = { eq: jest.fn(), maybeSingle: jest.fn() };
        q.eq.mockReturnValue(q);
        q.maybeSingle.mockResolvedValue({
          data: { id: assignmentId, course_id: courseId }, error: null,
        });
        return { select: jest.fn().mockReturnValue(q) };
      }
      if (table === 'submissions') {
        const q: any = { eq: jest.fn(), maybeSingle: jest.fn() };
        q.eq.mockReturnValue(q);
        q.maybeSingle.mockResolvedValue({
          data: settings.graded ? { id: 'previous', graded_at: '2026-10-25T00:00:00Z' } : null,
          error: null,
        });
        const write = {
          select: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: settings.verified === false ? null : {
                id: 'receipt',
                assignment_id: assignmentId,
                student_id: userId,
                body_text: opts.contentText,
                submitted_at: '2026-10-26T16:00:00+08:00',
              },
              error: settings.error ?? null,
            }),
          }),
        };
        upsert.mockReturnValue(write);
        return { select: jest.fn().mockReturnValue(q), upsert };
      }
      throw Error('Unexpected table: ' + table);
    }),
  };
  jest.mocked(getSupabaseClient).mockReturnValue(sb as any);
  return { sb, upsert };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(isLmsV2Enabled).mockReturnValue(true);
  jest.mocked(AsyncStorage.getItem).mockResolvedValue(null);
  jest.mocked(AsyncStorage.setItem).mockResolvedValue(undefined);
  jest.mocked(AsyncStorage.removeItem).mockResolvedValue(undefined);
});

test('draft is device-only, account-scoped and recoverable without writing a false submission', async () => {
  const { sb } = mockClient();
  const result = await saveAssignmentDeviceDraft(opts);
  expect(result.success).toBe(true);
  if (result.success) {
    expect(result.is_draft).toBe(true);
    expect(result.summary).toContain('尚未繳交');
  }
  expect(sb.from).not.toHaveBeenCalled();
  const [key, stored] = jest.mocked(AsyncStorage.setItem).mock.calls[0];
  expect(key).toContain(userId);
  expect(key).toContain(courseId);
  expect(key).toContain(assignmentId);
  jest.mocked(AsyncStorage.getItem).mockResolvedValue(stored);
  const draft = await readOwnAssignmentDraft({ courseId, assignmentId });
  expect(draft?.text).toBe(opts.contentText);
  expect(draft?.savedAt).toEqual(expect.any(String));
});

test('only confirms delivery when the response matches the authenticated student and source assignment', async () => {
  const { upsert } = mockClient();
  const result = await deliverAssignmentFinal(opts);
  expect(result.success).toBe(true);
  expect(upsert).toHaveBeenCalledWith(
    expect.objectContaining({
      assignment_id: assignmentId, student_id: userId, body_text: opts.contentText,
    }),
    { onConflict: 'assignment_id,student_id' },
  );
  const payload = upsert.mock.calls[0][0];
  for (const wrongField of ['user_id', 'content_text', 'status', 'course_id']) {
    expect(payload).not.toHaveProperty(wrongField);
  }
  expect(result.summary).toContain('伺服器已確認');
  expect(jest.mocked(AsyncStorage.removeItem)).toHaveBeenCalledTimes(1);
});

test('server errors, missing receipts, graded submissions and unsupported attachments are not shown as success', async () => {
  mockClient({ error: new Error('connection failed') });
  expect((await deliverAssignmentFinal(opts)).success).toBe(false);
  mockClient({ verified: false });
  expect((await deliverAssignmentFinal(opts)).success).toBe(false);
  mockClient({ graded: true });
  expect((await deliverAssignmentFinal(opts)).success).toBe(false);
  mockClient();
  expect((await deliverAssignmentFinal({ ...opts, attachmentUrls: ['https://example.org/file'] })).success).toBe(false);
  expect((await deliverAssignmentFinal({ ...opts, contentText: ' ' })).success).toBe(false);
  expect(jest.mocked(AsyncStorage.removeItem)).not.toHaveBeenCalled();
});

test('storage failure and account identity changes never claim a saved draft', async () => {
  const { sb } = mockClient();
  jest.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error('storage unavailable'));
  expect((await saveAssignmentDeviceDraft(opts)).success).toBe(false);
  sb.auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
  expect((await saveAssignmentDeviceDraft(opts)).success).toBe(false);
  expect(await readOwnAssignmentDraft({ courseId, assignmentId })).toBeNull();
});
