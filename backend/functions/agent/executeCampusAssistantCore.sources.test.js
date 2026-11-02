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
const mockCloudNavigationTask = jest.fn();

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
jest.mock('./cloudNavigationTask', () => ({
  handleCloudNavigationTask: (...args) => mockCloudNavigationTask(...args),
}));

// Legacy behavior remains tested directly below the public callable boundary.
// The callable must reject legacy requests before entering any of these readers.
const { executeCampusAssistantCore } = require('./executeCampusAssistantCore');
const legacyRuntime = require('./runtime');
const runLegacy = jest.spyOn(legacyRuntime, 'runCampusAssistantWithAgentRuntime');
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
  mockCloudNavigationTask.mockReset().mockResolvedValue({ phase: 'preview' });
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
  ['conversation and session', {
    messages: [{ role: 'user', content: '查公告' }],
    context: { schoolId: 'pu', sessionId: 'private-session' },
  }],
  ['assignment request with client data', {
    messages: [{ role: 'user', content: '查作業' }],
    context: { schoolId: 'pu', pendingAssignments: [{ title: '私人作業' }] },
  }],
  ['old question field', { question: '今天有什麼課', context: { schoolId: 'pu' } }],
  ['unbound consent flag', { messages: [{ role: 'user', content: '查課表' }], consent: true }],
  ['unknown task', { task: 'private-schedule', phase: 'execute' }],
  ['4000-character message', { messages: [{ role: 'user', content: '問'.repeat(4000) }] }],
  ['old ordering request', { messages: [{ role: 'user', content: '幫我點一份雞腿飯' }] }],
])('the public callable rejects %s before legacy readers, runtime, storage or models', async (_label, data) => {
  mockDocuments.set('users/alice', { schoolId: 'pu', role: 'student' });
  mockDocuments.set('schools/pu/members/alice', { status: 'active' });
  mockDocuments.set('users/alice/schools/pu/dailyBriefs', [
    row('today', { schoolId: 'pu', content: '不應讀取的私人摘要' }),
  ]);
  await expect(askCampusAssistant.run({
    auth: { uid: 'alice', token: { role: 'student' } },
    data,
  })).rejects.toMatchObject({
    code: 'failed-precondition',
    message: '請先預覽並確認要傳送的公開地點資料。',
    details: { reason: 'cloud-consent-required' },
  });
  expect(mockReads.map(({ path }) => path)).toEqual(['users/alice']);
  expect(mockWrites).toEqual([]);
  expect(runLegacy).not.toHaveBeenCalled();
  expect(mockModel).not.toHaveBeenCalled();
  expect(mockWebSearch).not.toHaveBeenCalled();
  expect(mockCloudNavigationTask).not.toHaveBeenCalled();
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
    expect(mockWebSearch).toHaveBeenCalledWith('查詢校園公開資料', { schoolId: 'pu' });
  },
);

test('web search fallback forwards the selected authorized schoolId', async () => {
  mockWebSearch.mockResolvedValueOnce({
    content: 'NTU 路線摘要',
    sources: [{ title: 'Maps', url: 'https://maps.example', snippet: 'route', source: 'Google Maps' }],
    confidence: 'medium',
    suggestions: ['看來源'],
  });
  const result = await executeCampusAssistantCore({
    request: {
      auth: null,
      data: {
        messages: [{ role: 'user', content: '怎麼去火車站？' }],
        context: { schoolId: 'ntu' },
      },
    },
    runId: 'school-web-forward',
    startedAt: Date.now(),
    routingIntent: 'general',
  });
  expect(mockWebSearch).toHaveBeenCalledWith('怎麼去火車站？', { schoolId: 'ntu' });
  expect(result.content).toContain('NTU 路線摘要');
  expect(result.debug.route).toBe('agent_web_search');
});

