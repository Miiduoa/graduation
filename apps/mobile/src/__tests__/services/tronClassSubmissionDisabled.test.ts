/** @jest-environment node */
jest.mock('../../services/cloudFunctions', () => ({
  getCloudFunctionUrl: (name: string) => `https://functions.test/${name}`,
  getFirebaseAuthHeaders: async () => ({}),
}));
jest.mock('../../services/secureStorage', () => ({
  secureGetItem: async () => null,
  secureSetItem: async () => undefined,
  secureDeleteItem: async () => undefined,
  secureDeleteMany: async () => undefined,
}));
jest.mock('../../services/tronClassDataEnabled', () => ({
  isTronClassDataFetchEnabled: jest.fn(() => true),
  TRONCLASS_DATA_DISABLED_MESSAGE: '目前已停用 LMS（TronClass）連線',
}));

import { tcSubmitHomework } from '../../services/tronClassClient';
import { isTronClassDataFetchEnabled } from '../../services/tronClassDataEnabled';

const originalFetch = globalThis.fetch;
const mockFetch = jest.fn();
beforeEach(() => {
  mockFetch.mockReset();
  globalThis.fetch = mockFetch;
  (isTronClassDataFetchEnabled as jest.Mock).mockReturnValue(true);
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
