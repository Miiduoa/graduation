import { askCampusAssistant } from '../../features/campusAssistant';
import { httpsCallable } from 'firebase/functions';
import type { CampusSenseSnapshot } from '../../services/campusSenseSnapshot';
import type { OnDeviceSchoolContext } from '../../services/onDeviceSchoolContext';

const NOW = Date.parse('2026-10-26T01:00:00.000Z');
let mockUid: string | null = 'A';
let mockSchool = 'pu';
const mockGenerate = jest.fn();
const mockLoad = jest.fn(async () => true);
const mockState = jest.fn(() => ({ status: 'ready', modelId: 'qwen2.5-0.5b' }));
const mockCallable = jest.fn();
let mockContext: OnDeviceSchoolContext;

jest.mock('firebase/functions', () => ({ httpsCallable: jest.fn(() => mockCallable) }));
jest.mock('../../firebase', () => ({
  getAuthInstance: () => ({ currentUser: mockUid ? { uid: mockUid } : null }),
  getFunctionsInstance: () => ({}), isFirebaseMockMode: () => false,
}));
jest.mock('../../services/onDeviceSchoolContext', () => ({
  collectOnDeviceSchoolContext: jest.fn(async () => mockContext),
  formatOnDeviceSchoolPrompt: jest.fn(() => '本機有限資訊'),
}));
jest.mock('../../services/localLLMInference', () => ({
  getDefaultLocalLlmModelId: () => 'qwen2.5-0.5b',
  localLLM: {
    getRuntimeAvailability: () => ({ available: true }),
    getSavedModelId: async () => null,
    isModelDownloaded: async () => true,
    getDownloadedModels: async () => ['qwen2.5-0.5b'],
    getState: () => mockState(), loadModel: () => mockLoad(),
    generate: (options: unknown) => mockGenerate(options),
  },
}));

function snapshot(): CampusSenseSnapshot {
  return {
    userId: 'A', schoolId: 'pu', checkedAt: new Date(NOW).toISOString(),
    schedule: { status: 'unavailable', count: null },
    assignments: { status: 'available', count: 1, items: [
      { title: '真正的資料庫作業', groupName: '資料庫', dueAt: '2026-10-27T09:00:00Z' },
    ] },
    announcements: { status: 'available', items: [{ title: '真正的校園公告', publishedAt: null }] },
  };
}
const request = () => ({
  scope: { uid: 'A', schoolId: 'pu' }, mode: 'device' as const,
  senseSnapshot: snapshot(),
  messages: [{ role: 'user' as const, content: 'What do I have tomorrow, and what remains to hand in?' }],
  isCurrent: () => mockSchool === 'pu',
});
const selected = (calls: unknown[], finishReason = 'stop') => ({
  content: JSON.stringify({ v: 1, calls }), finishReason,
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
  mockUid = 'A'; mockSchool = 'pu';
  mockState.mockReturnValue({ status: 'ready', modelId: 'qwen2.5-0.5b' });
  mockGenerate.mockReset();
  mockContext = {
    schoolId: 'pu', schoolName: '靜宜大學', checkedAt: new Date(NOW).toISOString(),
    timetable: { source: 'saved-device-copy', updatedAt: new Date(NOW).toISOString(), courses: [
      { name: '週二資料庫', day: 2, start: 2, end: 3, room: 'A101' },
      { name: '週二程式設計', day: 2, start: 6, end: 7, room: 'A102' },
    ] },
  };
});
afterEach(() => jest.restoreAllMocks());

test('one local inference selects multiple reads; facts come from real scoped tools', async () => {
  mockGenerate.mockResolvedValueOnce(selected([
    { tool: 'timetable', day: 'tomorrow' }, { tool: 'assignments' },
  ]));
  const result = await askCampusAssistant(request());
  expect(result).toMatchObject({ tool: 'local-agent', source: 'device', hasActions: false });
  expect(result.localReads).toHaveLength(2);
  expect(result.localReads?.[0]).toMatchObject({ label: '明天課表', status: 'available', route: '/timetable' });
  expect(result.content).toContain('週二資料庫');
  expect(result.content).toContain('第 4–5 節');
  expect(result.content).toContain('真正的資料庫作業');
  expect(result.content).not.toContain('"calls"');
  expect(result.proposals).toBeUndefined();
  expect(mockGenerate).toHaveBeenCalledTimes(1);
  expect(mockGenerate).toHaveBeenCalledWith(expect.objectContaining({ temperature: 0, maxTokens: 192 }));
  expect(httpsCallable).not.toHaveBeenCalled();
});

