'use strict';

const mockDocuments = new Map();
const mockReads = [];
const mockWrites = [];
let mockReadHook;
function mockRef(path, constraints = []) {
  return {
    collection: (name) => mockRef(`${path}/${name}`),
    doc: (id) => mockRef(`${path}/${id}`),
    where: (...args) => mockRef(path, [...constraints, ['where', ...args]]),
    orderBy: (...args) => mockRef(path, [...constraints, ['orderBy', ...args]]),
    limit: (count) => mockRef(path, [...constraints, ['limit', count]]),
    set: async (data, options) => {
      mockWrites.push({ path, data, options });
      mockDocuments.set(path, options?.merge ? { ...mockDocuments.get(path), ...data } : data);
    },
    get: async () => {
      mockReads.push({ path, constraints });
      if (mockReadHook) await mockReadHook(path);
      const data = mockDocuments.get(path);
      if (data instanceof Error) throw data;
      if (Array.isArray(data) || path.split('/').length % 2 === 1) {
        const docs = (data || []).map((row) => ({ id: row.id, data: () => row.data }));
        return { empty: docs.length === 0, docs };
      }
      return { exists: Boolean(data), data: () => data };
    },
  };
}
const mockDb = { collection: (name) => mockRef(name) };
const mockModel = jest.fn();
const mockWebSearch = jest.fn(async () => null);

jest.mock('firebase-admin/firestore', () => ({
  getFirestore: () => mockDb,
  FieldValue: { serverTimestamp: () => 'server-timestamp' },
}));
jest.mock('../assistantAgent', () => ({
  ...jest.requireActual('../assistantAgent'),
  callAssistantModelWithTools: (...args) => mockModel(...args),
  callAssistantModel: async () => ({
    content: '{"score":0.9,"needsUserReview":false,"reason":""}',
  }),
  answerWithServerWebSearch: (...args) => mockWebSearch(...args),
}));

// Only external model/search calls and Firestore are replaced. The callable, runtime,
// core, compose, formatter, tool registry, authorization and source readers stay real.
const { executeCampusAssistantCore } = require('./executeCampusAssistantCore');
const askCampusAssistant = require('./handlers/askCampusAssistant');
const row = (id, data) => ({ id, data });

