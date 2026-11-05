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
    checkedAt: new Date().toISOString(),
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

test('an offline campus data question resolves without an LLM or Firebase callable', async () => {
  const answer = await askCampusAssistant({
    ...input(),
    mode: 'device',
    messages: [{ role: 'user', content: '查最新校園公告' }],
  });
  expect(answer).toMatchObject({
    source: 'device', tool: 'online-required', route: '/announcements',
    hasActions: false,
  });
  expect(answer.content).toContain('需要正式資料來源');
  expect(localLLM.generate).not.toHaveBeenCalled();
  expect(localLLM.loadModel).not.toHaveBeenCalled();
  expect(httpsCallable).not.toHaveBeenCalled();
});

test('offline timetable read works without downloading a GGUF and never invokes a cloud model', async () => {
  const { collectOnDeviceSchoolContext } = require('../../services/onDeviceSchoolContext');
  jest.mocked(collectOnDeviceSchoolContext).mockResolvedValueOnce({
    checkedAt: '2026-10-26T01:00:00Z',
    schoolId: 'pu',
    schoolName: '靜宜大學',
    timetable: { source: 'saved-device-copy', updatedAt: '2026-10-25T10:00:00Z',
      courses: [{ name: '資料庫', day: 1, start: 2, end: 3 }] },
  });
  jest.mocked(localLLM.isModelDownloaded).mockResolvedValue(false);
  jest.mocked(localLLM.getDownloadedModels).mockResolvedValue([]);
  const result = await askCampusAssistant({
    ...input(), mode: 'device',
    messages: [{ role: 'user', content: '今天有哪些課' }],
  });
  expect(result).toMatchObject({ source: 'device', tool: 'saved-timetable', route: '/timetable' });
  expect(result.content).toContain('資料庫');
  expect(localLLM.generate).not.toHaveBeenCalled();
  expect(httpsCallable).not.toHaveBeenCalled();
});


test.each(['generating', 'loading', 'downloading'])(
  'does not reload a shared native LLM context while %s',
  async (status) => {
    jest.mocked(localLLM.getState).mockReturnValue({ status, modelId: 'qwen2.5-0.5b' });
    await expect(askCampusAssistant({
      ...input(), mode: 'device',
      messages: [{ role: 'user', content: '幫我規劃複習進度' }],
    })).rejects.toMatchObject({ code: 'model-busy' });
    expect(localLLM.loadModel).not.toHaveBeenCalled();
    expect(localLLM.generate).not.toHaveBeenCalled();
    expect(mockCallable).not.toHaveBeenCalled();
  },
);

test('offline agent uses an explicitly synced authorized summary without cloud inference', async () => {
  const senseSnapshot = {
    userId: 'A',
    schoolId: 'pu',
    checkedAt: new Date().toISOString(),
    schedule: { status: 'unavailable' as const, count: null },
    assignments: {
      status: 'available' as const, count: 1,
      items: [{ title: '程式設計練習', groupName: '程式設計', dueAt: null }],
    },
    announcements: { status: 'available' as const, items: [] },
  };
  const result = await askCampusAssistant({
    ...input(), mode: 'device',
    messages: [{ role: 'user', content: '我有哪些作業還沒交？' }],
    senseSnapshot,
  });
  expect(result).toMatchObject({ source: 'device', tool: 'campus-snapshot', route: '/classroom' });
  expect(result.content).toContain('程式設計練習');
  expect(localLLM.generate).not.toHaveBeenCalled();
  expect(mockCallable).not.toHaveBeenCalled();
  expect(httpsCallable).not.toHaveBeenCalled();
});