test('a follow-up includes bounded conversation context but no private facts in the selector prompt', async () => {
  mockGenerate.mockResolvedValueOnce(selected([{ tool: 'timetable', day: 'tomorrow' }]));
  const result = await askCampusAssistant({ ...request(), messages: [
    { role: 'user', content: '今天有哪些課？' },
    { role: 'assistant', content: '今天的課表副本沒有排課。' },
    { role: 'user', content: '那隔天呢？' },
  ] });
  expect(result.content).toContain('週二資料庫');
  const prompt = mockGenerate.mock.calls[0][0].messages;
  expect(prompt[1].content).toContain('那隔天呢？');
  expect(prompt[1].content).toContain('今天有哪些課？');
  expect(JSON.stringify(prompt)).not.toContain('真正的資料庫作業');
  expect(httpsCallable).not.toHaveBeenCalled();
});

test.each([
  selected([{ tool: 'assignments', uid: 'someone-else' }]),
  selected([{ tool: 'submitQuizAttempt' }]),
  selected([{ tool: 'announcements' }], 'length'),
  { content: 'Not valid JSON', finishReason: 'stop' },
  selected([]),
])('invalid or unsupported planning makes no tool claims and falls back only to local chat', async (first) => {
  mockGenerate.mockResolvedValueOnce(first).mockResolvedValueOnce({ content: '請補充你要查詢的內容。', finishReason: 'stop' });
  const result = await askCampusAssistant(request());
  expect(result).toEqual({ content: '請補充你要查詢的內容。', source: 'device', hasActions: false });
  expect(mockGenerate).toHaveBeenCalledTimes(2);
  expect(httpsCallable).not.toHaveBeenCalled();
});

test('a long selection does not extend the snapshot TTL or expose expired homework', async () => {
  mockGenerate.mockImplementationOnce(async () => {
    jest.mocked(Date.now).mockReturnValue(NOW + 16 * 60_000);
    return selected([{ tool: 'assignments' }]);
  });
  const result = await askCampusAssistant(request());
  expect(result.localReads?.[0].status).toBe('unavailable');
  expect(result.content).not.toContain('真正的資料庫作業');
  expect(result.content).toContain('需要正式資料來源');
  expect(httpsCallable).not.toHaveBeenCalled();
});

test.each(['account', 'school', 'cancel'])('discards model-selected reads after %s changes', async (change) => {
  const controller = new AbortController();
  mockGenerate.mockImplementationOnce(async () => {
    if (change === 'account') mockUid = 'B';
    if (change === 'school') mockSchool = 'other';
    if (change === 'cancel') controller.abort();
    return selected([{ tool: 'assignments' }]);
  });
  await expect(askCampusAssistant({ ...request(), signal: controller.signal })).rejects.toMatchObject({
    code: change === 'cancel' ? 'cancelled' : 'session-changed',
  });
  expect(mockGenerate).toHaveBeenCalledTimes(1);
  expect(mockGenerate.mock.calls[0][0].signal).toBe(controller.signal);
  expect(httpsCallable).not.toHaveBeenCalled();
});

test('a foreign snapshot never supplies data to a model-selected read', async () => {
  mockGenerate.mockResolvedValueOnce(selected([{ tool: 'assignments' }]));
  const result = await askCampusAssistant({ ...request(), senseSnapshot: { ...snapshot(), userId: 'B' } });
  expect(result.content).not.toContain('真正的資料庫作業');
  expect(result.localReads?.[0].status).toBe('unavailable');
});

test('known direct questions retain the no-model fast path', async () => {
  const result = await askCampusAssistant({ ...request(), messages: [{ role: 'user', content: '明天有哪些課？' }] });
  expect(result.tool).toBe('saved-timetable');
  expect(result.content).toContain('週二資料庫');
  expect(mockGenerate).not.toHaveBeenCalled();
});

test('no local evidence means no extra selection inference', async () => {
  mockContext = { ...mockContext, timetable: { source: 'not-available', updatedAt: null, courses: [] } };
  mockGenerate.mockResolvedValueOnce({ content: '本機沒有可核對的個人資料。', finishReason: 'stop' });
  const result = await askCampusAssistant({ ...request(), senseSnapshot: null });
  expect(result.localReads).toBeUndefined();
  expect(mockGenerate).toHaveBeenCalledTimes(1);
});

test('does not reload or steal another screen\'s model after selection', async () => {
  mockGenerate.mockImplementationOnce(async () => {
    mockState.mockReturnValue({ status: 'generating', modelId: 'qwen2.5-3b' });
    return selected([]);
  });
  await expect(askCampusAssistant(request())).rejects.toMatchObject({ code: 'model-busy' });
  expect(mockLoad).not.toHaveBeenCalled();
  expect(mockGenerate).toHaveBeenCalledTimes(1);
});
