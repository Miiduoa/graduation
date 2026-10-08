import { submitGeneralFeedback, type GeneralFeedbackInput } from '../../services/generalFeedback';
const mockCallable = jest.fn();
let mockUid: string | null = 'u1';
let mockMode = false;
jest.mock('firebase/functions', () => ({ httpsCallable: jest.fn(() => mockCallable) }));
jest.mock('../../firebase', () => ({
  getAuthInstance: () => ({ currentUser: mockUid ? { uid: mockUid } : null }),
  getFunctionsInstance: () => ({}),
  isFirebaseMockMode: () => mockMode,
}));
const input: GeneralFeedbackInput = {
  requestId: 'r1',
  schoolId: 's1',
  kind: 'general',
  feedbackType: 'bug',
  title: '無法讀取課表',
  description: '登入之後仍無法讀取',
  contactEmail: null,
  rating: 0,
};
beforeEach(() => {
  jest.clearAllMocks();
  mockUid = 'u1';
  mockMode = false;
});
test('forwards the controlled general feedback payload and returns its server receipt', async () => {
  const receipt = { ok: true, feedbackId: 'f1', reused: true };
  mockCallable.mockResolvedValue({ data: receipt });
  await expect(submitGeneralFeedback(input, 'u1', () => true)).resolves.toEqual(receipt);
  expect(mockCallable).toHaveBeenCalledWith(input);
});
test.each([{}, { ok: false }, { ok: true, feedbackId: '' }])(
  'rejects unconfirmed receipt %s',
  async (data) => {
    mockCallable.mockResolvedValue({ data });
    await expect(submitGeneralFeedback(input, 'u1', () => true)).rejects.toThrow('not confirmed');
  },
);
test('failed delivery rejects instead of queueing or returning a fake success', async () => {
  mockCallable.mockRejectedValue(new Error('permission-denied'));
  await expect(submitGeneralFeedback(input, 'u1', () => true)).rejects.toThrow('permission-denied');
});
test('does not send under a changed SDK account or in mock mode', async () => {
  mockUid = 'u2';
  await expect(submitGeneralFeedback(input, 'u1', () => true)).rejects.toThrow('account changed');
  mockUid = 'u1';
  mockMode = true;
  await expect(submitGeneralFeedback(input, 'u1', () => true)).rejects.toThrow();
  expect(mockCallable).not.toHaveBeenCalled();
});
test('ignores a receipt arriving after a school or account change', async () => {
  let active = true;
  mockCallable.mockImplementation(async () => {
    active = false;
    return { data: { ok: true, feedbackId: 'old' } };
  });
  await expect(submitGeneralFeedback(input, 'u1', () => active)).rejects.toThrow('account changed');
});