test('a snapshot for another user is never used even if the school is the same', async () => {
  const result = await askCampusAssistant({
    ...input(), mode: 'device',
    messages: [{ role: 'user', content: '我有哪些作業還沒交？' }],
    senseSnapshot: {
      userId: 'another-user',
      schoolId: 'pu',
      checkedAt: new Date().toISOString(),
      schedule: { status: 'unavailable', count: null },
      assignments: {
        status: 'available', count: 1,
        items: [{ title: '別人的秘密', groupName: '其他班級', dueAt: null }],
      },
      announcements: { status: 'available', items: [] },
    },
  });
  expect(result.tool).toBe('online-required');
  expect(result.content).not.toContain('別人的秘密');
  expect(localLLM.generate).not.toHaveBeenCalled();
});

test('passes a request-scoped cancellation signal and rejects a stale local completion', async () => {
  const controller = new AbortController();
  let resolve!: (value: unknown) => void;
  jest.mocked(localLLM.generate).mockReturnValue(
    new Promise((yes) => { resolve = yes; }) as never,
  );
  const pending = askCampusAssistant({
    ...input(), mode: 'device', signal: controller.signal,
    messages: [{ role: 'user', content: '安排讀書計畫' }],
  });
  for (let attempt = 0; attempt < 20 && jest.mocked(localLLM.generate).mock.calls.length === 0; attempt += 1) {
    await Promise.resolve();
  }
  expect(localLLM.generate).toHaveBeenCalledTimes(1);
  expect(jest.mocked(localLLM.generate).mock.calls[0][0].signal).toBe(controller.signal);
  controller.abort();
  resolve({ content: '取消後不應顯示的私人資訊', tokensGenerated: 12 });
  await expect(pending).rejects.toMatchObject({ code: 'cancelled' });
  expect(mockCallable).not.toHaveBeenCalled();
});

test('a native stop rejection still produces a clear cancelled outcome', async () => {
  const controller = new AbortController();
  let reject!: (reason: unknown) => void;
  jest.mocked(localLLM.generate).mockReturnValue(
    new Promise((_, no) => { reject = no; }) as never,
  );
  const pending = askCampusAssistant({
    ...input(), mode: 'device', signal: controller.signal,
    messages: [{ role: 'user', content: '整理我的課程進度' }],
  });
  for (let attempt = 0; attempt < 20 && jest.mocked(localLLM.generate).mock.calls.length === 0; attempt += 1) {
    await Promise.resolve();
  }
  expect(localLLM.generate).toHaveBeenCalledTimes(1);
  controller.abort();
  reject(new Error('native completion interrupted'));
  await expect(pending).rejects.toMatchObject({ code: 'cancelled' });
  expect(mockCallable).not.toHaveBeenCalled();
});

test('already cancelled requests never read private local context or start an LLM', async () => {
  const controller = new AbortController();
  controller.abort();
  const { collectOnDeviceSchoolContext } = require('../../services/onDeviceSchoolContext');
  await expect(askCampusAssistant({
    ...input(), mode: 'device', signal: controller.signal,
    messages: [{ role: 'user', content: '請幫我安排下週讀書計畫' }],
  })).rejects.toMatchObject({ code: 'cancelled' });
  expect(collectOnDeviceSchoolContext).not.toHaveBeenCalled();
  expect(localLLM.generate).not.toHaveBeenCalled();
  expect(mockCallable).not.toHaveBeenCalled();
});

