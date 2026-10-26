import { httpsCallable } from 'firebase/functions';
import {
  askCampusAssistant,
  getOnDeviceAssistantReadiness,
} from '../../features/campusAssistant';
let mockUid: string | null = 'A';
let mockFake = false;
const mockCallable = jest.fn();
jest.mock('firebase/functions', () => ({ httpsCallable: jest.fn(() => mockCallable) }));
jest.mock('../../firebase', () => ({
  getAuthInstance: () => ({ currentUser: mockUid ? { uid: mockUid } : null }),
  getFunctionsInstance: () => ({}),
  isFirebaseMockMode: () => mockFake,
}));
jest.mock('../../services/localLLMInference', () => ({
  localLLM: {
    getRuntimeAvailability: jest.fn(() => ({ available: true })),
    getSavedModelId: jest.fn(async () => null),
    isModelDownloaded: jest.fn(async () => true),
    getDownloadedModels: jest.fn(async () => ['qwen2.5-0.5b']),
    getState: jest.fn(() => ({ status: 'ready', modelId: 'qwen2.5-0.5b' })),
    loadModel: jest.fn(async () => true),
    generate: jest.fn(async () => ({ content: ' 已依照本機資訊整理建議 ', tokensGenerated: 15 })),
  },
  getDefaultLocalLlmModelId: () => 'qwen2.5-0.5b',
}));
jest.mock('../../services/onDeviceSchoolContext', () => ({
  collectOnDeviceSchoolContext: jest.fn(async ({ schoolId }: { schoolId: string }) => ({
    checkedAt: '2026-10-26T12:00:00Z',
    schoolId, schoolName: '靜宜大學',
    timetable: { source: 'not-available', updatedAt: null, courses: [] },
  })),
  formatOnDeviceSchoolPrompt: jest.fn(() => '裝置端有限制的系統上下文'),
}));
const { localLLM } = require('../../services/localLLMInference');

