import { httpsCallable } from 'firebase/functions';
import { askCampusAssistant } from '../../features/campusAssistant';
let mockUid: string | null = 'A';
let mockFake = false;
const mockCallable = jest.fn();
jest.mock('firebase/functions', () => ({ httpsCallable: jest.fn(() => mockCallable) }));
jest.mock('../../firebase', () => ({
  getAuthInstance: () => ({ currentUser: mockUid ? { uid: mockUid } : null }),
  getFunctionsInstance: () => ({}),
  isFirebaseMockMode: () => mockFake,
}));
const input = () => ({
  scope: { uid: 'A', schoolId: 'pu' },
  messages: [{ role: 'user' as const, content: ' 查公告 ' }],
  isCurrent: () => true,
});
beforeEach(() => {
  jest.clearAllMocks();
  mockUid = 'A';
  mockFake = false;
  mockCallable.mockResolvedValue({
    data: { content: ' 有新公告 ', run: { status: 'completed' }, actions: [] },
  });
});
test('uses the verified callable contract and returns only display content and proposal presence', async () => {
  mockCallable.mockResolvedValue({
    data: { content: ' 草稿 ', run: { status: 'blocked' }, actions: [{ tool: 'write' }] },
  });
  await expect(askCampusAssistant(input())).resolves.toEqual({ content: '草稿', hasActions: true });
  expect(httpsCallable).toHaveBeenCalledTimes(1);
  expect(httpsCallable).toHaveBeenCalledWith({}, 'askCampusAssistant');
  expect(mockCallable).toHaveBeenCalledWith({
    messages: [{ role: 'user', content: '查公告' }],
    context: {
      schoolId: 'pu',
      screen: 'campus-assistant',
      locale: 'zh-TW',
      timezone: 'Asia/Taipei',
    },
  });
});
test.each([
  {},
  { content: 'fallback', run: { status: 'failed' } },
  { content: ' ', run: { status: 'completed' } },
  { content: 7, run: { status: 'completed' } },
  { content: 'error', error: 'oops', run: { status: 'completed' } },
])('rejects malformed or failed response %p', async (data) => {
  mockCallable.mockResolvedValue({ data });
  await expect(askCampusAssistant(input())).rejects.toThrow();
});
test.each(['uid', 'fake', 'scope'])('does not call the server for invalid %s', async (kind) => {
  const args = input();
  if (kind === 'uid') mockUid = 'B';
  if (kind === 'fake') mockFake = true;
  if (kind === 'scope') args.isCurrent = () => false;
  await expect(askCampusAssistant(args)).rejects.toThrow();
  expect(mockCallable).not.toHaveBeenCalled();
});
test.each(['uid', 'scope'])('rejects a completed result after %s changes', async (kind) => {
  let current = true;
  let resolve!: (value: unknown) => void;
  mockCallable.mockReturnValue(
    new Promise((yes) => {
      resolve = yes;
    }),
  );
  const pending = askCampusAssistant({ ...input(), isCurrent: () => current });
  if (kind === 'uid') mockUid = 'B';
  else current = false;
  resolve({ data: { content: 'A私訊', run: { status: 'completed' } } });
  await expect(pending).rejects.toThrow('session changed');
});