test('verified multi-step study plan runs on the phone without GGUF or cloud calls', async () => {
  const { collectOnDeviceSchoolContext } = require('../../services/onDeviceSchoolContext');
  const checkedAt = new Date().toISOString();
  jest.mocked(collectOnDeviceSchoolContext).mockResolvedValueOnce({
    checkedAt,
    schoolId: 'pu', schoolName: '靜宜大學',
    timetable: {
      source: 'saved-device-copy',
      updatedAt: checkedAt,
      courses: [
        { name: '資料庫', day: 1, start: 2, end: 3 },
        { name: '網路概論', day: 1, start: 6, end: 7 },
      ],
    },
  });
  jest.mocked(localLLM.isModelDownloaded).mockResolvedValue(false);
  jest.mocked(localLLM.getDownloadedModels).mockResolvedValue([]);
  const snapshot = {
    userId: 'A', schoolId: 'pu', checkedAt,
    schedule: { status: 'unavailable' as const, count: null },
    assignments: {
      status: 'available' as const, count: 1,
      items: [{ title: '程式設計期末報告', groupName: '程式設計', dueAt: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString() }],
    },
    announcements: { status: 'unavailable' as const, items: [] },
  };
  const result = await askCampusAssistant({
    ...input(),
    mode: 'device',
    messages: [{ role: 'user', content: '今天要先處理什麼？' }],
    senseSnapshot: snapshot,
  });
  expect(result).toMatchObject({
    source: 'device', tool: 'campus-plan',
    hasActions: false,
    plan: { steps: expect.arrayContaining([
      expect.objectContaining({
        title: '程式設計期末報告', priority: 'urgent',
        route: '/classroom', evidence: 'authorized-assignments',
      }),
    ]) },
  });
  expect(result.content).toContain('程式設計期末報告');
  expect(localLLM.generate).not.toHaveBeenCalled();
  expect(localLLM.loadModel).not.toHaveBeenCalled();
  expect(mockCallable).not.toHaveBeenCalled();
  expect(httpsCallable).not.toHaveBeenCalled();
});

test('offline plan never uses an expired snapshot belonging to another account', async () => {
  const { collectOnDeviceSchoolContext } = require('../../services/onDeviceSchoolContext');
  const checkedAt = new Date().toISOString();
  jest.mocked(collectOnDeviceSchoolContext).mockResolvedValueOnce({
    checkedAt, schoolId: 'pu', schoolName: '靜宜大學',
    timetable: {
      source: 'saved-device-copy', updatedAt: checkedAt,
      courses: [{ name: '本人的資料庫課程', day: 1, start: 1, end: 2 }],
    },
  });
  const result = await askCampusAssistant({
    ...input(), mode: 'device',
    messages: [{ role: 'user', content: '安排本週的課表與作業' }],
    senseSnapshot: {
      userId: 'other-person', schoolId: 'pu',
      checkedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      schedule: { status: 'unavailable', count: null },
      assignments: {
        status: 'available', count: 1,
        items: [{ title: '別人的私人作業', groupName: '私人課程', dueAt: null }],
      },
      announcements: { status: 'available', items: [] },
    },
  });
  expect(result.tool).toBe('campus-plan');
  expect(result.content).not.toContain('別人的私人作業');
  expect(result.plan?.steps.every((step: { evidence: string }) =>
    step.evidence !== 'authorized-assignments')).toBe(true);
  expect(mockCallable).not.toHaveBeenCalled();
});

test('a deadline-to-receipt follow-up does not send assignment rows to the local model', async () => {
  jest.useFakeTimers({ now: new Date('2026-11-04T09:00:00Z') });
  try {
    jest.mocked(localLLM.getRuntimeAvailability).mockReturnValue({ available: false });
    const items = [
      { groupName: '資料庫管理', title: '期中報告', dueAt: '2026-11-10T05:30:00Z',
        source: { kind: 'group-assignment' as const, groupId: 'management', assignmentId: 'midterm' } },
    ];
    const senseSnapshot = { userId: 'A', schoolId: 'pu', checkedAt: new Date().toISOString(),
      assignments: { status: 'available' as const, count: items.length, items },
      announcements: { status: 'available' as const, items: [] }, schedule: { status: 'unavailable' as const, count: null } };
    const first = await askCampusAssistant({
      ...input(), mode: 'device', senseSnapshot,
      messages: [{ role: 'user', content: '資料庫的期中報告什麼時候交？' }],
    });
    const follow = await askCampusAssistant({
      ...input(), mode: 'device', senseSnapshot,
      messages: [
        { role: 'user', content: '資料庫的期中報告什麼時候交？' },
        { role: 'assistant', content: first.content, assignmentRead: first.assignmentRead },
        { role: 'user', content: '那已交的呢？' },
      ],
    });
    expect(follow).toMatchObject({ source: 'device', tool: 'online-required', route: '/classroom' });
    expect(follow.content).toContain('只列待交項目');
    expect(follow.assignmentRead).toBeUndefined();
    expect(localLLM.generate).not.toHaveBeenCalled();
    expect(httpsCallable).not.toHaveBeenCalled();
  } finally {
    jest.useRealTimers();
  }
});

