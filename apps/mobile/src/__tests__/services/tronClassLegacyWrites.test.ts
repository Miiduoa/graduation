/** @jest-environment node */
// 既有行動端在 EXPO_PUBLIC_TRONCLASS_DATA_ENABLED 開啟時，發文、回覆、繳交作業、
// 送問卷、同儕互評的傳輸行為須與 merge-base 一致（直連 session 與後端 session 兩條路）。
jest.mock('../../services/cloudFunctions', () => ({
  getCloudFunctionUrl: (name: string) => `https://functions.test/${name}`,
  getFirebaseAuthHeaders: jest.fn(async () => ({ Authorization: 'Bearer test-id-token' })),
}));
jest.mock('../../services/secureStorage', () => ({
  secureGetItem: jest.fn(async () => null),
  secureSetItem: jest.fn(async () => undefined),
  secureDeleteItem: async () => undefined,
  secureDeleteMany: async () => undefined,
}));
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    removeItem: jest.fn(async () => undefined),
    setItem: jest.fn(async () => undefined),
  },
}));
jest.mock('../../services/tronClassDataEnabled', () => ({
  isTronClassDataFetchEnabled: jest.fn(() => true),
  isTronClassBackendMutation: (dataType: string) => [
    'postDiscussion', 'postDiscussionReply', 'submitHomework', 'submitSurvey', 'submitPeerReview',
  ].includes(dataType),
  tronClassBackendReadWhenDisabled: jest.fn(),
  TRONCLASS_DATA_DISABLED_MESSAGE: '目前已停用 LMS（TronClass）連線',
}));

import {
  setTCBackendSession,
  clearTCSession,
  tcPostDiscussion,
  tcPostDiscussionReply,
  tcSubmitHomework,
  tcSubmitPeerReview,
  tcSubmitSurvey,
  type TCWriteResult,
} from '../../services/tronClassClient';
import { isTronClassDataFetchEnabled } from '../../services/tronClassDataEnabled';

const originalFetch = globalThis.fetch;
const mockFetch = jest.fn();
const TC = 'https://tronclass.pu.edu.tw';

const writes: Array<[string, string, () => Promise<TCWriteResult>, string]> = [
  ['discussion', 'postDiscussion', () => tcPostDiscussion(101, { title: '標題', content: '內容' }), `${TC}/api/courses/101/discussions`],
  ['discussion reply', 'postDiscussionReply', () => tcPostDiscussionReply(101, 303, '回覆'), `${TC}/api/courses/101/discussions/303/posts`],
  ['homework', 'submitHomework', () => tcSubmitHomework(101, 202, { content: '作業' }), `${TC}/api/courses/101/homework/202/submissions`],
  ['survey', 'submitSurvey', () => tcSubmitSurvey(101, 404, { q1: 'a' }), `${TC}/api/courses/101/surveys/404/responses`],
  ['peer review', 'submitPeerReview', () => tcSubmitPeerReview(101, 505, { scores: { r1: '5' } }), `${TC}/api/courses/101/peer_reviews/505/submissions`],
];

beforeEach(async () => {
  jest.clearAllMocks();
  mockFetch.mockReset();
  globalThis.fetch = mockFetch as unknown as typeof fetch;
  (isTronClassDataFetchEnabled as jest.Mock).mockReturnValue(true);
  await clearTCSession().catch(() => undefined);
});
afterAll(() => { globalThis.fetch = originalFetch; });

describe('direct session writers', () => {
  test.each(writes)('%s posts to the TronClass endpoint with cookies', async (_name, _type, write, url) => {
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: 999 }) });
    const result = await write();
    expect(result.success).toBe(true);
    const call = mockFetch.mock.calls.find(([target]) => target === url);
    expect(call).toBeTruthy();
    expect(call?.[1]).toMatchObject({ method: 'POST', credentials: 'include' });
  });

  test('homework uploads attachments before creating the submission', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ key: 'upload-1' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ id: 7 }) });
    const result = await tcSubmitHomework(101, 202, {
      content: '作業', attachments: [{ uri: 'file:///a.pdf', name: 'a.pdf', type: 'application/pdf' }],
    });
    expect(result).toEqual({ success: true, id: 7 });
    expect(mockFetch.mock.calls[0][0]).toBe(`${TC}/api/uploads`);
    expect(JSON.parse(String(mockFetch.mock.calls[1][1].body))).toEqual({ content: '作業', upload_keys: ['upload-1'] });
  });

  test('a rejected submission reports the HTTP status', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 403, json: async () => ({}) });
    await expect(tcSubmitHomework(101, 202, { content: '作業' })).resolves.toEqual({ success: false, error: '送出失敗 (403)' });
  });
});

describe('backend session writers', () => {
  test.each(writes)('%s goes through the TronClass backend proxy', async (_name, dataType, write) => {
    await setTCBackendSession('backend-session', 12);
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ success: true, result: { success: true, id: 55 } }),
    });
    const result = await write();
    expect(result).toMatchObject({ success: true });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toBe('https://functions.test/puFetchTronClassData');
    expect(JSON.parse(String(mockFetch.mock.calls[0][1].body))).toMatchObject({ sessionId: 'backend-session', dataType });
  });
});

describe('connection switch', () => {
  test.each(writes)('disabled reads keep the %s writer inactive', async (_name, _type, write) => {
    (isTronClassDataFetchEnabled as jest.Mock).mockReturnValue(false);
    await expect(write()).resolves.toEqual({ success: false, error: '目前已停用 LMS（TronClass）連線' });
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