test('an authenticated profile does not authorize a different selected campus', async () => {
  mockDocuments.set('users/alice', {
    primarySchoolId: 'pu',
    schoolId: 'old-school',
    role: 'student',
  });
  mockDocuments.set('schools/pu/members/alice', { status: 'active' });
  await expect(
    run('announcements', { uid: 'alice', schoolId: 'model-selected-school' }),
  ).rejects.toMatchObject({ code: 'permission-denied' });
  expect(mockModel).not.toHaveBeenCalled();
  expect(mockReads.some((read) => read.path === 'schools/model-selected-school/announcements')).toBe(false);
  expect(mockReads.some((read) => read.path === 'schools/pu/announcements')).toBe(false);
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
  // 模型沒有回答時不拿摘要充當答案，但讀取範圍還是限定在驗證過的學校
  expect(result.content).toBe('助理暫時沒辦法回答，請稍後再試。');
  expect(result.content).not.toContain('最值得先關注');
  expect(mockReads).toContainEqual({
    path: 'users/alice/schools/pu/weeklyReports',
    constraints: [
      ['orderBy', 'generatedAt', 'desc'],
      ['limit', 1],
    ],
  });
});

test('the internal legacy runtime completes a model reply with real compose, tools, scoped daily data and conversation storage', async () => {
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

  const result = await runLegacy({
    auth: { uid: 'alice', token: { role: 'student' } },
    data: {
      messages: [{ role: 'user', content: '  查公告  ' }],
      context: { schoolId: 'pu', sessionId: 'verified-session' },
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

test('the actual guest callable is unauthenticated before it can use client-supplied announcements', async () => {
  await expect(
    askCampusAssistant.run({
      data: {
        messages: [{ role: 'user', content: '查公告' }],
        context: { schoolId: 'pu', announcements: [{ id: 'fabricated', title: '客戶端捏造的公告' }] },
      },
      rawRequest: { ip: 'source-contract-guest' },
    }),
  ).rejects.toMatchObject({ code: 'unauthenticated' });
});

test('the internal legacy runtime returns own pending work and ignores fabricated client work', async () => {
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
  const result = await runLegacy({
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
    runLegacy({
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

test('the internal legacy timetable path reports unavailable even when no model answer is returned', async () => {
  mockDocuments.set('users/alice', { schoolId: 'pu', role: 'student' });
  mockDocuments.set('schools/pu/members/alice', { status: 'active' });
  const result = await runLegacy({
    auth: { uid: 'alice', token: { role: 'student' } },
    data: { messages: [{ role: 'user', content: '今天有什麼課' }], context: { schoolId: 'pu' } },
  });
  // 模型沒有回答：照實說沒辦法回答，不會說成今天沒有課
  expect(result.content).toBe('助理暫時沒辦法回答，請稍後再試。');
  expect(result.content).not.toContain('今天沒有課');
  expect(result.content).not.toContain('最值得先關注');
});

describe('舊 runtime 的內部回覆行為（公開 callable 不再委派）', () => {
  const ask = (content) =>
    runLegacy({
      auth: { uid: 'alice', token: { role: 'student', name: '測試學生甲' } },
      data: { messages: [{ role: 'user', content }], context: { schoolId: 'pu' } },
    });
  beforeEach(() => {
    mockDocuments.set('users/alice', { schoolId: 'pu', role: 'student', displayName: '測試學生甲' });
    mockDocuments.set('schools/pu/members/alice', { status: 'active' });
  });

  test('沒有金鑰', async () => {
    const result = await ask('學校說期末考取消了嗎');
    expect(result.content).toBe('助理暫時沒辦法回答，請稍後再試。');
    expect(result.content).not.toMatch(/最值得先關注|最新公告|我目前最適合/);
  });

  test('網頁版沒有群組：寫進 agentRuns 的資料不帶 undefined（Firestore 會整筆拒收）', async () => {
    const hasUndefined = (value) =>
      value === undefined ||
      (value && typeof value === 'object' && Object.values(value).some((item) => hasUndefined(item)));
    const result = await ask('學校說期末考取消了嗎');
    expect(result.content).toBe('助理暫時沒辦法回答，請稍後再試。');
    const runs = mockWrites.filter((write) => write.path.includes('/agentRuns/'));
    expect(runs.length).toBeGreaterThan(0);
    for (const write of runs) expect(hasUndefined(write.data)).toBe(false);
    const steps = runs.flatMap((write) => write.data.steps || []);
    const assignments = steps.find((step) => step.tool === 'getAssignments');
    if (assignments) expect('groupId' in assignments.input).toBe(false);
  });

  test('問題對得上公告：沒有模型也用那則公告回答', async () => {
    mockDocuments.set('schools/pu/announcements', [
      row('lib', { title: '圖書館國慶日閉館', schoolId: 'pu', publishedAt: new Date('2026-10-08T00:00:00Z') }),
      row('dorm', { title: '宿舍週末停水', schoolId: 'pu', publishedAt: new Date('2026-10-07T00:00:00Z') }),
    ]);
    const result = await ask('國慶日閉館的公告');
    expect(result.content).toContain('圖書館國慶日閉館');
    expect(result.content).not.toContain('宿舍週末停水');
  });

  test('問地點但找到的地點對不上：不硬塞那個地點，回統一的失敗句', async () => {
    const result = await ask('體育館怎麼走');
    expect(result.content).not.toContain('找到「校園地點」');
    expect(result.content).toBe('助理暫時沒辦法回答，請稍後再試。');
    expect(result.content).not.toContain('找不到符合的校園地點');
    expect(result.actions || []).toEqual([]);
  });

  test('活動時間用台灣時間：UTC 前一天 18:35 要寫成隔天 02:35', async () => {
    mockDocuments.set('schools/pu/clubEvents', [
      row('fair', {
        title: '社團博覽會',
        schoolId: 'pu',
        location: '主顧廣場',
        startsAt: new Date('2099-10-12T18:35:00Z'),
      }),
    ]);
    const result = await ask('近期有什麼活動');
    expect(result.content).toContain('社團博覽會（主顧廣場），10 月 13 日（二）02:35');
    expect(result.content).not.toContain('10/12/2099');
    expect(result.content).not.toContain('18:35');
  });

  test('存下來的活動、公告回覆只寫絕對日期，沒有今天、明天這類相對的字', async () => {
    mockDocuments.set('schools/pu/clubEvents', [
      row('soon', { title: '社團博覽會', schoolId: 'pu', location: '主顧廣場', startsAt: new Date(Date.now() + 2 * 60 * 60 * 1000) }),
      row('next', { title: '迎新茶會', schoolId: 'pu', location: '活動中心', startsAt: new Date(Date.now() + 26 * 60 * 60 * 1000) }),
    ]);
    mockDocuments.set('schools/pu/announcements', [
      row('net', { title: '宿舍網路凌晨維修', schoolId: 'pu', publishedAt: new Date(Date.now() - 60 * 60 * 1000) }),
    ]);
    const relative = /今天|明天|後天|昨天|今日|明日/;
    const events = await ask('近期有什麼活動');
    expect(events.content).toContain('社團博覽會');
    expect(events.content).toMatch(/\d{1,2} 月 \d{1,2} 日（[日一二三四五六]）\d{2}:\d{2}/);
    expect(events.content).not.toMatch(relative);
    const announcements = await ask('最新公告有哪些');
    expect(announcements.content).toContain('宿舍網路凌晨維修（');
    expect(announcements.content).not.toMatch(relative);
  });

  test('有模型時，系統提示要求只寫台灣時間的絕對日期，不用今天、明天、後天', async () => {
    mockDocuments.set('schools/pu/clubEvents', [
      row('fair', { title: '社團博覽會', schoolId: 'pu', startsAt: new Date('2099-10-12T18:35:00Z') }),
    ]);
    await ask('近期有什麼活動');
    const systemPrompt = mockModel.mock.calls[0][0].messages[0].content;
    expect(systemPrompt).toContain('10 月 13 日（二）02:35');
    expect(systemPrompt).toContain('不要用「今天、明天、後天、昨天」');
    expect(systemPrompt).not.toContain('2099-10-12T18:35');
  });

  test('公告時間也用台灣時間', async () => {
    mockDocuments.set('schools/pu/announcements', [
      row('net', {
        title: '宿舍網路 10/14 凌晨維修',
        schoolId: 'pu',
        publishedAt: new Date('2026-10-11T17:20:00Z'),
      }),
    ]);
    const result = await ask('最新公告有哪些');
    expect(result.content).toContain('宿舍網路 10/14 凌晨維修（10 月 12 日（一）01:20）');
  });

  test('問宿舍網路什麼時候維修：有對得上的維修公告就用公告回答，不整理報修草稿', async () => {
    mockDocuments.set('schools/pu/announcements', [
      row('net', {
        title: '宿舍網路 10/14 凌晨維修',
        body: '10 月 14 日凌晨 1 點到 5 點宿舍網路維修，期間無法連線。',
        schoolId: 'pu',
        publishedAt: new Date('2026-10-11T17:20:00Z'),
      }),
      row('lib', { title: '期中考週圖書館延長開放至晚上 11 點', schoolId: 'pu', publishedAt: new Date('2026-10-10T02:00:00Z') }),
    ]);
    const result = await ask('宿舍網路什麼時候維修');
    expect(result.content).toContain('宿舍網路 10/14 凌晨維修');
    expect(result.content).not.toContain('圖書館延長開放');
    expect(result.content).not.toContain('報修草稿');
    expect(JSON.stringify(result.actions || [])).not.toContain('createDormRepairRequest');
    expect(mockWrites.some((write) => write.path.includes('assistantActionQueue') || write.path.includes('repair'))).toBe(false);
  });

  test.each([
    ['宿舍網路什麼時候維修', '10 月 14 日（三）01:00–05:00 宿舍網路維修，期間無法連線。', '01:00–05:00'],
    ['宿舍網路維修的時段是幾點', '本週宿舍網路調整。10 月 14 日凌晨 1 點到 5 點停機維修。', '凌晨 1 點到 5 點'],
  ])('問「%s」：回答帶出公告內文裡的維修時段', async (question, body, window) => {
    mockDocuments.set('schools/pu/announcements', [
      row('net', { title: '宿舍網路 10/14 凌晨維修', body, schoolId: 'pu', publishedAt: new Date('2026-10-11T13:00:00Z') }),
    ]);
    const result = await ask(question);
    expect(result.content).toContain('宿舍網路 10/14 凌晨維修（10 月 11 日（日）21:00）');
    expect(result.content).toContain(`時段：`);
    expect(result.content).toContain(window);
    expect(result.content).not.toContain('報修草稿');
  });

  test('內文講時段的句子用「明天」：不帶出來，免得日後讀到指錯天', async () => {
    mockDocuments.set('schools/pu/announcements', [
      row('net', { title: '宿舍網路 10/14 凌晨維修', body: '明天凌晨 1 點到 5 點宿舍網路維修。', schoolId: 'pu', publishedAt: new Date('2026-10-11T13:00:00Z') }),
    ]);
    const result = await ask('宿舍網路什麼時候維修');
    expect(result.content).toContain('宿舍網路 10/14 凌晨維修');
    expect(result.content).not.toContain('時段：');
    expect(result.content).not.toMatch(/今天|明天|後天/);
  });

  test.each([
    ['內文完全沒提時間', '宿舍網路近期將進行維修，詳情另行公告。'],
    ['只說「下午」沒有鐘點', '宿舍網路下午會有人員進行維修，請多包涵。'],
    ['只有日期沒有時段', '10 月 14 日宿舍網路維修。'],
    ['內文是空的', ''],
  ])('問維修時間，但公告內文%s：整行「時段：」都不出現，不留空也不編', async (_label, body) => {
    mockDocuments.set('schools/pu/announcements', [
      row('net', { title: '宿舍網路維修通知', body, schoolId: 'pu', publishedAt: new Date('2026-10-11T13:00:00Z') }),
    ]);
    const result = await ask('宿舍網路什麼時候維修');
    expect(result.content).toContain('宿舍網路維修通知（10 月 11 日（日）21:00）');
    expect(result.content).not.toContain('時段');
    expect(result.content).not.toMatch(/\d{1,2}:\d{2}–/);
  });

  test('內文自己寫「維修時段：」：回覆只有一個「時段：」，不會變成「時段：維修時段：」', async () => {
    mockDocuments.set('schools/pu/announcements', [
      row('net', { title: '宿舍網路 10/14 凌晨維修', body: '各位同學好。\n維修時段：10 月 14 日（三）01:00–05:00\n期間無法連線。', schoolId: 'pu', publishedAt: new Date('2026-10-11T13:00:00Z') }),
    ]);
    const result = await ask('宿舍網路什麼時候維修');
    expect(result.content).toContain('時段：10 月 14 日（三）01:00–05:00');
    expect(result.content).not.toContain('時段：維修時段');
    expect(result.content.match(/時段：/g)).toHaveLength(1);
  });

  test('只問有什麼公告：不加時段那一行', async () => {
    mockDocuments.set('schools/pu/announcements', [
      row('net', { title: '宿舍網路 10/14 凌晨維修', body: '10 月 14 日 01:00–05:00 維修。', schoolId: 'pu', publishedAt: new Date('2026-10-11T13:00:00Z') }),
    ]);
    const result = await ask('最新公告有哪些');
    expect(result.content).not.toContain('時段：');
  });

  test('問宿舍網路什麼時候維修，但沒有維修公告：照實說沒辦法回答', async () => {
    const result = await ask('宿舍網路什麼時候維修');
    expect(result.content).toBe('助理暫時沒辦法回答，請稍後再試。');
    expect(result.content).not.toContain('報修草稿');
    expect(result.content).not.toContain('校方發布的公告');
  });

  test('只問「有什麼公告」：列出公告', async () => {
    const result = await ask('今天有什麼公告');
    expect(result.content).toContain('校方發布的公告');
  });

  test('問的是公告，但查到的公告都對不上：照實說沒辦法回答，不塞不相關的公告', async () => {
    const result = await ask('期末考取消的公告');
    expect(result.content).toBe('助理暫時沒辦法回答，請稍後再試。');
    expect(result.content).not.toContain('校方發布的公告');
  });

  test('問的是活動，但沒有對得上的活動：照實說沒辦法回答', async () => {
    mockDocuments.set('schools/pu/events', [
      row('e1', { title: '社團博覽會', schoolId: 'pu', startsAt: new Date(Date.now() + 86400000) }),
    ]);
    const result = await ask('有沒有獎學金說明會的活動');
    expect(result.content).toBe('助理暫時沒辦法回答，請稍後再試。');
    expect(result.content).not.toContain('社團博覽會');
  });

  test('模型出錯', async () => {
    mockModel.mockRejectedValue(new Error('upstream 500'));
    const result = await ask('學校說期末考取消了嗎');
    expect(result.content).toBe('助理暫時沒辦法回答，請稍後再試。');
  });

  test('模型逾時', async () => {
    process.env.ASSISTANT_MODEL_TIMEOUT_MS = '30';
    mockModel.mockImplementation(() => new Promise(() => {}));
    try {
      const result = await ask('學校說期末考取消了嗎');
      expect(result.content).toBe('助理暫時沒辦法回答，請稍後再試。');
    } finally {
      delete process.env.ASSISTANT_MODEL_TIMEOUT_MS;
    }
  });
});

test('a profile school change during an assistant run never overrides the selected authorized campus', async () => {
  mockDocuments.set('users/alice', { schoolId: 'pu', role: 'student' });
  mockDocuments.set('schools/pu/members/alice', { status: 'active' });
  mockDocuments.set('schools/nthu/members/alice', { status: 'active' });
  mockDocuments.set('users/alice/schools/pu/dailyBriefs', [
    row('today', { schoolId: 'pu', content: '目前選擇學校的私人摘要' }),
  ]);
  mockDocuments.set('schools/nthu/announcements', [
    row('notice-new', {
      schoolId: 'nthu',
      title: '其他學校的正式公告',
      publishedAt: new Date('2026-10-08T00:00:00Z'),
    }),
  ]);
  let profileReads = 0;
  mockReadHook = (path) => {
    if (path === 'users/alice' && ++profileReads === 3) {
      mockDocuments.set('users/alice', { schoolId: 'nthu', role: 'student' });
    }
  };
  const result = await runLegacy({
    auth: { uid: 'alice', token: { role: 'student' } },
    data: { messages: [{ role: 'user', content: '查公告' }], context: { schoolId: 'pu' } },
  });
  expect(result.content).toContain('校方發布的公告');
  expect(result.content).not.toContain('其他學校的正式公告');
  const modelInput = mockModel.mock.calls[0][0];
  expect(modelInput.toolCtx.schoolId).toBe('pu');
  expect(modelInput.messages[0].content).toContain('目前選擇學校的私人摘要');
  expect(mockReads.some(({ path }) => path === 'schools/nthu/announcements')).toBe(false);
});

test('an active member can select their other campus without fetching default-campus data', async () => {
  mockDocuments.set('users/alice', { schoolId: 'pu', role: 'student' });
  mockDocuments.set('schools/pu/members/alice', { status: 'active' });
  mockDocuments.set('schools/nthu/members/alice', { status: 'active' });
  mockDocuments.set('schools/nthu/announcements', [
    row('notice-nthu', { schoolId: 'nthu', title: '清華校區正式公告', publishedAt: new Date('2026-10-08T00:00:00Z') }),
  ]);
  const result = await run('announcements', { uid: 'alice', schoolId: 'nthu' });
  expect(result.content).toContain('清華校區正式公告');
  expect(result.content).not.toContain('校方發布的公告');
  expect(mockModel.mock.calls[0][0].toolCtx.schoolId).toBe('nthu');
  expect(mockReads.some(({ path }) => path === 'schools/pu/announcements')).toBe(false);
});

test('the internal legacy runtime preserves the tail of a 4000-character question for the model', async () => {
  mockDocuments.set('users/alice', { schoolId: 'pu', role: 'student' });
  mockDocuments.set('schools/pu/members/alice', { status: 'active' });
  const suffix = '最後條件：請依公告原文回答。';
  const content = ('請查詢校園公告。' + '以下是補充背景。'.repeat(600)).slice(0, 4000 - suffix.length) + suffix;
  mockModel.mockResolvedValue({ provider: 'test-model', content: '已根據公告資料整理回覆。', errors: [], cards: [] });
  const result = await runLegacy({
    auth: { uid: 'alice', token: { role: 'student' } },
    data: { messages: [{ role: 'user', content }], context: { schoolId: 'pu' } },
    rawRequest: { ip: 'long-question-test' },
  });
  expect(content).toHaveLength(4000);
  expect(result.run.status).toBe('completed');
  expect(mockModel.mock.calls[0][0].messages.at(-1)).toEqual({ role: 'user', content });
  expect(mockWebSearch).toHaveBeenCalledWith(content.slice(0, 500), { schoolId: 'pu' });
});

describe('舊 runtime 的線上點餐停用保護（直接內部測試）', () => {
  const saved = process.env.ONLINE_ORDERING_ENABLED;
  beforeEach(() => {
    process.env.ONLINE_ORDERING_ENABLED = 'false';
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.ONLINE_ORDERING_ENABLED;
    else process.env.ONLINE_ORDERING_ENABLED = saved;
  });

  test('學生說「幫我點一份雞腿飯」，回「目前還不能線上點餐」', async () => {
    mockDocuments.set('users/alice', { primarySchoolId: 'pu', role: 'student' });
    mockDocuments.set('schools/pu/members/alice', { status: 'active' });
    mockDocuments.set('schools/pu/cafeterias/cafe', { name: '學生餐廳', orderingEnabled: true });
    mockDocuments.set('schools/pu/cafeterias', [row('cafe', { name: '學生餐廳', schoolId: 'pu', orderingEnabled: true })]);
    mockDocuments.set('schools/pu/menus', [row('rice', { name: '雞腿飯', schoolId: 'pu', cafeteriaId: 'cafe', price: 100 })]);

    const result = await runLegacy({
      auth: { uid: 'alice', token: { role: 'student' } },
      data: { messages: [{ role: 'user', content: '幫我點一份雞腿飯' }], context: { schoolId: 'pu' } },
    });

    expect(result.content).toBe('目前還不能線上點餐');
    expect(result.content).not.toMatch(/草稿|確認後會送出/);
    const cards = Array.isArray(result.cards) ? result.cards : [];
    expect(cards.some((card) => ['order_draft_card', 'order_submitted'].includes(card.kind))).toBe(false);
    const actions = Array.isArray(result.actions) ? result.actions : [];
    expect(JSON.stringify(actions)).not.toContain('createOrder');
    expect(mockWrites.some(({ path }) => /(^|\/)orders\/|_orderRequests|queueCounters/.test(path))).toBe(false);
  });
});