test('narrows local deadlines across turns, selects the displayed row and prepares a reminder without a model', async () => {
  jest.useFakeTimers({ now: new Date('2026-11-04T09:00:00Z') });
  try {
    jest.mocked(localLLM.getRuntimeAvailability).mockReturnValue({ available: false });
    const source = (groupId: string) => ({ kind: 'group-assignment' as const, groupId, assignmentId: 'midterm' });
    const items = [
      { groupName: '資料庫管理', title: '期中報告', dueAt: '2026-11-10T05:30:00Z', source: source('management') },
      { groupName: '資料庫設計', title: '期中報告', dueAt: '2026-11-09T04:00:00Z', source: source('design') },
      { groupName: '工程倫理', title: '期中報告', dueAt: '2026-11-09T04:00:00Z', source: source('ethics') },
    ];
    const senseSnapshot = { userId: 'A', schoolId: 'pu', checkedAt: new Date().toISOString(),
      assignments: { status: 'available' as const, count: items.length, items },
      announcements: { status: 'available' as const, items: [] }, schedule: { status: 'unavailable' as const, count: null } };
    const messages: import('../../features/campusAssistant').CampusAssistantMessage[] = [];
    async function ask(content: string) {
      messages.push({ role: 'user', content });
      const result = await askCampusAssistant({ ...input(), mode: 'device', messages, senseSnapshot });
      messages.push({ role: 'assistant', content: result.content, assignmentRead: result.assignmentRead });
      return result;
    }
    const original = await ask('資料庫的期中報告什麼時候交？');
    expect(original.assignmentRead?.items).toEqual([items[1], items[0]]);
    expect((await ask('那明天呢？')).assignmentRead?.items).toEqual([]);
    const ambiguous = await ask('資料庫的期中報告從今天到明天截止嗎？');
    expect(ambiguous.content).toContain('想查哪一天');
    const nextWeek = await ask('那下週呢？');
    expect(nextWeek.assignmentRead?.items).toEqual([items[1], items[0]]);
    expect((await ask('幫我設提醒')).content).toContain('哪一份');
    const second = await ask('第二個');
    expect(second.assignmentRead).toMatchObject({ reviewReminder: true, items: [items[0]] });
    expect(second.content).toContain('13:30');
    expect(second.content).not.toContain('資料庫設計');
    // Replacing or clearing the source invalidates even an immediate selection.
    const refreshed = await askCampusAssistant({ ...input(), mode: 'device',
      messages: [...messages, { role: 'user', content: '第一筆' }],
      senseSnapshot: { ...senseSnapshot, checkedAt: new Date(Date.now() - 1000).toISOString() } });
    expect(refreshed.content).toContain('重新同步');
    expect(refreshed.assignmentRead).toBeUndefined();
    expect(localLLM.generate).not.toHaveBeenCalled();
    expect(httpsCallable).not.toHaveBeenCalled();
  } finally {
    jest.useRealTimers();
  }
});