function run(intent, { uid = null, schoolId = 'pu', prefetched = {} } = {}) {
  return executeCampusAssistantCore({
    request: {
      auth: uid ? { uid, token: { name: 'Alice', role: 'student' } } : null,
      data: { messages: [{ role: 'user', content: '查詢校園公開資料' }], context: { schoolId } },
    },
    runId: 'source-contract',
    startedAt: Date.now(),
    routingIntent: intent,
    prefetched,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDocuments.clear();
  mockReads.length = 0;
  mockWrites.length = 0;
  mockReadHook = undefined;
  mockModel.mockReset().mockResolvedValue({ provider: 'none', errors: [], content: '' });
  mockDocuments.set('schools/pu/announcements', [
    row('notice', {
      title: '校方發布的公告',
      schoolId: 'pu',
      publishedAt: new Date('2026-10-08T00:00:00Z'),
    }),
  ]);
  mockDocuments.set('schools/pu/clubEvents', [
    row('event', {
      title: '校方發布的活動',
      schoolId: 'pu',
      startsAt: new Date('2099-10-08T00:00:00Z'),
      location: '活動中心',
    }),
  ]);
  mockDocuments.set('schools/pu/menus', [
    row('menu', { name: '營運菜單', schoolId: 'pu', price: 75 }),
  ]);
  mockDocuments.set('schools/pu/pois', [
    row('poi', { name: '校園地點', schoolId: 'pu', lat: 24.2, lng: 120.5 }),
  ]);
});

test.each([
  ['announcements', '校方發布的公告', 'announcement', 'notice'],
  ['events', '校方發布的活動', 'event', 'event'],
  ['menus', '營運菜單', 'menu', 'menu'],
])(
  'the actual %s core path reaches a source-backed response without undefined readers',
  async (intent, title, type, id) => {
    const result = await run(intent);
    expect(result.content).toContain(title);
    expect(result.citations).toContainEqual(expect.objectContaining({ type, id }));
    const modelInput = mockModel.mock.calls[0][0];
    const systemPrompt = modelInput.messages[0].content;
    for (const sourceTitle of ['校方發布的公告', '校方發布的活動', '營運菜單', '校園地點']) {
      expect(systemPrompt).toContain(sourceTitle);
    }
    expect(mockReads.every((read) => read.path.startsWith('schools/pu/'))).toBe(true);
    expect(modelInput.messages.at(-1)).toEqual({ role: 'user', content: '查詢校園公開資料' });
    expect(mockWebSearch).toHaveBeenCalledWith('查詢校園公開資料');
  },
);

test('an authenticated profile fixes the school context before any campus read', async () => {
  mockDocuments.set('users/alice', {
    primarySchoolId: 'pu',
    schoolId: 'old-school',
    role: 'student',
  });
  mockDocuments.set('schools/pu/members/alice', { status: 'active' });
  const result = await run('announcements', { uid: 'alice', schoolId: 'model-selected-school' });
  expect(result.content).toContain('校方發布的公告');
  expect(mockModel.mock.calls[0][0].toolCtx.schoolId).toBe('pu');
  expect(
    mockReads.some(
      (read) => read.path.includes('model-selected-school') || read.path.includes('old-school'),
    ),
  ).toBe(false);
});

test('an account without active membership never reaches public or personal assistant reads', async () => {
  mockDocuments.set('users/alice', { schoolId: 'pu' });
  mockDocuments.set('schools/pu/members/alice', { status: 'inactive' });
  await expect(run('announcements', { uid: 'alice' })).rejects.toMatchObject({
    code: 'permission-denied',
  });
  expect(mockReads.map((read) => read.path)).toEqual(['users/alice', 'schools/pu/members/alice']);
  expect(mockModel).not.toHaveBeenCalled();
});

test('a source failure rejects the core request instead of claiming that no announcements exist', async () => {
  mockDocuments.set('schools/pu/announcements', new Error('source unavailable'));
  await expect(run('announcements')).rejects.toThrow('source unavailable');
  expect(mockModel).not.toHaveBeenCalled();
  expect(mockReads.some((read) => read.path === 'announcements')).toBe(false);
});

test('the existing study summary branch calls the scoped weekly reader with the verified school', async () => {
  mockDocuments.set('users/alice', { schoolId: 'pu', role: 'student' });
  mockDocuments.set('schools/pu/members/alice', { status: 'active' });
  mockDocuments.set('users/alice/schools/pu/weeklyReports', [
    row('week', { schoolId: 'pu', summary: '已完成本人課務摘要' }),
  ]);
  const result = await run('study_summary', { uid: 'alice', prefetched: { assignments: [] } });
  expect(result.content).toContain('已完成本人課務摘要');
  expect(mockReads).toContainEqual({
    path: 'users/alice/schools/pu/weeklyReports',
    constraints: [
      ['orderBy', 'generatedAt', 'desc'],
      ['limit', 1],
    ],
  });
});

test('the actual callable completes a model reply with real compose, tools, scoped daily data and conversation storage', async () => {
  mockDocuments.set('users/alice', { primarySchoolId: 'pu', role: 'student' });
  mockDocuments.set('schools/pu/members/alice', { status: 'active' });
  mockDocuments.set('users/alice/schools/pu/dailyBriefs', [
    row('today', { schoolId: 'pu', content: '本人今日摘要', generatedAt: new Date() }),
  ]);
  mockModel.mockResolvedValue({
    provider: 'test-model',
    model: 'test',
    content: '校方公告已更新，請查看公告頁的最新內容。\n建議：查看公告、近期活動',
    toolsInvoked: ['getAnnouncements'],
    cards: [],
    errors: [],
    transcriptMessages: [
      { role: 'user', content: '查公告' },
      { role: 'assistant', content: '校方公告已更新。' },
    ],
  });

  const result = await askCampusAssistant.run({
    auth: { uid: 'alice', token: { role: 'student' } },
    data: {
      messages: [{ role: 'user', content: '  查公告  ' }],
      context: { schoolId: 'untrusted-school', sessionId: 'verified-session' },
    },
  });

  expect(result).toMatchObject({
    schemaVersion: 1,
    content: '校方公告已更新，請查看公告頁的最新內容。',
    suggestions: ['查看公告', '近期活動'],
    assistantToolsUsed: ['getAnnouncements'],
    debug: { route: 'agent_model_rag', sourcesUsed: 4 },
    run: { status: 'completed' },
    intent: { name: 'announcements' },
  });
  const modelInput = mockModel.mock.calls[0][0];
  expect(modelInput.messages.at(-1)).toEqual({ role: 'user', content: '查公告' });
  expect(modelInput.messages[0].content).toContain('本人今日摘要');
  expect(modelInput.messages[0].content).toContain('getAnnouncements');
  expect(modelInput.messages[0].content).toContain('不能判定今天有沒有課');
  expect(modelInput.toolCtx.prefetched.prioritySummary).toMatchObject({
    classCount: null,
    scheduleStatus: 'unavailable',
  });
  expect(modelInput.toolCtx).toMatchObject({ uid: 'alice', schoolId: 'pu' });
  expect(mockReads.some(({ path }) => path.includes('untrusted-school'))).toBe(false);
  expect(mockReads).toContainEqual({
    path: 'users/alice/schools/pu/dailyBriefs',
    constraints: [
      ['orderBy', 'generatedAt', 'desc'],
      ['limit', 1],
    ],
  });
  expect(mockWrites).toContainEqual(
    expect.objectContaining({
      path: 'sessions/alice/conversations/verified-session',
      data: expect.objectContaining({
        messages: expect.arrayContaining([{ role: 'assistant', content: '校方公告已更新。' }]),
      }),
    }),
  );
});

test('the actual guest callable ignores client-supplied announcements when the model is unavailable', async () => {
  const result = await askCampusAssistant.run({
    data: {
      messages: [{ role: 'user', content: '查公告' }],
      context: { schoolId: 'pu', announcements: [{ id: 'fabricated', title: '客戶端捏造的公告' }] },
    },
    rawRequest: { ip: 'source-contract-guest' },
  });
  expect(result.content).toContain('校方發布的公告');
  expect(result.content).not.toContain('客戶端捏造的公告');
  expect(result.citations).toContainEqual(
    expect.objectContaining({ type: 'announcement', id: 'notice' }),
  );
  expect(result.run.status).toBe('completed');
});

test('the actual assignment callable returns own pending work and ignores fabricated client work', async () => {
  mockDocuments.set('users/alice', { schoolId: 'pu', role: 'student' });
  mockDocuments.set('schools/pu/members/alice', { status: 'active' });
  mockDocuments.set('users/alice/groups', [
    row('course', { groupId: 'course', schoolId: 'pu', type: 'course', status: 'active' }),
  ]);
  mockDocuments.set('groups/course', { schoolId: 'pu', type: 'course', name: '程式設計' });
  mockDocuments.set('groups/course/members/alice', { status: 'active', role: 'member' });
  mockDocuments.set('groups/course/assignments', [
    row('real', { title: '正式待繳作業', dueAt: new Date('2099-10-10') }),
  ]);
  const result = await askCampusAssistant.run({
    auth: { uid: 'alice', token: { role: 'student' } },
    data: {
      messages: [{ role: 'user', content: '查作業' }],
      context: { schoolId: 'pu', pendingAssignments: [{ id: 'fake', title: '客戶端假作業' }] },
    },
  });
  expect(result.content).toContain('正式待繳作業');
  expect(result.content).not.toContain('客戶端假作業');
  expect(result.intent.name).toBe('assignment_status');
  expect(result.citations).toContainEqual(
    expect.objectContaining({ type: 'assignment', id: 'real' }),
  );
  expect(mockModel.mock.calls[0][0].messages[0].content).toContain('正式待繳作業');
});

test('a private source failure cannot fall back to client homework or claim that nothing is due', async () => {
  mockDocuments.set('users/alice', { schoolId: 'pu', role: 'student' });
  mockDocuments.set('schools/pu/members/alice', { status: 'active' });
  mockDocuments.set('users/alice/groups', new Error('membership source offline'));
  await expect(
    askCampusAssistant.run({
      auth: { uid: 'alice', token: { role: 'student' } },
      data: {
        messages: [{ role: 'user', content: '查作業' }],
        context: { schoolId: 'pu', pendingAssignments: [] },
      },
    }),
  ).rejects.toThrow('membership source offline');
  const systemPrompt = mockModel.mock.calls[0][0].messages[0].content;
  expect(systemPrompt).toContain('"pendingAssignments":null');
  expect(systemPrompt).toContain('不能據此判定沒有作業');
});

test('the actual timetable question reports unavailable even when no model answer is returned', async () => {
  mockDocuments.set('users/alice', { schoolId: 'pu', role: 'student' });
  mockDocuments.set('schools/pu/members/alice', { status: 'active' });
  const result = await askCampusAssistant.run({
    auth: { uid: 'alice', token: { role: 'student' } },
    data: { messages: [{ role: 'user', content: '今天有什麼課' }], context: { schoolId: 'pu' } },
  });
  expect(result.content).toContain('助理目前無法讀取你的課表');
  expect(result.content).toContain('不能判定今天有沒有課');
  expect(result.content).not.toContain('今天沒有課');
  expect(result.run.status).toBe('completed');
});

test('a school change between runtime and core discards prefetched private data from the previous school', async () => {
  mockDocuments.set('users/alice', { schoolId: 'pu', role: 'student' });
  mockDocuments.set('schools/pu/members/alice', { status: 'active' });
  mockDocuments.set('schools/nthu/members/alice', { status: 'active' });
  mockDocuments.set('users/alice/schools/pu/dailyBriefs', [
    row('today', { schoolId: 'pu', content: '先前學校的私人摘要' }),
  ]);
  mockDocuments.set('schools/nthu/announcements', [
    row('notice-new', { schoolId: 'nthu', title: '目前學校的正式公告' }),
  ]);
  let profileReads = 0;
  mockReadHook = (path) => {
    if (path === 'users/alice' && ++profileReads === 2) {
      mockDocuments.set('users/alice', { schoolId: 'nthu', role: 'student' });
    }
  };
  const result = await askCampusAssistant.run({
    auth: { uid: 'alice', token: { role: 'student' } },
    data: { messages: [{ role: 'user', content: '查公告' }], context: { schoolId: 'pu' } },
  });
  expect(result.content).toContain('目前學校的正式公告');
  expect(result.content).not.toContain('校方發布的公告');
  const modelInput = mockModel.mock.calls[0][0];
  expect(modelInput.toolCtx.schoolId).toBe('nthu');
  expect(modelInput.messages[0].content).not.toContain('先前學校的私人摘要');
  expect(modelInput.toolCtx.prefetched).toEqual({});
});
