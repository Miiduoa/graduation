import { resumeOpenedCoursework } from '../../features/nuniCourseworkSnapshot';
import type { CourseworkRead, CourseworkChoice } from '../../features/nuniCourseworkFollowUp';
import type { NuniClassCoursework } from '../../services/nuniClassCoursework';
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
jest.mock('../../services/nuniAssignmentReminders', () => ({
  cancelNuniAssignmentReminder: jest.fn(), confirmNuniAssignmentReminder: jest.fn(),
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
  collectOnDeviceSchoolContext: jest.fn(async ({ schoolId, uid }: { schoolId: string; uid: string }) => ({
    ownerUid: uid,
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
test.each(['device', 'campus'] as const)('keeps ordinary history but excludes other-campus public lookups from the %s model', async (mode) => {
  const ordinary = [
    { role: 'user' as const, content: '幫我整理閱讀計畫' },
    { role: 'assistant' as const, content: '你可以先列出閱讀目標。' },
  ];
  const question = { role: 'user' as const, content: '請根據剛才的閱讀規劃，說明如何安排休息' };
  // These turns exceed the old raw 20-message window: filtering must not let
  // public lookups evict the ordinary conversation the next question refers to.
  const publicTurns = Array.from({ length: 11 }, (_, index) => [
    { role: 'user' as const, content: `查${index % 2 ? '清大' : '暨大'}的外校課程${index}` },
    { role: 'assistant' as const, content: `外校公開課程${index}，不代表個人選課。`, tool: 'public-course-catalog' as const },
  ]).flat();
  const history = [...ordinary, ...publicTurns, question];
  const original = JSON.stringify(history);
  await askCampusAssistant({ ...input(), mode, messages: history });
  const expected = [...ordinary, question];
  if (mode === 'campus') {
    expect(mockCallable.mock.calls[0][0].messages).toEqual(expected);
    expect(mockCallable.mock.calls[0][0].context.schoolId).toBe('pu');
    expect(localLLM.generate).not.toHaveBeenCalled();
  } else {
    expect(localLLM.generate).toHaveBeenCalledTimes(1);
    expect(localLLM.generate.mock.calls[0][0].messages.slice(1)).toEqual(expected);
    expect(mockCallable).not.toHaveBeenCalled();
  }
  expect(JSON.stringify(history)).toBe(original);
});

test('an invalid history ending in a public reply cannot revive its preceding question as a new request', async () => {
  await expect(askCampusAssistant({ ...input(), messages: [
    { role: 'user', content: '先前的一般問題' },
    { role: 'assistant', content: '先前的一般回答' },
    { role: 'user', content: '查清大資料庫課程' },
    { role: 'assistant', content: '清大公開課程', tool: 'public-course-catalog' },
  ] })).rejects.toThrow('Missing question');
  expect(mockCallable).not.toHaveBeenCalled();
  expect(localLLM.generate).not.toHaveBeenCalled();
});

test('forwards a conversation sessionId on the callable context', async () => {
  await askCampusAssistant({ ...input(), sessionId: '  stable-session  ' });
  expect(mockCallable).toHaveBeenCalledWith({
    messages: [{ role: 'user', content: '查公告' }],
    context: {
      schoolId: 'pu',
      screen: 'campus-assistant',
      locale: 'zh-TW',
      timezone: 'Asia/Taipei',
      sessionId: 'stable-session',
    },
  });
});
test.each(['', '   '])('does not invent or send an empty sessionId %p', async (sessionId) => {
  await askCampusAssistant({ ...input(), sessionId });
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
    ownerUid: 'A',
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
    ownerUid: 'A', checkedAt,
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
    ownerUid: 'A', checkedAt, schoolId: 'pu', schoolName: '靜宜大學',
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
    ownerUid: 'A', schoolId: 'pu', checkedAt,
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

function withCurrent(classes: typeof classOccurrence[] | undefined) {
  const { collectOnDeviceSchoolContext } = require('../../services/onDeviceSchoolContext');
  collectOnDeviceSchoolContext.mockResolvedValueOnce({
    ownerUid: 'A', schoolId: 'pu', checkedAt: '2026-11-05T03:30:00Z',
    timetable: { source: 'saved-device-copy', updatedAt: null, courses: [], currentClasses: classes },
  });
}

test.each(['我現在有課嗎？', '現在在上什麼課？', '請問這節是哪一門課？'])(
  'answers a direct current-class question from checked local data: %s', async (content) => {
    jest.mocked(localLLM.getRuntimeAvailability).mockReturnValue({ available: false });
    withCurrent([classOccurrence]);
    const reply = await askCampusAssistant({ ...input(), mode: 'device', messages: [{ role: 'user', content }] });
    expect(reply.savedClassRead).toMatchObject({ currentAt: '2026-11-05T03:30:00Z', classes: [classOccurrence] });
    expect(reply.content).toContain('任垣 210');
    expect(localLLM.generate).not.toHaveBeenCalled();
    expect(mockCallable).not.toHaveBeenCalled();
  },
);

test('current class details stay anchored while asking explicitly for next starts a fresh lookup', async () => {
  const initial = { role: 'user' as const, content: '我現在有課嗎？' };
  withCurrent([classOccurrence]);
  const first = await askCampusAssistant({ ...input(), mode: 'device', messages: [initial] });
  const previous = { role: 'assistant' as const, ...first };
  const { collectOnDeviceSchoolContext } = require('../../services/onDeviceSchoolContext');
  withCurrent([{ ...classOccurrence, room: '主顧 303' }]);
  const detail = await askCampusAssistant({ ...input(), mode: 'device', messages: [previous, { role: 'user', content: '在哪間教室？' }] });
  expect(collectOnDeviceSchoolContext.mock.lastCall[0]).toMatchObject({ includeCurrentClasses: true, classFollowUp: [classOccurrence] });
  expect(detail.savedClassRead).toMatchObject({ currentAt: first.savedClassRead?.currentAt, focus: 'room', classes: [{ room: '主顧 303' }] });
  withCurrent([]);
  const ended = await askCampusAssistant({ ...input(), mode: 'device', messages: [previous, { role: 'user', content: '那幾點下課？' }] });
  expect(ended.savedClassRead).toBeUndefined();
  expect(ended.content).toContain('原時段');
  withUpcoming([{ ...classOccurrence, courseId: 'english', name: '英文' }]);
  const next = await askCampusAssistant({ ...input(), mode: 'device', messages: [previous, { role: 'user', content: '下一堂課是什麼？' }] });
  expect(collectOnDeviceSchoolContext.mock.lastCall[0]).not.toHaveProperty('classFollowUp');
  expect(next.savedClassRead?.currentAt).toBeUndefined();
  expect(next.content).toContain('英文');
});

test('only a verified empty current window offers a free-period answer', async () => {
  const ask = () => askCampusAssistant({ ...input(), mode: 'device', messages: [{ role: 'user', content: '我現在有課嗎？' }] });
  withCurrent([]);
  const free = await ask();
  expect(free).toMatchObject({ route: '/timetable', savedClassRead: { currentAt: '2026-11-05T03:30:00Z', classes: [] } });
  expect(free.content).toContain('沒有排課');
  withCurrent(undefined);
  const unknown = await ask();
  expect(unknown.savedClassRead).toBeUndefined();
  expect(unknown.content).not.toContain('沒有排課');
});

test.each([
  ['我現在這堂課在哪間教室？', 'room'],
  ['我現在在哪裡上課？', 'room'],
  ['現在幾點下課？', 'time'],
  ['這堂課幾點下課？', 'time'],
])('reads an explicitly referenced current class detail without previous chat: %s', async (content, focus) => {
  jest.mocked(localLLM.getRuntimeAvailability).mockReturnValue({ available: false });
  withCurrent([classOccurrence]);
  const result = await askCampusAssistant({ ...input(), mode: 'device', messages: [{ role: 'user', content }] });
  expect(result.savedClassRead).toMatchObject({ currentAt: '2026-11-05T03:30:00Z', focus });
  expect(localLLM.generate).not.toHaveBeenCalled();
});

test('an explicit now overrides a future reference, while a demonstrative alone keeps that reference', async () => {
  const future = { ...classOccurrence, name: '英文', courseId: 'english', startTime: '14:10', endTime: '15:00' };
  const previous = { role: 'assistant' as const, content: '英文', savedClassRead: {
    uid: 'A', schoolId: 'pu', updatedAt: null, classes: [future],
  } };
  const lookup = (content: string) => askCampusAssistant({ ...input(), mode: 'device', messages: [previous, { role: 'user', content }] });
  const { collectOnDeviceSchoolContext } = require('../../services/onDeviceSchoolContext');
  withUpcoming([future]);
  const follow = await lookup('這堂課幾點下課？');
  expect(follow.savedClassRead).toMatchObject({ focus: 'time', classes: [future] });
  expect(collectOnDeviceSchoolContext.mock.lastCall[0]).toHaveProperty('classFollowUp', [future]);
  withCurrent([classOccurrence]);
  const now = await lookup('現在這堂課幾點下課？');
  expect(now.savedClassRead).toMatchObject({ focus: 'time', classes: [classOccurrence] });
  expect(collectOnDeviceSchoolContext.mock.lastCall[0]).not.toHaveProperty('classFollowUp');
});

test.each(['在哪裡？', '現在在哪裡？', '幾點下課？', '提醒我現在上課'])(
  'does not infer a specific current class from an unrelated or unanchored question: %s', async (content) => {
    await askCampusAssistant({ ...input(), mode: 'device', messages: [{ role: 'user', content }] });
    const { collectOnDeviceSchoolContext } = require('../../services/onDeviceSchoolContext');
    expect(collectOnDeviceSchoolContext.mock.lastCall[0]).not.toHaveProperty('includeCurrentClasses');
  },
);

test('an account switch while reading the current timetable discards the old account result', async () => {
  withCurrent([classOccurrence]);
  const pending = askCampusAssistant({ ...input(), mode: 'device', messages: [{ role: 'user', content: '我現在有課嗎？' }] });
  mockUid = 'B';
  await expect(pending).rejects.toMatchObject({ code: 'session-changed' });
  expect(localLLM.generate).not.toHaveBeenCalled();
  expect(mockCallable).not.toHaveBeenCalled();
});

describe('finding time between classes on the phone', () => {
  const checkedAt = '2026-11-06T03:00:00Z';
  const request = { ...input(), mode: 'device' as const };
  const platform = { ...request, scope: { uid: '', schoolId: 'pu' },
    platformTimetable: { accountId: 'student', isCurrent: () => true } };
  const ask = (content: string) => ({ role: 'user' as const, content });
  const readContext = jest.mocked(require('../../services/onDeviceSchoolContext').collectOnDeviceSchoolContext);
  const snapshot = (day: string, start: string, end: string) => ({ ownerUid: 'A', schoolId: 'pu', checkedAt,
    timetable: { source: 'saved-device-copy', updatedAt: checkedAt, courses: [], classGaps: [{
      startAt: Date.parse(day + 'T' + start + ':00+08:00'), endAt: Date.parse(day + 'T' + end + ':00+08:00'),
    }] } });

  test.each([[request, 'firebase:A'], [platform, 'nuni:student']] as const)(
    'uses the account timetable without a model and rereads it when refining the search (%p)', async (base, owner) => {
      jest.mocked(localLLM.getRuntimeAvailability).mockReturnValue({ available: false });
      readContext.mockResolvedValueOnce(snapshot('2026-11-06', '12:10', '12:55'));
      const first = await askCampusAssistant({ ...base, messages: [ask('今天還有半小時的空堂嗎？')] });
      expect(first.classGapRead).toEqual({ owner, schoolId: 'pu', checkedAt, day: 'today', minMinutes: 30 });
      expect(first.content).toContain('12:10');
      readContext.mockResolvedValueOnce(snapshot('2026-11-07', '09:10', '10:00'));
      const second = await askCampusAssistant({ ...base, messages: [{ role: 'assistant', ...first }, ask('那明天呢？')] });
      expect(readContext.mock.lastCall?.[0]).toMatchObject({ gapDay: 'tomorrow' });
      expect(second.content).toContain('09:10');
      expect(second.content).not.toContain('12:10');
      expect(second.classGapRead).toMatchObject({ day: 'tomorrow', minMinutes: 30 });
      readContext.mockResolvedValueOnce(snapshot('2026-11-07', '10:15', '11:30'));
      const longer = await askCampusAssistant({ ...base, messages: [{ role: 'assistant', ...second }, ask('至少一小時呢？')] });
      expect(longer.classGapRead).toMatchObject({ day: 'tomorrow', minMinutes: 60 });
      expect(longer.content).toContain('10:15');
      expect(localLLM.getRuntimeAvailability).not.toHaveBeenCalled();
      expect(mockCallable).not.toHaveBeenCalled();
    });

  test.each([['nuni:another', 'pu'], ['nuni:student', 'other']])(
    'does not reuse a gap query from owner %s and school %s', async (owner, schoolId) => {
      const result = await askCampusAssistant({ ...platform, messages: [
        { role: 'assistant', content: '舊時段', classGapRead: { owner, schoolId, checkedAt, day: 'today', minMinutes: 30 } },
        ask('那明天呢？'),
      ] });
      expect(readContext).not.toHaveBeenCalled();
      expect(result.classGapRead).toBeUndefined();
      expect(result.content).toContain('重新問');
    });

  test.each([[request, 'firebase:A'], [platform, 'nuni:student']] as const)(
    'keeps the chosen day and duration while refining, clearing and changing the time window (%p)', async (base, owner) => {
      const replies: Awaited<ReturnType<typeof askCampusAssistant>>[] = [];
      const lookup = async (question: string, date = '2026-11-07') => {
        readContext.mockResolvedValueOnce(snapshot(date, '13:00', '18:00'));
        const previous = replies.at(-1);
        const reply = await askCampusAssistant({ ...base, messages: [
          ...(previous ? [{ role: 'assistant' as const, ...previous }] : []), ask(question),
        ] });
        replies.push(reply);
        return reply;
      };
      const initial = await lookup('明天下午有一個半小時的空堂嗎？');
      expect(initial.classGapRead).toMatchObject({ owner, day: 'tomorrow', part: 'afternoon', minMinutes: 90 });

      const later = await lookup('改成下午三點半以後');
      expect(later.classGapRead).toMatchObject({ day: 'tomorrow', minMinutes: 90, fromMinute: 930 });
      expect(later.classGapRead).not.toHaveProperty('part');
      expect(later.content).toContain('15:30–18:00（150 分鐘）');

      const afternoon = await lookup('只看下午');
      expect(afternoon.classGapRead).toMatchObject({ day: 'tomorrow', part: 'afternoon', minMinutes: 90 });
      expect(afternoon.classGapRead).not.toHaveProperty('fromMinute');

      const anyLength = await lookup('不限長度');
      expect(anyLength.classGapRead).toMatchObject({ day: 'tomorrow', part: 'afternoon', minMinutes: 0 });

      const twoDaysLater = await lookup('那後天有哪些空堂？', '2026-11-08');
      expect(twoDaysLater.classGapRead).toMatchObject({ day: 'day-after-tomorrow', part: 'afternoon', minMinutes: 0 });
      expect(readContext.mock.lastCall?.[0]).toMatchObject({ gapDay: 'day-after-tomorrow' });
      expect(twoDaysLater.content).toContain('後天（11/08）');

      const allDay = await lookup('全天', '2026-11-08');
      expect(allDay.classGapRead).toMatchObject({ day: 'day-after-tomorrow', minMinutes: 0 });
      expect(allDay.classGapRead).not.toHaveProperty('part');
      expect(readContext).toHaveBeenCalledTimes(6);
      expect(localLLM.getRuntimeAvailability).not.toHaveBeenCalled();
      expect(mockCallable).not.toHaveBeenCalled();
    });

  test('cancelling a refinement immediately releases the wait and ignores a late timetable answer', async () => {
    let finish!: (value: unknown) => void;
    readContext.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const controller = new AbortController();
    const pending = askCampusAssistant({ ...request, signal: controller.signal, messages: [
      { role: 'assistant', content: '明天下午空堂', classGapRead: {
        owner: 'firebase:A', schoolId: 'pu', checkedAt, day: 'tomorrow', minMinutes: 30, part: 'afternoon' } },
      ask('改成下午三點半以後'),
    ] });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' });
    readContext.mockResolvedValueOnce(snapshot('2026-11-07', '14:00', '16:00'));
    const next = await askCampusAssistant({ ...request, messages: [ask('明天有哪些空堂？')] });
    expect(next.content).toContain('14:00–16:00');
    finish(snapshot('2026-11-07', '13:00', '18:00'));
    expect(localLLM.generate).not.toHaveBeenCalled();
    expect(mockCallable).not.toHaveBeenCalled();
  });

  test.each(['星期二有哪些空堂？', '明天三點半以後有哪些空堂？', '明天15:70以後有哪些空堂？'])(
    'explains an unsupported or ambiguous gap lookup without asking a model to guess: %s', async (question) => {
      const reply = await askCampusAssistant({ ...request, messages: [ask(question)] });
      expect(reply.content).toContain('這次沒有套用');
      expect(reply.classGapRead).toBeUndefined();
      expect(readContext).not.toHaveBeenCalled();
      expect(localLLM.getRuntimeAvailability).not.toHaveBeenCalled();
      expect(mockCallable).not.toHaveBeenCalled();
    });

  test.each(['那明天17:00以後有哪些空堂？', '只看17:00以後', '改成15:00到14:00'])(
    'never treats a conflicting refinement as a fresh lookup that silently resets earlier bounds: %s', async (question) => {
      const reply = await askCampusAssistant({ ...request, messages: [
        { role: 'assistant', content: '明天16:00以前', classGapRead: {
          owner: 'firebase:A', schoolId: 'pu', checkedAt, day: 'tomorrow', minMinutes: 90, untilMinute: 960 } },
        ask(question),
      ] });
      expect(reply.content).toContain('這次沒有套用');
      expect(reply.classGapRead).toBeUndefined();
      expect(readContext).not.toHaveBeenCalled();
      expect(localLLM.getRuntimeAvailability).not.toHaveBeenCalled();
      expect(mockCallable).not.toHaveBeenCalled();
    });

  test('requires a new day after Taiwan midnight and drops a result when the account changes mid-read', async () => {
    readContext.mockResolvedValueOnce(snapshot('2026-11-06', '12:10', '12:55'));
    const reply = await askCampusAssistant({ ...request, messages: [
      { role: 'assistant', content: '課間空堂', classGapRead: {
        owner: 'firebase:A', schoolId: 'pu', checkedAt: '2026-11-05T15:59:59Z', day: 'today', minMinutes: 0 } },
      ask('至少一小時呢？'),
    ] });
    expect(reply.content).toContain('換日');
    expect(reply.classGapRead).toBeUndefined();
    readContext.mockResolvedValueOnce(snapshot('2026-11-06', '12:10', '12:55'));
    const pending = askCampusAssistant({ ...request, messages: [ask('今天有哪些空堂？')] });
    mockUid = 'B';
    await expect(pending).rejects.toMatchObject({ code: 'session-changed' });
  });

  test('rejects an offline class-gap snapshot from a different Firebase account', async () => {
    readContext.mockResolvedValueOnce({ ...snapshot('2026-11-06', '10:00', '15:00'), ownerUid: 'B' });
    const reply = await askCampusAssistant({ ...request, messages: [ask('今天有哪些空堂？')] });
    expect(reply.content).not.toContain('10:00–15:00');
    expect(reply.classGapRead).toBeUndefined();
    expect(mockCallable).not.toHaveBeenCalled();
  });

  test('requires a signed-in timetable owner before reading a private schedule', async () => {
    const reply = await askCampusAssistant({ ...request, scope: { schoolId: 'pu', uid: '' },
      messages: [ask('今天有哪些空堂？')] });
    expect(reply.content).toContain('登入');
    expect(reply.classGapRead).toBeUndefined();
    expect(readContext).not.toHaveBeenCalled();
  });

  test('offers import only for a missing platform timetable', async () => {
    const messages = [ask('今天有哪些空堂？')];
    const missing = await askCampusAssistant({ ...platform, messages });
    expect(missing.route).toBe('/timetable/import');
    expect(missing.classGapRead).toBeUndefined();
    readContext.mockResolvedValueOnce({ schoolId: 'pu', checkedAt,
      timetable: { source: 'unreadable', updatedAt: null, courses: [] } });
    const unreadable = await askCampusAssistant({ ...platform, messages });
    expect(unreadable.route).toBe('/timetable');
    expect(unreadable.classGapRead).toBeUndefined();
  });
});

describe('platform timetable without a school account', () => {
  const platform = () => ({
    ...input(), mode: 'device' as const, scope: { uid: '', schoolId: 'pu' },
    platformTimetable: { accountId: 'pa-student', isCurrent: () => true },
    messages: [{ role: 'user' as const, content: '我現在有課嗎？' }],
  });

  test('routes a platform study plan through its own authorized sources without Firebase snapshots, model setup or follow-up grants', async () => {
    mockUid = null;
    const plan = { title: '七日計畫', overview: '平台來源', checkedAt: '2026-11-06T01:00:00Z',
      steps: [{ id: 'verify', title: '核對課程', detail: '查看 nuni 課程', evidence: 'verification' as const,
        priority: 'verify' as const, route: '/classroom' as const }], limitations: [], content: '已依 nuni 課表與作業整理' };
    const planner = jest.spyOn(require('../../services/nuniCampusPlanner'), 'buildNuniCampusPlan').mockResolvedValue(plan);
    try {
      const request = platform();
      const courseworkRequests = { request: jest.fn(), bffRequest: jest.fn() };
      const reply = await askCampusAssistant({ ...request, courseworkRequests,
        messages: [{ role: 'user', content: '幫我安排未來七天的課表與作業' }] });
      expect(reply).toEqual({ source: 'device', tool: 'campus-plan', hasActions: false, content: plan.content, plan });
      expect(planner).toHaveBeenCalledWith({
        question: '幫我安排未來七天的課表與作業', schoolId: 'pu', platformTimetable: request.platformTimetable,
        ...courseworkRequests, isCurrent: request.isCurrent, signal: undefined,
      });
      expect(reply).not.toHaveProperty('assignmentRead');
      expect(reply).not.toHaveProperty('courseworkRead');
      expect(require('../../services/onDeviceSchoolContext').collectOnDeviceSchoolContext).not.toHaveBeenCalled();
      expect(httpsCallable).not.toHaveBeenCalled();
      expect(localLLM.getRuntimeAvailability).not.toHaveBeenCalled();
    } finally { planner.mockRestore(); }
  });

  test('a discarded platform plan cannot surface as a successful empty plan', async () => {
    const planner = jest.spyOn(require('../../services/nuniCampusPlanner'), 'buildNuniCampusPlan').mockResolvedValue(null);
    try {
      await expect(askCampusAssistant({ ...platform(), messages: [{ role: 'user', content: '下週學習計畫' }] }))
        .rejects.toMatchObject({ code: 'session-changed' });
      expect(httpsCallable).not.toHaveBeenCalled();
      expect(localLLM.generate).not.toHaveBeenCalled();
    } finally { planner.mockRestore(); }
  });

  test('cancellation ends the platform planner wait without waiting for transport completion', async () => {
    const planner = jest.spyOn(require('../../services/nuniCampusPlanner'), 'buildNuniCampusPlan')
      .mockImplementation(() => new Promise(() => {}));
    try {
      const controller = new AbortController();
      const pending = askCampusAssistant({ ...platform(), signal: controller.signal,
        messages: [{ role: 'user', content: '未來七天的學習計畫' }] });
      controller.abort();
      await expect(pending).rejects.toMatchObject({ code: 'cancelled' });
      expect(localLLM.generate).not.toHaveBeenCalled();
    } finally { planner.mockRestore(); }
  });

  test('looks up the platform timetable and follows the verified occurrence without a local model or a Firebase call', async () => {
    mockUid = null;
    const request = platform();
    withCurrent([classOccurrence]);
    const reply = await askCampusAssistant(request);
    expect(reply.savedClassRead).toMatchObject({ uid: '', owner: 'nuni:pa-student', classes: [classOccurrence] });
    withCurrent([{ ...classOccurrence, room: '405' }]);
    const followUp = await askCampusAssistant({ ...request, messages: [
      { role: 'assistant', content: reply.content, savedClassRead: reply.savedClassRead },
      { role: 'user', content: '在哪間教室？' },
    ] });
    expect(followUp.savedClassRead).toMatchObject({ owner: 'nuni:pa-student', focus: 'room' });
    const { collectOnDeviceSchoolContext } = require('../../services/onDeviceSchoolContext');
    expect(collectOnDeviceSchoolContext.mock.lastCall[0]).toMatchObject({
      uid: '', platformTimetable: request.platformTimetable, classFollowUp: [classOccurrence],
    });
    expect(followUp.content).toContain('405');
    expect(httpsCallable).not.toHaveBeenCalled();
    expect(localLLM.getRuntimeAvailability).not.toHaveBeenCalled();
  });

  test('never follows a different platform owner, even for otherwise identical class IDs', async () => {
    withCurrent([classOccurrence]);
    const reply = await askCampusAssistant({ ...platform(), messages: [
      { role: 'assistant', content: '舊課', savedClassRead: {
        uid: '', owner: 'nuni:other', schoolId: 'pu', updatedAt: null, currentAt: '2026-11-05T03:00:00Z', classes: [classOccurrence],
      } }, { role: 'user', content: '在哪間教室？' },
    ] });
    expect(reply.savedClassRead).toBeUndefined();
    const { collectOnDeviceSchoolContext } = require('../../services/onDeviceSchoolContext');
    expect(collectOnDeviceSchoolContext.mock.lastCall[0]).not.toHaveProperty('classFollowUp');
    expect(reply.content).not.toContain(classOccurrence.room);
  });

  test('routes a new account to import and preserves the recovery route after a storage failure', async () => {
    const request = platform();
    expect((await askCampusAssistant(request)).route).toBe('/timetable/import');
    const { collectOnDeviceSchoolContext } = require('../../services/onDeviceSchoolContext');
    collectOnDeviceSchoolContext.mockResolvedValueOnce({
      checkedAt: new Date().toISOString(), schoolId: 'pu',
      timetable: { source: 'unreadable', courses: [], updatedAt: null },
    });
    expect((await askCampusAssistant(request)).route).toBe('/timetable');
  });

  test('unrelated questions do not unlock Firebase, authorized snapshots or native inference', async () => {
    const request = platform();
    const { collectOnDeviceSchoolContext } = require('../../services/onDeviceSchoolContext');
    const reply = await askCampusAssistant({ ...request, messages: [{ role: 'user', content: '請幫我送出請假' }] });
    expect(reply).toMatchObject({ source: 'device', tool: 'saved-timetable', hasActions: false });
    expect(collectOnDeviceSchoolContext).not.toHaveBeenCalled();
    await expect(askCampusAssistant({ ...request, mode: 'campus' })).rejects.toThrow('session changed');
    await expect(askCampusAssistant({ ...request, scope: { uid: 'A', schoolId: 'pu' } })).rejects.toThrow('session changed');
    expect(httpsCallable).not.toHaveBeenCalled();
    expect(localLLM.getRuntimeAvailability).not.toHaveBeenCalled();
  });

  test('a platform-only date follow-up cannot reuse the previous Firebase announcement read or snapshot', async () => {
    mockUid = null;
    const checkedAt = new Date().toISOString();
    const items = [{ title: '舊帳號的公告', publishedAt: checkedAt,
      source: { kind: 'school-announcement' as const, id: 'private-to-a' } }];
    const senseSnapshot = { userId: 'A', schoolId: 'pu', checkedAt,
      announcements: { status: 'available' as const, items },
      assignments: { status: 'unavailable' as const, count: null, items: [] },
      schedule: { status: 'unavailable' as const, count: null } };
    const reply = await askCampusAssistant({ ...platform(), senseSnapshot, messages: [
      { role: 'assistant', content: items[0].title, announcementRead: {
        userId: 'A', schoolId: 'pu', checkedAt, items, summary: '1 則公告',
      } },
      { role: 'user', content: '那昨天呢？' },
    ] });
    expect(reply.announcementRead).toBeUndefined();
    expect(reply.content).not.toContain(items[0].title);
    expect(reply.route).not.toBe('/announcements');
    expect(httpsCallable).not.toHaveBeenCalled();
    expect(localLLM.generate).not.toHaveBeenCalled();
  });

  test('discards an answer when the verified platform session expires during the read', async () => {
    withCurrent([classOccurrence]);
    const request = platform();
    const isCurrent = jest.fn().mockReturnValueOnce(true).mockReturnValue(false);
    await expect(askCampusAssistant({ ...request, platformTimetable: { ...request.platformTimetable, isCurrent } }))
      .rejects.toThrow('session changed');
    expect(httpsCallable).not.toHaveBeenCalled();
    expect(localLLM.getRuntimeAvailability).not.toHaveBeenCalled();
  });
});

describe('nuni class to coursework', () => {
  const transport = { request: jest.fn(), bffRequest: jest.fn() };
  const openWork = () => jest.spyOn(require('../../services/nuniClassCoursework'), 'readNuniClassCoursework')
    .mockResolvedValue({ kind: 'unlinked' });
  const base = () => ({
    ...input(), mode: 'device' as const, scope: { uid: '', schoolId: 'pu' }, courseworkRequests: transport,
    platformTimetable: { accountId: 'pa-student', isCurrent: () => true },
  });
  afterEach(() => jest.restoreAllMocks());

  test.each([
    ['這堂課有什麼作業？', 'current'],
    ['我現在這堂課有作業嗎？', 'current'],
    ['查下一堂課的作業', 'next'],
    ['這堂課要交什麼作業？', 'current'],
  ])('grounds the first-turn question before reading a workspace: %s', async (question, window) => {
    const load = openWork();
    if (window === 'current') withCurrent([classOccurrence]); else withUpcoming([classOccurrence]);
    const reply = await askCampusAssistant({ ...base(), messages: [{ role: 'user', content: question }] });
    expect(reply.courseworkRead?.anchor.classes).toEqual([classOccurrence]);
    expect(load).toHaveBeenCalledWith(expect.objectContaining({
      ...transport, occurrence: classOccurrence, accountId: 'pa-student', schoolId: 'pu',
    }));
    expect(localLLM.generate).not.toHaveBeenCalled();
  });

  test('an empty current timetable yields a local answer with no workspace requests', async () => {
    const load = openWork();
    withCurrent([]);
    const reply = await askCampusAssistant({ ...base(), messages: [{ role: 'user', content: '這堂課有作業嗎' }] });
    expect(reply.savedClassRead?.classes).toEqual([]);
    expect(load).not.toHaveBeenCalled();
  });

  test('a staggered overlap asks for a class first, resolving only the verified choice', async () => {
    const load = openWork();
    const lab = { ...classOccurrence, courseId: 'lab', room: 'H205' };
    withCurrent([classOccurrence, lab]);
    const question = { role: 'user' as const, content: '這堂課有什麼作業' };
    const first = await askCampusAssistant({ ...base(), messages: [question] });
    expect(first.courseworkRead?.result.kind).toBe('choose-class');
    expect(load).not.toHaveBeenCalled();
    const second = await askCampusAssistant({ ...base(), courseworkChoice: { classIndex: 1 },
      messages: [question, { role: 'assistant', ...first }, { role: 'user', content: '第二堂' }],
    });
    expect(load.mock.calls[0][0]).toMatchObject({ occurrence: lab });
    expect(second.courseworkRead?.anchor.classes).toEqual([lab]);
  });

  test('foreign anchors and stale workspace buttons never get assignment data', async () => {
    const load = openWork();
    const anchor = { uid: '', owner: 'nuni:pa-other', schoolId: 'pu', classes: [classOccurrence], updatedAt: null };
    const messages = [{ role: 'assistant' as const, content: '查課', savedClassRead: anchor },
      { role: 'user' as const, content: '這堂課有作業嗎？' }];
    await askCampusAssistant({ ...base(), messages });
    const previous = { role: 'assistant' as const, content: '選課',
      courseworkRead: { anchor: { ...anchor, owner: 'nuni:pa-student' }, result: {
        kind: 'choose' as const, workspaces: [{ id: 'one', title: classOccurrence.name }],
      } } };
    await askCampusAssistant({ ...base(), courseworkChoice: { workspaceId: 'forged' },
      messages: [previous, { role: 'user', content: '選擇課程' }] });
    expect(load).not.toHaveBeenCalled();
    await askCampusAssistant({ ...base(), courseworkChoice: { workspaceId: 'one' },
      messages: [previous, { role: 'user', content: '選擇課程' }] });
    expect(load).toHaveBeenCalledWith(expect.objectContaining({ occurrence: classOccurrence, selectedWorkspaceId: 'one' }));
  });
  test.each(['有作業嗎？', '有什麼作業要交？', '作業呢？'])('only resolves a short spoken follow-up with a previous class: %s', async (question) => {
    const load = openWork();
    await askCampusAssistant({ ...base(), messages: [{ role: 'user', content: question }] });
    expect(load).not.toHaveBeenCalled();
    const anchor = { uid: '', owner: 'nuni:pa-student', schoolId: 'pu', classes: [classOccurrence], updatedAt: null };
    await askCampusAssistant({ ...base(), messages: [
      { role: 'assistant', content: '剛才選的課', courseworkRead: { anchor, selectedWorkspaceId: 'confirmed', result: {
        kind: 'assignments', workspace: { id: 'confirmed', title: classOccurrence.name }, assignments: [], limited: false,
      } } }, { role: 'user', content: question },
    ] });
    expect(load).toHaveBeenCalledWith(expect.objectContaining({ occurrence: classOccurrence, selectedWorkspaceId: 'confirmed' }));
  });
  test('retry keeps the chosen workspace, but asking about the next class resolves a fresh source', async () => {
    const load = openWork().mockResolvedValue({ kind: 'unavailable' });
    const anchor = { uid: '', owner: 'nuni:pa-student', schoolId: 'pu', classes: [classOccurrence], updatedAt: null };
    const reviewed = { schoolId: 'pu', academicYear: '115', semester: '1', className: '乙班', teacher: '林老師', courseCode: 'DB101' };
    const previous = { role: 'assistant' as const, content: '選擇課程', courseworkRead: { anchor, result: {
      kind: 'choose' as const, workspaces: [{ id: 'confirmed', title: classOccurrence.name, reviewed }],
    } } };
    const failed = await askCampusAssistant({ ...base(), courseworkChoice: { workspaceId: 'confirmed' },
      messages: [previous, { role: 'user', content: '乙班' }] });
    const retry = { role: 'assistant' as const, ...failed };
    await askCampusAssistant({ ...base(), messages: [retry, { role: 'user', content: '這堂課有什麼作業？' }] });
    expect(load.mock.lastCall?.[0]).toMatchObject({ selectedWorkspaceId: 'confirmed', expectedReviewed: reviewed });
    const other = { ...classOccurrence, courseId: 'physics', name: '物理' };
    withUpcoming([other]);
    await askCampusAssistant({ ...base(), messages: [retry, { role: 'user', content: '下一堂課的作業呢？' }] });
    expect(load.mock.lastCall?.[0]).toMatchObject({ occurrence: other, selectedWorkspaceId: undefined });
  });
  test('cancellation ends the local wait while a workspace response is still outstanding', async () => {
    const stop = new AbortController();
    let rejectLate!: (error: Error) => void;
    openWork().mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectLate = reject; }));
    const anchor = { uid: '', owner: 'nuni:pa-student', schoolId: 'pu', classes: [classOccurrence], updatedAt: null };
    const pending = askCampusAssistant({ ...base(), signal: stop.signal, messages: [
      { role: 'assistant', content: '查課', savedClassRead: anchor }, { role: 'user', content: '這堂課有什麼作業？' },
    ] });
    stop.abort();
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' });
    rejectLate(new Error('network timeout'));
  });
  test.each(['翻譯「這堂課有什麼作業」', '提醒我明天交作業', '送出這堂課的作業', '所有課程的作業'])(
    'does not read coursework for %s', async (question) => {
      const load = openWork();
      await askCampusAssistant({ ...base(), messages: [{ role: 'user', content: question }] });
      expect(load).not.toHaveBeenCalled();
    },
  );
  describe('follow-ups on an already read assignment list', () => {
    const stamp = '2026-11-05T01:45:00Z';
    beforeEach(() => jest.spyOn(Date, 'now').mockReturnValue(Date.parse(stamp)));
    afterEach(() => jest.restoreAllMocks());
    const row = { id: 'a', title: '設計報告', state: 'open' as const, submittedAt: null, dueAt: '2026-11-03T10:00:00+08:00' };
    const snapshot: Extract<NuniClassCoursework, { kind: 'assignments' }> = {
      kind: 'assignments', workspace: { id: 'linked', title: '資料庫' }, limited: true,
      assignments: [row, { ...row, id: 'b', title: '讀書心得' },
        { ...row, id: 'c', title: '今天的作業', dueAt: stamp },
        { ...row, id: 'd', title: '設計報告', submittedAt: '2026-11-02T00:01:00Z' },
        { ...row, id: 'e', title: '延伸作業', dueAt: null },
        { ...row, id: 'f', title: '練習', state: 'closed', dueAt: '2026-10-01T00:00:00Z' }],
    };
    const read: CourseworkRead = {
      checkedAt: stamp, anchor: { uid: '', owner: 'nuni:pa-student', schoolId: 'pu', classes: [classOccurrence], updatedAt: null },
      result: snapshot,
    };
    const ask = (question: string, previous = read, courseworkChoice?: CourseworkChoice) => askCampusAssistant({
      ...base(), courseworkChoice, messages: [
        { role: 'assistant', content: '課程作業', courseworkRead: previous }, { role: 'user', content: question },
      ],
    });

    describe('assignment reminder review', () => {
      const native = jest.requireMock('../../services/nuniAssignmentReminders');
      const upcoming = { ...row, dueAt: '2026-11-07T12:00:00+08:00' };
      const list = { ...snapshot, assignments: [upcoming, { ...upcoming, id: 'b' }] };
      const source = { ...read, result: list };
      const review = async () => (await ask('提醒我交第二份', source)).courseworkRead!;
      const confirm = { reminder: 'confirm' as const, id: 'b' };
      const checkNative = () => native.confirmNuniAssignmentReminder.mockImplementation(
        async (_target: unknown, intent: { recheck: () => Promise<boolean> }) => await intent.recheck() ? 'scheduled' : 'stale');

      test('clarifies duplicate titles, binds ordinal and lead to the selected ID, and reserves writing for a review button', async () => {
        const remote = openWork();
        const pick = (await ask('提醒我交設計報告', source)).courseworkRead!;
        expect(pick.view).toMatchObject({ step: 'choose', ids: ['a', 'b'] });
        const exact = (await ask('第二份', pick)).courseworkRead!;
        expect(exact.view).toMatchObject({ step: 'review', ids: ['b'], minutes: 60 });
        const later = (await ask('提前 15 分鐘', exact)).courseworkRead!;
        expect(later.view).toMatchObject({ minutes: 15, ids: ['b'] });
        expect((await ask('確認設定提醒', later)).content).toContain('請按');
        await ask('確認設定提醒', later, { ...confirm, id: 'a' });
        await ask('確認設定提醒', pick, confirm);
        const discard = (await ask('放棄設定', later)).courseworkRead!;
        await ask('確認設定提醒', discard, confirm);
        expect(remote).not.toHaveBeenCalled();
        expect(native.confirmNuniAssignmentReminder).not.toHaveBeenCalled();
        expect(native.cancelNuniAssignmentReminder).not.toHaveBeenCalled();
      });

      test('checks current assignments by ID, handles a duplicate confirmation and separately confirms cancellation', async () => {
        const remote = openWork().mockResolvedValue({ ...list, assignments: [...list.assignments].reverse() });
        checkNative();
        const draft = await review();
        const result = (await ask('確認設定提醒', draft, confirm)).courseworkRead!;
        expect(native.confirmNuniAssignmentReminder).toHaveBeenCalledWith({ accountId: 'pa-student', schoolId: 'pu',
          workspaceId: 'linked', assignmentId: 'b' }, expect.objectContaining({ dueAt: upcoming.dueAt, leadMinutes: 60 }));
        expect(remote).toHaveBeenCalledTimes(1);
        expect(result.view).toMatchObject({ step: 'result', ids: ['b'], minutes: 60, next: 'remove' });
        await ask('確認設定提醒', result, confirm);
        expect(native.confirmNuniAssignmentReminder).toHaveBeenCalledTimes(1);
        const cancel = (await ask('取消這份作業的提醒', result)).courseworkRead!;
        expect(cancel.view).toMatchObject({ step: 'cancel-review', ids: ['b'] });
        expect(native.cancelNuniAssignmentReminder).not.toHaveBeenCalled();
        native.cancelNuniAssignmentReminder.mockResolvedValue('cancelled');
        expect((await ask('確認取消提醒', cancel, { reminder: 'remove', id: 'b' })).content).toContain('已取消');
        expect(native.cancelNuniAssignmentReminder).toHaveBeenCalledWith({ accountId: 'pa-student', schoolId: 'pu',
          workspaceId: 'linked', assignmentId: 'b' }, expect.any(Function));
      });

      test.each([{ dueAt: '2026-12-01T12:00:00+08:00' }, { submittedAt: stamp }, { state: 'closed' }])(
        'does not schedule when the live assignment changed: %j', async (patch) => {
          const fresh = { ...list, assignments: [{ ...upcoming, id: 'b', ...patch }] };
          openWork().mockResolvedValue(fresh);
          checkNative();
          const result = await ask('確認設定提醒', await review(), confirm);
          expect(result.content).toContain('已變更');
          expect(result.courseworkRead?.result).toBe(fresh);
          expect(result.courseworkRead?.view).toMatchObject({ step: 'dueAt' in patch ? 'review' : 'result' });
        });

      test.each([
        ['denied', '系統設定', 'retry'], ['failed', '再試', 'retry'], ['unchanged', '已有相同時間', 'remove'],
        ['unsupported', 'iOS 或 Android', undefined],
      ])('reports the actual notification result and appropriate next action: %s', async (status, copy, next) => {
        native.confirmNuniAssignmentReminder.mockResolvedValue(status);
        const result = await ask('確認設定提醒', await review(), confirm);
        expect(result.content).toContain(copy);
        const view = result.courseworkRead?.view;
        expect(view?.kind === 'reminder' && view.step === 'result' ? view.next : 'unexpected').toBe(next);
      });

      test('skips ineligible time choices and refuses a different user, dirty snapshot or a submitted assignment', async () => {
        const soon = { ...upcoming, dueAt: new Date(Date.parse(stamp) + 30 * 60000).toISOString() };
        expect((await ask('提醒我交這份', { ...read, result: { ...list, assignments: [soon] } })).courseworkRead?.view)
          .toMatchObject({ step: 'review', minutes: 15 });
        expect((await ask('提醒我交這份', { ...read, result: { ...list, assignments: [{ ...soon, submittedAt: stamp }] } })).content)
          .toContain('已有繳交紀錄');
        const draft = await review();
        const other = await ask('確認', { ...draft, anchor: { ...draft.anchor, owner: 'nuni:someone' } }, confirm);
        expect(other.courseworkRead).toBeUndefined();
        const dirty = await ask('確認', { ...draft, changedAssignmentId: 'b' }, confirm);
        expect(dirty.content).toContain('重新核對');
        expect(native.confirmNuniAssignmentReminder).not.toHaveBeenCalled();
      });
    });

    test('priority keeps tied open overdue items and next deadline includes exact now; projections never touch data sources', async () => {
      const remote = openWork();
      const urgent = await ask('哪個最急？');
      expect(urgent.courseworkRead).toMatchObject({ checkedAt: stamp, result: { limited: true }, view: { kind: 'priority', ids: ['a', 'b'] } });
      const next = await ask('下一個要截止的是哪個？', urgent.courseworkRead!);
      expect(next.courseworkRead?.view).toMatchObject({ ids: ['c'] });
      const receipt = await ask('我交了嗎？', next.courseworkRead!);
      expect(receipt.courseworkRead?.view).toMatchObject({ kind: 'receipt', ids: ['c'] });
      expect(receipt.content).toContain('仍在收件');
      const list = await ask('回到這門課的作業', receipt.courseworkRead!);
      expect(list.courseworkRead?.view).toBeUndefined();
      expect(list.courseworkRead?.result).toBe(snapshot);
      expect(remote).not.toHaveBeenCalled();
      expect(require('../../services/onDeviceSchoolContext').collectOnDeviceSchoolContext).not.toHaveBeenCalled();
      expect(localLLM.generate).not.toHaveBeenCalled();
    });
    test('receipt asks for an exact item, resolves ordinals within a title collision, and preserves the receipt timestamp', async () => {
      const remote = openWork();
      const initial = await ask('我交了嗎？');
      expect(initial.courseworkRead?.view?.kind).toBe('choose-receipt');
      const collision = await ask('「設計報告」我交了嗎？', initial.courseworkRead!);
      expect(collision.courseworkRead?.view?.ids).toEqual(['a', 'd']);
      const byOrdinal = await ask('第二份', collision.courseworkRead!);
      expect(byOrdinal.courseworkRead?.view).toMatchObject({ kind: 'receipt', ids: ['d'] });
      expect(byOrdinal.content).toMatch(/2026\/11\/2.*8:01/);
      const again = await ask('那這份交了沒？', byOrdinal.courseworkRead!);
      expect(again.courseworkRead?.view?.ids).toEqual(['d']);
      const byId = await ask('選擇', collision.courseworkRead!, { assignmentId: 'a' });
      expect(byId.courseworkRead?.view?.ids).toEqual(['a']);
      expect((await ask('選擇', collision.courseworkRead!, { assignmentId: 'b' })).courseworkRead).toBeUndefined();
      expect(remote).not.toHaveBeenCalled();
    });
    test('an opened row is a referent but an explicit title takes precedence and returning to list forgets the open row', async () => {
      const previous = { ...read, openedAssignmentId: 'd' };
      expect((await ask('我交了嗎？', previous)).courseworkRead?.view?.ids).toEqual(['d']);
      expect((await ask('讀書心得交了嗎？', previous)).courseworkRead?.view?.ids).toEqual(['b']);
      const list = (await ask('回到這門課的作業', previous)).courseworkRead!;
      expect((await ask('我交了嗎？', list)).courseworkRead?.view?.kind).toBe('choose-receipt');
    });
    test('an actual submission change forces a new read of the same assignment ID, even when two names are identical', async () => {
      const freshRow = { ...row, submittedAt: '2026-11-05T02:00:00Z' };
      const remote = openWork().mockResolvedValue({ ...snapshot, assignments: [snapshot.assignments[3], freshRow] });
      const refreshed = await ask('我交了嗎？', { ...read, openedAssignmentId: 'a', changedAssignmentId: 'a' });
      expect(remote.mock.lastCall?.[0]).toMatchObject({ expectedLinkedWorkspaceId: 'linked' });
      expect(refreshed.courseworkRead?.view).toMatchObject({ ids: ['a'], kind: 'receipt' });
      expect(refreshed.content).toMatch(/2026\/11\/5.*10:00/);
      expect(refreshed.courseworkRead?.changedAssignmentId).toBeUndefined();
      remote.mockResolvedValue({ ...snapshot, assignments: [snapshot.assignments[3]] });
      const lost = await ask('重新核對', read, { refreshAssignmentId: 'a' });
      expect(lost.courseworkRead?.result.kind).toBe('changed');
      expect(lost.content).not.toContain('設計報告');
    });
    test('retry after a failed exact-item refresh stays on the same workspace and item', async () => {
      const remote = openWork().mockResolvedValueOnce({ kind: 'unavailable' }).mockResolvedValueOnce(snapshot);
      const failed = await ask('重新核對', read, { refreshAssignmentId: 'd' });
      expect(failed.courseworkRead).toMatchObject({ result: { kind: 'unavailable' }, retryAssignmentId: 'd' });
      const retry = await ask('這堂課有什麼作業？', failed.courseworkRead!);
      expect(retry.courseworkRead?.view).toMatchObject({ kind: 'receipt', ids: ['d'] });
      expect(remote.mock.lastCall?.[0]).toMatchObject({ expectedLinkedWorkspaceId: 'linked' });
    });
    test('dirty generic priority does not recommend stale data and unrecognized target IDs cannot cause a remote read', async () => {
      const remote = openWork();
      const dirty = { ...read, changedAssignmentId: 'a' };
      expect((await ask('哪份最急？', dirty)).content).toContain('重新查詢');
      expect((await ask('確認', dirty, { refreshAssignmentId: 'unknown' })).courseworkRead).toBeUndefined();
      expect(remote).not.toHaveBeenCalled();
    });
    test('unknown deadlines do not outrank known ones and closed/submitted work never appears as pending', async () => {
      const only = (index: number) => ({ ...read, result: { ...snapshot, assignments: [snapshot.assignments[index]] } });
      expect((await ask('哪份最急？', only(4))).content).toContain('無法依截止時間排序');
      expect((await ask('哪份快截止？', only(0))).courseworkRead?.view?.ids).toEqual([]);
      expect((await ask('哪份最急？', only(5))).courseworkRead?.view?.ids).toEqual([]);
      expect((await ask('哪份最急？', only(3))).courseworkRead?.view?.ids).toEqual([]);
    });
    test('elapsed deadlines do not stay upcoming while the source and submission timestamps remain unchanged', async () => {
      const remote = openWork();
      jest.mocked(Date.now).mockReturnValue(Date.parse('2026-11-06T01:45:00Z'));
      const reply = await ask('哪個最快截止？');
      expect(reply.courseworkRead).toMatchObject({ checkedAt: stamp, view: {
        kind: 'priority', ids: [], rankedAt: '2026-11-06T01:45:00.000Z',
      } });
      expect(remote).not.toHaveBeenCalled();
    });
    test('opening a historical assignment cannot revive an omitted item or a later failed source as a receipt', () => {
      const latest: CourseworkRead = { ...read, checkedAt: '2026-11-05T01:48:00Z',
        result: { ...snapshot, assignments: [row] } };
      const history = [{ courseworkRead: read }, { courseworkRead: latest }];
      expect(resumeOpenedCoursework(history, read, 'd')).toMatchObject({
        checkedAt: latest.checkedAt, view: { kind: 'choose-receipt', ids: [] },
      });
      const failed: CourseworkRead = { ...read, result: { kind: 'unavailable' }, expectedLinkedWorkspaceId: snapshot.workspace.id };
      expect(resumeOpenedCoursework([...history, { courseworkRead: failed }], read, 'd')).toMatchObject({
        result: { kind: 'unavailable' }, retryAssignmentId: 'd',
      });
    });
    test.each([{ owner: 'nuni:other' }, { schoolId: 'ncku' }, { uid: 'legacy' }])('an invalid scope cannot project private coursework %j', async (patch) => {
      const remote = openWork();
      const wrong = { ...read, anchor: { ...read.anchor, ...patch } };
      const reply = await ask('哪份最急？', wrong);
      expect(reply.courseworkRead).toBeUndefined();
      expect(reply.content).not.toContain('設計報告');
      expect((await ask('確認', wrong, { refreshAssignmentId: 'a' })).courseworkRead).toBeUndefined();
      expect(remote).not.toHaveBeenCalled();
    });
  });

});

test('keeps a date follow-up scoped to the observed announcement list without running a model', async () => {
  jest.useFakeTimers({ now: new Date('2026-11-05T16:05:00Z') });
  try {
    const items = [
      { title: '今日日程異動', publishedAt: '2026-11-05T16:01:00Z',
        source: { kind: 'school-announcement' as const, id: 'today' } },
      { title: '昨日選課公告', publishedAt: '2026-11-05T15:59:00Z',
        source: { kind: 'legacy-announcement' as const, id: 'older' } },
    ];
    const senseSnapshot = { userId: 'A', schoolId: 'pu', checkedAt: new Date().toISOString(),
      announcements: { status: 'available' as const, items },
      assignments: { status: 'unavailable' as const, count: null, items: [] },
      schedule: { status: 'unavailable' as const, count: null } };
    const args = { ...input(), mode: 'device' as const, senseSnapshot };
    const first = await askCampusAssistant({ ...args, messages: [{ role: 'user', content: '今天發布了哪些校園公告？' }] });
    expect(first.announcementRead?.items).toEqual([items[0]]);
    const turns = [
      { role: 'assistant' as const, content: first.content, announcementRead: first.announcementRead },
      { role: 'user' as const, content: '那昨天呢？' },
    ];
    const second = await askCampusAssistant({ ...args, messages: turns });
    expect(second.announcementRead?.items).toEqual([items[1]]);
    expect(second.content).not.toContain(items[0].title);
    const stale = await askCampusAssistant({ ...args, messages: turns, senseSnapshot: null });
    expect(stale.tool).toBe('online-required');
    expect(stale.content).not.toContain(items[1].title);
    expect(mockCallable).not.toHaveBeenCalled();
    expect(localLLM.generate).not.toHaveBeenCalled();
  } finally {
    jest.useRealTimers();
  }
});

test('a date follow-up re-reads announcements from the current authorized snapshot without a model', async () => {
  jest.useFakeTimers().setSystemTime(new Date('2026-11-01T16:04:00Z'));
  try {
    const scope = { ...input(), mode: 'device' as const };
    const senseSnapshot = {
      userId: 'A', schoolId: 'pu', checkedAt: new Date().toISOString(),
      schedule: { status: 'unavailable' as const, count: null },
      assignments: { status: 'unavailable' as const, count: null, items: [] },
      announcements: { status: 'available' as const, items: [
        { title: '昨日停水', publishedAt: '2026-11-01T15:59:00Z' },
        { title: '今日復水', publishedAt: '2026-11-01T16:00:00Z' },
      ] },
    };
    const initial = { role: 'user' as const, content: '今天有哪些公告？' };
    const answer = await askCampusAssistant({ ...scope, senseSnapshot, messages: [initial] });
    expect(answer.content).toContain('今日復水');
    expect(answer.content).not.toContain('昨日停水');
    const history = [initial, { role: 'assistant' as const, ...answer }];
    const messages = [...history, { role: 'user' as const, content: '那昨天呢？' }];
    const yesterday = await askCampusAssistant({ ...scope, senseSnapshot, messages });
    expect(yesterday).toMatchObject({ tool: 'campus-snapshot', route: '/announcements' });
    expect(yesterday.content).toContain('昨日停水');
    expect(yesterday.content).not.toContain('今日復水');
    for (const date of ['那最近七天呢？', '改看上個禮拜']) {
      const otherPeriod = await askCampusAssistant({ ...scope, senseSnapshot,
        messages: [...history, { role: 'user', content: date }] });
      expect(otherPeriod).toMatchObject({ tool: 'campus-snapshot', route: '/announcements' });
      expect(otherPeriod.content).toContain('昨日停水');
    }
    const timetable = await askCampusAssistant({ ...scope, senseSnapshot,
      messages: [...history, { role: 'user', content: '那昨天的課表呢？' }] });
    expect(timetable.route).toBe('/timetable');
    jest.setSystemTime(new Date('2026-11-01T16:05:00Z'));
    const replacement = { title: '修訂後的昨日公告', publishedAt: '2026-11-01T15:59:00Z' };
    const refreshed = { ...senseSnapshot, checkedAt: new Date().toISOString(),
      announcements: { ...senseSnapshot.announcements, items: [replacement] } };
    const reread = await askCampusAssistant({ ...scope, senseSnapshot: refreshed, messages });
    expect(reread.announcementRead).toMatchObject({ checkedAt: refreshed.checkedAt, items: [replacement] });
    expect(reread.content).not.toContain('昨日停水');
    for (const foreign of [{ userId: 'another-student' }, { schoolId: 'another-school' }]) {
      const prior = { role: 'assistant' as const, ...answer, announcementRead: { ...answer.announcementRead!, ...foreign } };
      const rejected = await askCampusAssistant({ ...scope, senseSnapshot: refreshed,
        messages: [prior, { role: 'user', content: '那昨天呢？' }] });
      expect(rejected.tool).toBe('online-required');
      expect(rejected.announcementRead).toBeUndefined();
      expect(rejected.content).not.toMatch(/修訂後的昨日公告|昨日停水|今日復水/);
    }
    jest.setSystemTime(new Date('2026-11-01T16:25:00Z'));
    const expired = await askCampusAssistant({ ...scope, senseSnapshot, messages });
    expect(expired).toMatchObject({ tool: 'online-required', route: '/announcements' });
    expect(expired.content).not.toMatch(/昨日停水|今日復水/);
    expect(localLLM.generate).not.toHaveBeenCalled();
    expect(httpsCallable).not.toHaveBeenCalled();
  } finally {
    jest.useRealTimers();
  }
});

test('offline school contacts use only the selected directory without model, timetable or network access', async () => {
  const { collectOnDeviceSchoolContext } = require('../../services/onDeviceSchoolContext');
  for (const [schoolId, name, phone] of [
    ['nthu', '國立清華大學', '(03)5715131'],
    ['ncku', '國立成功大學', '(06)2757575'],
  ]) {
    const answer = await askCampusAssistant({
      ...input(), mode: 'device', scope: { uid: '', schoolId }, schoolName: name,
      messages: [{ role: 'user', content: '請問學校總機電話是多少？' }],
    });
    expect(answer).toMatchObject({ source: 'device', tool: 'school-directory', hasActions: false });
    expect(answer.content).toContain(phone);
    expect(answer.content).toContain('教育部');
  }
  expect(collectOnDeviceSchoolContext).not.toHaveBeenCalled();
  expect(localLLM.generate).not.toHaveBeenCalled();
  expect(mockCallable).not.toHaveBeenCalled();
});