test('pages through the same filtered deadlines across Taipei midnight without loading a model', async () => {
  const beforeMidnight = new Date('2026-11-04T15:59:30Z');
  jest.useFakeTimers({ now: beforeMidnight });
  try {
    jest.mocked(localLLM.getRuntimeAvailability).mockReturnValue({ available: false });
    const tasks = Array.from({ length: 17 }, (_, index) => ({
      title: '練習 ' + (index + 1), groupName: '資料庫管理',
      dueAt: new Date(Date.parse('2026-11-05T09:00:00Z') + index * 60_000).toISOString(),
      source: { kind: 'group-assignment' as const, groupId: 'db', assignmentId: String(index + 1) },
    }));
    const loaded = [...tasks, { ...tasks[0], groupName: '經濟學' },
      { ...tasks[0], title: '下個月截止', dueAt: '2026-12-01T00:00:00Z' }];
    const snapshot = { userId: 'A', schoolId: 'pu', checkedAt: beforeMidnight.toISOString(),
      assignments: { status: 'available' as const, count: loaded.length + 3, items: loaded },
      announcements: { status: 'available' as const, items: [] }, schedule: { status: 'unavailable' as const, count: null } };
    const messages: import('../../features/campusAssistant').CampusAssistantMessage[] = [];
    async function ask(content: string) {
      messages.push({ role: 'user', content });
      const result = await askCampusAssistant({ ...input(), mode: 'device', messages, senseSnapshot: snapshot });
      messages.push({ role: 'assistant', content: result.content, assignmentRead: result.assignmentRead });
      return result;
    }
    const first = await ask('明天資料庫管理的作業有哪些？');
    expect(first.assignmentRead?.items).toEqual(tasks.slice(0, 8));
    expect(first.assignmentRead?.page?.total).toBe(17);
    expect(first.content).toContain('3 筆尚未同步');
    jest.setSystemTime(new Date('2026-11-04T16:00:30Z'));
    expect((await ask('幫我設提醒')).assignmentRead?.reviewReminder).toBe(true);
    const second = await ask('還有呢？');
    expect(second.assignmentRead?.items).toEqual(tasks.slice(8, 16));
    const last = await ask('下一頁');
    expect(last.assignmentRead?.items).toEqual(tasks.slice(16));
    expect([first, second, last].flatMap((reply) => reply.assignmentRead!.items)).toEqual(tasks);
    const atEnd = await ask('還有嗎？');
    expect(atEnd.assignmentRead?.items).toEqual(tasks.slice(16));
    expect((await ask('回到第一頁')).assignmentRead?.items).toEqual(tasks.slice(0, 8));
    expect((await ask('第 3 頁')).assignmentRead?.items).toEqual(tasks.slice(16));
    expect((await ask('第 9 頁')).assignmentRead?.items).toEqual(tasks.slice(16));
    const back = await ask('上一頁');
    expect(back.assignmentRead?.items).toEqual(tasks.slice(8, 16));
    const selection = await ask('第二筆');
    expect(selection.assignmentRead?.items).toEqual([tasks[9]]);
    expect(selection.assignmentRead?.reviewReminder).toBe(true);
    expect(selection.assignmentRead?.page).toBeUndefined();
    // An evaluation time pinned to the first page must not extend authorization.
    jest.setSystemTime(new Date('2026-11-04T16:16:00Z'));
    const expired = await askCampusAssistant({ ...input(), mode: 'device', senseSnapshot: snapshot, messages: [
      { role: 'assistant', content: second.content, assignmentRead: second.assignmentRead },
      { role: 'user', content: '下一頁' },
    ] });
    expect(expired.tool).toBe('online-required');
    expect(expired.content).not.toContain('練習 17');
    expect(expired.assignmentRead).toBeUndefined();
    expect(localLLM.generate).not.toHaveBeenCalled();
    expect(httpsCallable).not.toHaveBeenCalled();
  } finally {
    jest.useRealTimers();
  }
});

const classOccurrence = {
  courseId: 'manual:db', name: '資料庫', room: '任垣 210', date: '2026-11-05',
  term: '115|1', startTime: '10:10', endTime: '12:00',
};
function withUpcoming(classes: typeof classOccurrence[] | undefined, checkedAt = '2026-11-05T01:55:00Z') {
  const { collectOnDeviceSchoolContext } = require('../../services/onDeviceSchoolContext');
  collectOnDeviceSchoolContext.mockResolvedValueOnce({
    schoolId: 'pu', checkedAt,
    timetable: { source: 'saved-device-copy', updatedAt: checkedAt, courses: [], nextClasses: classes },
  });
}