const input = () => ({
  scope: { uid: 'A', schoolId: 'pu' },
  messages: [{ role: 'user' as const, content: ' 查公告 ' }],
  isCurrent: () => true,
  mode: 'campus' as const,
});
beforeEach(() => {
  jest.clearAllMocks();
  mockUid = 'A';
  mockFake = false;
  jest.mocked(localLLM.getRuntimeAvailability).mockReturnValue({ available: true });
  jest.mocked(localLLM.getState).mockReturnValue({ status: 'ready', modelId: 'qwen2.5-0.5b' });
  jest.mocked(localLLM.getSavedModelId).mockResolvedValue(null);
  jest.mocked(localLLM.isModelDownloaded).mockResolvedValue(true);
  jest.mocked(localLLM.getDownloadedModels).mockResolvedValue(['qwen2.5-0.5b']);
  jest.mocked(localLLM.loadModel).mockResolvedValue(true);
  jest.mocked(localLLM.generate).mockResolvedValue({ content: '已依照本機資訊整理建議', tokensGenerated: 15 });
  mockCallable.mockResolvedValue({
    data: { content: ' 有新公告 ', run: { status: 'completed' }, actions: [] },
  });
});
test('uses the verified callable contract and returns only display content and proposal presence', async () => {
  mockCallable.mockResolvedValue({
    data: { content: ' 草稿 ', run: { status: 'blocked' }, actions: [{ tool: 'write' }] },
  });
  await expect(askCampusAssistant(input())).resolves.toEqual({ content: '草稿', hasActions: true, source: 'campus' });
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
test('forwards selected school name without treating browsing as authorization', async () => {
  await askCampusAssistant({ ...input(), schoolName: '靜宜大學' });
  expect(mockCallable).toHaveBeenCalledWith({
    messages: [{ role: 'user', content: '查公告' }],
    context: {
      schoolId: 'pu',
      schoolName: '靜宜大學',
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

test('uses local GGUF by default without calling Firebase Functions or downloading anything', async () => {
  const result = await askCampusAssistant({
    ...input(), mode: undefined, schoolName: '靜宜大學',
    messages: [{ role: 'user', content: '幫我整理我的閱讀計畫' }],
  });
  expect(result).toEqual({
    content: '已依照本機資訊整理建議', hasActions: false, source: 'device',
  });
  expect(localLLM.generate).toHaveBeenCalledWith(expect.objectContaining({
    messages: [
      { role: 'system', content: '裝置端有限制的系統上下文' },
      { role: 'user', content: '幫我整理我的閱讀計畫' },
    ],
  }));
  expect(localLLM.loadModel).not.toHaveBeenCalled();
  expect(mockCallable).not.toHaveBeenCalled();
  expect(httpsCallable).not.toHaveBeenCalled();
});

test('explicitly requires a downloaded model instead of silently falling back to cloud', async () => {
  jest.mocked(localLLM.isModelDownloaded).mockResolvedValue(false);
  jest.mocked(localLLM.getDownloadedModels).mockResolvedValue([]);
  await expect(askCampusAssistant({ ...input(), mode: 'device', messages: [{ role: 'user', content: '幫我規劃閱讀進度' }] })).rejects.toMatchObject({
    code: 'model-required',
  });
  expect(localLLM.generate).not.toHaveBeenCalled();
  expect(mockCallable).not.toHaveBeenCalled();
});

test('does not claim local AI availability when its native module is missing', async () => {
  jest.mocked(localLLM.getRuntimeAvailability).mockReturnValue({
    available: false, reason: '原生模組尚未安裝',
  });
  await expect(getOnDeviceAssistantReadiness()).resolves.toMatchObject({
    ready: false, available: false, reason: '原生模組尚未安裝',
  });
  await expect(askCampusAssistant({ ...input(), mode: 'device', messages: [{ role: 'user', content: '幫我規劃閱讀進度' }] })).rejects.toMatchObject({
    code: 'native-unavailable',
  });
  expect(mockCallable).not.toHaveBeenCalled();
});

test('rejects late on-device generation when user switches account', async () => {
  let resolve!: (value: unknown) => void;
  jest.mocked(localLLM.generate).mockReturnValue(new Promise((yes) => { resolve = yes; }));
  const pending = askCampusAssistant({ ...input(), mode: 'device', messages: [{ role: 'user', content: '幫我規劃閱讀進度' }] });
  for (let attempt = 0; attempt < 12 && jest.mocked(localLLM.generate).mock.calls.length === 0; attempt += 1) {
    await Promise.resolve();
  }
  expect(localLLM.generate).toHaveBeenCalledTimes(1);
  mockUid = 'B';
  resolve({ content: '前一帳號的課表', tokensGenerated: 15 });
  await expect(pending).rejects.toMatchObject({ code: 'session-changed' });
  expect(mockCallable).not.toHaveBeenCalled();
});

test('does not expose an unverified local cache when the app uses mock authentication', async () => {
  const { collectOnDeviceSchoolContext } = require('../../services/onDeviceSchoolContext');
  mockFake = true;
  await askCampusAssistant({ ...input(), mode: 'device', messages: [{ role: 'user', content: '幫我規劃閱讀進度' }] });
  expect(collectOnDeviceSchoolContext).toHaveBeenCalledWith(expect.objectContaining({ uid: '' }));
  expect(mockCallable).not.toHaveBeenCalled();
});

test('bounds context sent to the 0.5B on-device model without touching cloud services', async () => {
  const longMessages = Array.from({ length: 9 }, (_, index) => ({
    role: (index % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
    content: '期末報告'.repeat(700),
  }));
  await askCampusAssistant({
    ...input(), mode: 'device', messages: longMessages,
  });
  const options = jest.mocked(localLLM.generate).mock.calls[0][0];
  expect(options.messages).toHaveLength(4);
  expect(options.messages.slice(1).every((message: { content: string }) => message.content.length <= 160)).toBe(true);
  expect(mockCallable).not.toHaveBeenCalled();
});
