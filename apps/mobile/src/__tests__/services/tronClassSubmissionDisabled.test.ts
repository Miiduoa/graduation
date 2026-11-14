/** @jest-environment node */
jest.mock('../../services/cloudFunctions', () => ({
  getCloudFunctionUrl: (name: string) => `https://functions.test/${name}`,
  getFirebaseAuthHeaders: jest.fn(async () => ({})),
}));
jest.mock('../../services/secureStorage', () => ({
  secureGetItem: jest.fn(async () => 'stored-backend-session'),
  secureSetItem: jest.fn(async () => undefined),
  secureDeleteItem: async () => undefined,
  secureDeleteMany: async () => undefined,
}));
jest.mock('../../services/tronClassDataEnabled', () => ({
  isTronClassDataFetchEnabled: jest.fn(() => true),
  TRONCLASS_DATA_DISABLED_MESSAGE: '目前已停用 LMS（TronClass）連線',
}));

import {
  tcPostDiscussion,
  tcPostDiscussionReply,
  tcSubmitHomework,
  tcSubmitPeerReview,
  tcSubmitSurvey,
  type TCWriteResult,
} from '../../services/tronClassClient';
import { getFirebaseAuthHeaders } from '../../services/cloudFunctions';
import { secureGetItem, secureSetItem } from '../../services/secureStorage';
import { isTronClassDataFetchEnabled } from '../../services/tronClassDataEnabled';

const originalFetch = globalThis.fetch;
const mockFetch = jest.fn();
beforeEach(() => {
  jest.clearAllMocks();
  mockFetch.mockReset();
  globalThis.fetch = mockFetch;
  (isTronClassDataFetchEnabled as jest.Mock).mockReturnValue(true);
});

const unavailableWrites: Array<[string, () => Promise<TCWriteResult>]> = [
  ['discussion', () => tcPostDiscussion(101, { title: '測試標題', content: '測試內容' })],
  ['discussion reply', () => tcPostDiscussionReply(101, 303, '測試回覆')],
  ['survey', () => tcSubmitSurvey(101, 404, { question1: '測試答案' })],
  ['peer review', () => tcSubmitPeerReview(101, 505, { scores: { rubric1: '5' }, overallFeedback: '測試評語' })],
];

test.each(unavailableWrites)('legacy %s cannot write, load a backend session, or claim HTTP success', async (_name, write) => {
  mockFetch.mockResolvedValue({ ok: true, json: async () => ({ id: 999, status: 'submitted' }) });

  await expect(write()).resolves.toEqual({
    success: false,
    error: '此學校目前尚未開放此項站內操作，請至 TronClass 完成操作並確認紀錄。',
  });

  expect(mockFetch).not.toHaveBeenCalled();
  expect(secureGetItem).not.toHaveBeenCalled();
  expect(secureSetItem).not.toHaveBeenCalled();
  expect(getFirebaseAuthHeaders).not.toHaveBeenCalled();
});

test.each(unavailableWrites)('disabled reads leave the legacy %s writer inactive', async (_name, write) => {
  (isTronClassDataFetchEnabled as jest.Mock).mockReturnValue(false);

  await expect(write()).resolves.toEqual({
    success: false,
    error: '目前已停用 LMS（TronClass）連線',
  });

  expect(mockFetch).not.toHaveBeenCalled();
  expect(secureGetItem).not.toHaveBeenCalled();
  expect(getFirebaseAuthHeaders).not.toHaveBeenCalled();
});
afterAll(() => { globalThis.fetch = originalFetch; });

test('legacy submission cannot POST partial attachments or report HTTP success as a school receipt', async () => {
  mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
  await expect(tcSubmitHomework(101, 202, {
    content: '測試作業', attachments: [{ uri: 'file:///assignment.pdf', name: 'assignment.pdf', type: 'application/pdf' }],
  })).resolves.toMatchObject({ success: false });
  expect(mockFetch).not.toHaveBeenCalled();
});

test('disabling TronClass reads also leaves the legacy submission path inactive', async () => {
  (isTronClassDataFetchEnabled as jest.Mock).mockReturnValue(false);
  await expect(tcSubmitHomework(101, 202, { content: '測試作業' })).resolves.toEqual({
    success: false, error: '目前已停用 LMS（TronClass）連線',
  });
  expect(mockFetch).not.toHaveBeenCalled();
});