test('finds the next class without a model and checks the same occurrence again for a room follow-up', async () => {
  jest.mocked(localLLM.getRuntimeAvailability).mockReturnValue({ available: false });
  const question = { role: 'user' as const, content: '下一堂課是什麼？' };
  withUpcoming([classOccurrence]);
  const first = await askCampusAssistant({ ...input(), mode: 'device', messages: [question] });
  expect(first.savedClassRead?.classes).toEqual([classOccurrence]);
  const moved = { ...classOccurrence, room: '主顧 303' };
  withUpcoming([moved]);
  const reply = await askCampusAssistant({
    ...input(), mode: 'device', messages: [
      question, { role: 'assistant', ...first }, { role: 'user', content: '那堂課在哪間教室？' },
    ],
  });
  expect(reply.savedClassRead).toMatchObject({ classes: [moved], focus: 'room' });
  const { collectOnDeviceSchoolContext } = require('../../services/onDeviceSchoolContext');
  expect(collectOnDeviceSchoolContext.mock.lastCall[0].classFollowUp).toEqual([classOccurrence]);
  expect(reply.content).not.toContain(classOccurrence.room);
  expect(localLLM.generate).not.toHaveBeenCalled();
  expect(mockCallable).not.toHaveBeenCalled();
});

test('a room follow-up does not silently switch to the new next class when the requested occurrence cannot be confirmed', async () => {
  withUpcoming([{ ...classOccurrence, courseId: 'manual:other', room: 'C306' }]);
  const result = await askCampusAssistant({
    ...input(), mode: 'device', messages: [
      { role: 'assistant', content: '資料庫', savedClassRead: {
        uid: 'A', schoolId: 'pu', updatedAt: null, classes: [classOccurrence],
      } }, { role: 'user', content: '在哪間教室？' },
    ],
  });
  expect(result).toMatchObject({ tool: 'saved-timetable', route: '/timetable' });
  expect(result.savedClassRead).toBeUndefined();
  expect(result.content).not.toMatch(/C306|任垣/);
});

test('today uses the Taiwan date and does not return tomorrow as a remaining class today', async () => {
  withUpcoming([{ ...classOccurrence, date: '2026-11-06' }], '2026-11-05T15:58:00Z');
  const reply = await askCampusAssistant({ ...input(), mode: 'device', messages: [
    { role: 'user', content: '今天下一堂課是什麼？' },
  ] });
  expect(reply.content).toContain('今天剩下');
  expect(reply.savedClassRead).toBeUndefined();
});

test.each(['翻譯「下一堂課是什麼」', '提醒我下一堂課要交作業', '明天所有的課表'])(
  'a different request does not receive a next-class answer: %s', async (content) => {
    const reply = await askCampusAssistant({ ...input(), mode: 'device', messages: [{ role: 'user', content }] });
    expect(reply.savedClassRead).toBeUndefined();
    const { collectOnDeviceSchoolContext } = require('../../services/onDeviceSchoolContext');
    expect(collectOnDeviceSchoolContext.mock.lastCall[0]).not.toHaveProperty('includeNextClasses');
  },
);

test('a room follow-up from another scope never asks the local store to resolve that reference', async () => {
  withUpcoming([classOccurrence]);
  const result = await askCampusAssistant({
    ...input(), mode: 'device', messages: [
      { role: 'assistant', content: '原課表', savedClassRead: {
        uid: 'B', schoolId: 'other', updatedAt: null, classes: [classOccurrence],
      } }, { role: 'user', content: '那在哪個教室？' },
    ],
  });
  const { collectOnDeviceSchoolContext } = require('../../services/onDeviceSchoolContext');
  expect(collectOnDeviceSchoolContext.mock.lastCall[0]).not.toHaveProperty('classFollowUp');
  expect(result.savedClassRead).toBeUndefined();
  expect(result.content).not.toContain(classOccurrence.name);
});
