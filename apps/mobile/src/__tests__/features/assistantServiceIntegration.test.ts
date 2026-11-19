import AsyncStorage from '@react-native-async-storage/async-storage';
import type { PersonalImportRecord } from '@campus/shared';
import { ASSISTANT_SERVICES } from '@campus/shared/src/assistantServices';
import { askCampusAssistant, type CampusAssistantMessage } from '../../features/campusAssistant';
import { personalImportStorageKey } from '../../services/personalImports';

let mockUid: string | null = 'A';
let mockFake = false;
const mockCallable = jest.fn();
const mockCollect = jest.fn();
jest.mock('firebase/functions', () => ({ httpsCallable: jest.fn(() => mockCallable) }));
jest.mock('../../firebase', () => ({
  getAuthInstance: jest.fn(() => ({ currentUser: mockUid ? { uid: mockUid } : null })),
  getFunctionsInstance: jest.fn(() => ({})),
  isFirebaseMockMode: () => mockFake,
}));
jest.mock('../../services/onDeviceSchoolContext', () => ({
  collectOnDeviceSchoolContext: (...args: unknown[]) => mockCollect(...args),
  formatOnDeviceSchoolPrompt: () => 'device context',
}));
jest.mock('../../services/localLLMInference', () => ({
  localLLM: {
    getRuntimeAvailability: jest.fn(() => ({ available: false })),
    getSavedModelId: jest.fn(async () => null),
    getDownloadedModels: jest.fn(async () => []),
    isModelDownloaded: jest.fn(async () => false),
    getState: jest.fn(() => ({ status: 'idle' })),
    loadModel: jest.fn(), generate: jest.fn(),
  },
  getDefaultLocalLlmModelId: () => 'qwen2.5-0.5b',
}));

const accountId = 'pa_11111111-1111-4111-8111-111111111111';
const otherAccountId = 'pa_22222222-2222-4222-8222-222222222222';
const question = (content: string) => [{ role: 'user' as const, content }];
const input = (content: string) => ({
  scope: { uid: 'A', schoolId: 'pu' }, messages: question(content), isCurrent: () => true, mode: 'device' as const,
});
const platform = (content: string) => ({ ...input(content), scope: { uid: '', schoolId: 'pu' },
  platformTimetable: { accountId, isCurrent: () => true } });
const record = (overrides: Partial<PersonalImportRecord> = {}): PersonalImportRecord => ({
  id: 'grade-db', batchId: 'batch-1', kind: 'grades', title: '資料庫管理',
  schoolId: 'pu', academicYear: '115', semester: '1', courseCode: 'DB001', grade: '85', credits: 3,
  importedAt: '2026-11-06T10:00:00.000Z', source: { type: 'paste', line: 1, rawText: '原始匯入內容只留在裝置' },
  ...overrides,
});
const ledger = (records: PersonalImportRecord[]) => JSON.stringify({ version: 1, records,
  batches: [{ id: 'batch-1', count: 1, createdAt: '2026-11-06T10:00:00.000Z' }] });
async function save(owner: string, schoolId: string, records: PersonalImportRecord[]) {
  await AsyncStorage.setItem(personalImportStorageKey({ owner, schoolId }), ledger(records));
}

beforeEach(async () => {
  jest.clearAllMocks();
  mockUid = 'A'; mockFake = false;
  mockCallable.mockResolvedValue({ data: { content: '一般回答', run: { status: 'completed' }, actions: [] } });
  mockCollect.mockImplementation(async ({ uid, schoolId }) => ({ ownerUid: uid,
    checkedAt: new Date().toISOString(), schoolId, schoolName: '靜宜大學',
    timetable: { source: 'not-available', updatedAt: null, courses: [] } }));
  await AsyncStorage.clear();
});

test.each(['device', 'campus'] as const)('explicit opening in %s mode uses the catalog without a model, network or personal reads', async (mode) => {
  const answer = await askCampusAssistant({ ...input('幫我打開校園社群'), mode });
  expect(answer).toMatchObject({ source: 'device', tool: 'open-service', hasActions: false,
    serviceSelection: { kind: 'open', serviceIds: ['community'] } });
  expect(mockCallable).not.toHaveBeenCalled();
  expect(mockCollect).not.toHaveBeenCalled();
  expect(AsyncStorage.getItem).not.toHaveBeenCalled();
  const { localLLM } = require('../../services/localLLMInference');
  expect(localLLM.getRuntimeAvailability).not.toHaveBeenCalled();
  expect(localLLM.generate).not.toHaveBeenCalled();
});

test('platform account can discover every catalog destination and select a public service without Firebase', async () => {
  const answer = await askCampusAssistant(platform('你能做什麼？'));
  expect(answer.serviceSelection).toEqual({ kind: 'catalog', serviceIds: ASSISTANT_SERVICES.map((service) => service.id) });
  expect((await askCampusAssistant(platform('打開公車頁面'))).serviceSelection).toEqual({ kind: 'open', serviceIds: ['bus'] });
  expect(jest.requireMock('../../firebase').getAuthInstance).not.toHaveBeenCalled();
  expect(mockCollect).not.toHaveBeenCalled();
  expect(mockCallable).not.toHaveBeenCalled();
});

test.each([
  ['打開App餐廳訂單', 'app-orders'],
  ['打開教材收藏', 'material-bookmarks'],
  ['開啟職涯', 'career'],
  ['打開實習資訊', 'career'],
  ['前往校內工讀', 'career'],
])(
  'explicit %s retains its distinct service ID across platform and school assistants',
  async (content, id) => {
    for (const args of [platform(content), { ...input(content), mode: 'campus' as const }]) {
      const reply = await askCampusAssistant(args);
      expect(reply).toMatchObject({
        source: 'device',
        tool: 'open-service',
        hasActions: false,
        serviceSelection: { kind: 'open', serviceIds: [id] },
      });
    }
    expect(AsyncStorage.getItem).not.toHaveBeenCalled();
    expect(mockCollect).not.toHaveBeenCalled();
    expect(mockCallable).not.toHaveBeenCalled();
  },
);

test('a guest can select public career information without reading account or school data', async () => {
  mockUid = null;
  const answer = await askCampusAssistant({
    ...input('開啟職涯'),
    scope: { uid: '', schoolId: 'pu' },
  });
  expect(answer).toMatchObject({
    source: 'device',
    tool: 'open-service',
    hasActions: false,
    serviceSelection: { kind: 'open', serviceIds: ['career'] },
  });
  expect(jest.requireMock('../../firebase').getAuthInstance).not.toHaveBeenCalled();
  expect(AsyncStorage.getItem).not.toHaveBeenCalled();
  expect(mockCollect).not.toHaveBeenCalled();
  expect(mockCallable).not.toHaveBeenCalled();
});

test.each(['school', 'platform'] as const)(
  'applying for work study is not a completed operation or an open-service shortcut for %s',
  async (audience) => {
    const args = audience === 'school' ? input('申請工讀') : platform('申請工讀');
    if (audience === 'school') {
      // An ordinary request still needs a model; the public service cannot apply.
      await expect(askCampusAssistant(args)).rejects.toMatchObject({ code: 'native-unavailable' });
    } else {
      const answer = await askCampusAssistant(args);
      expect(answer).toMatchObject({
        source: 'device',
        tool: 'saved-timetable',
        hasActions: false,
      });
      expect(answer.serviceSelection).toBeUndefined();
      expect(answer.content).not.toMatch(/已(?:完成|送出|申請)/);
    }
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
    expect(mockCallable).not.toHaveBeenCalled();
    expect(
      jest.requireMock('../../services/localLLMInference').localLLM.generate,
    ).not.toHaveBeenCalled();
  },
);

test('existing assignment lookup remains a data query, not an open-service shortcut', async () => {
  const answer = await askCampusAssistant(input('我還有哪些作業待交？'));
  expect(answer.serviceSelection).toBeUndefined();
  expect(answer).toMatchObject({ source: 'device', tool: 'online-required', route: '/classroom' });
  expect(mockCollect).toHaveBeenCalledTimes(1);
});

test('a generic grade question in campus mode keeps the existing school source instead of substituting local imports', async () => {
  await save('firebase:A', 'pu', [record()]);
  const answer = await askCampusAssistant({ ...input('查我的成績'), mode: 'campus' });
  expect(answer.source).toBe('campus');
  expect(answer.academicRead).toBeUndefined();
  expect(mockCallable).toHaveBeenCalledWith(expect.objectContaining({ messages: question('查我的成績') }));
  expect(AsyncStorage.getItem).not.toHaveBeenCalled();
});

test('platform imported-grade read uses its exact account and school storage while preserving source literals', async () => {
  await save(`nuni:${accountId}`, 'pu', [record(), record({ id: 'letter', courseCode: 'CS002', title: '資訊倫理', grade: '通過', credits: 2 })]);
  await save(`nuni:${otherAccountId}`, 'pu', [record({ title: '另一帳號的成績', grade: '96' })]);
  await save(`nuni:${accountId}`, 'nthu', [record({ schoolId: 'nthu', title: '另一學校的成績' })]);
  const answer = await askCampusAssistant(platform('查我的匯入成績'));
  expect(answer).toMatchObject({ source: 'device', tool: 'saved-academics', hasActions: false,
    academicRead: { owner: `nuni:${accountId}`, schoolId: 'pu' },
    serviceSelection: { kind: 'open', serviceIds: ['import'] } });
  expect(answer.content).toContain('資料庫管理');
  expect(answer.content).toContain('85');
  expect(answer.content).toContain('通過');
  expect(answer.content).not.toContain('另一帳號');
  expect(answer.content).not.toContain('另一學校');
  expect(answer.content).not.toContain('原始匯入內容');
  expect(jest.mocked(AsyncStorage.getItem).mock.calls.map(([key]) => key))
    .toEqual([personalImportStorageKey({ owner: `nuni:${accountId}`, schoolId: 'pu' })]);
  expect(jest.requireMock('../../firebase').getAuthInstance).not.toHaveBeenCalled();
  expect(mockCollect).not.toHaveBeenCalled();
  expect(mockCallable).not.toHaveBeenCalled();
});

test('campus imported-credit read uses Firebase ownership but does not query live school services', async () => {
  await save('firebase:A', 'pu', [record(), record({ id: 'b', courseCode: 'MAT001', title: '統計學', credits: 2, grade: '待公布' })]);
  await save('firebase:B', 'pu', [record({ title: 'B 的紀錄' })]);
  const answer = await askCampusAssistant({ ...input('查我匯入的學分紀錄'), mode: 'campus' });
  expect(answer).toMatchObject({ source: 'device', tool: 'saved-academics', academicRead: { owner: 'firebase:A', schoolId: 'pu' } });
  expect(answer.content).toContain('資料庫管理');
  expect(answer.content).toContain('統計學');
  expect(answer.content).not.toContain('B 的紀錄');
  expect(answer.content).not.toMatch(/已取得\s*5|已修得\s*5/);
  expect(mockCallable).not.toHaveBeenCalled();
});

test.each(['guest', 'mock'] as const)('%s cannot read a personal academic ledger', async (kind) => {
  await save('firebase:A', 'pu', [record()]);
  if (kind === 'mock') mockFake = true;
  else mockUid = null;
  const answer = await askCampusAssistant({ ...input('查我的匯入成績'), scope: { uid: kind === 'guest' ? '' : 'A', schoolId: 'pu' } });
  expect(answer.content).toContain('請先登入');
  expect(answer.content).not.toContain('資料庫管理');
  expect(AsyncStorage.getItem).not.toHaveBeenCalled();
});

test('malformed or wrong-school storage does not turn into an empty or successful transcript', async () => {
  await save(`nuni:${accountId}`, 'pu', [record({ schoolId: 'nthu', title: '不該看見的課程' })]);
  const answer = await askCampusAssistant(platform('查我的匯入成績'));
  expect(answer.tool).toBe('saved-academics');
  expect(answer.content).toMatch(/無法|未能/);
  expect(answer.content).not.toContain('不該看見的課程');
  expect(mockCallable).not.toHaveBeenCalled();
});

test.each(['account', 'school', 'platform'] as const)('late academic storage after %s change is discarded', async (kind) => {
  let resolve!: (value: string) => void;
  let current = true;
  let platformCurrent = true;
  jest.mocked(AsyncStorage.getItem).mockImplementationOnce(() => new Promise((yes) => { resolve = yes; }));
  const args = kind === 'account' ? input('查我的匯入成績') : platform('查我的匯入成績');
  const pending = askCampusAssistant({ ...args, isCurrent: () => current,
    ...(kind !== 'account' && { platformTimetable: { accountId, isCurrent: () => platformCurrent } }) });
  for (let i = 0; i < 5 && !resolve; i++) await Promise.resolve();
  expect(resolve).toBeDefined();
  if (kind === 'account') mockUid = 'B';
  else if (kind === 'school') current = false;
  else platformCurrent = false;
  resolve(ledger([record()]));
  await expect(pending).rejects.toMatchObject({ code: 'session-changed' });
});

test.each(['device', 'campus'] as const)('cancelling an academic read in %s mode releases the wait and ignores storage that finishes later', async (mode) => {
  const controller = new AbortController();
  let resolve!: (value: string) => void;
  jest.mocked(AsyncStorage.getItem).mockImplementationOnce(() => new Promise((yes) => { resolve = yes; }));
  const args = mode === 'device' ? platform('查我的匯入成績') : input('查我的匯入成績');
  const pending = askCampusAssistant({ ...args, mode, signal: controller.signal });
  for (let i = 0; i < 5 && !resolve; i++) await Promise.resolve();
  controller.abort();
  await expect(pending).rejects.toMatchObject({ code: 'cancelled' });
  resolve(ledger([record()]));
  await Promise.resolve();
  expect(mockCallable).not.toHaveBeenCalled();
});

test('a later campus request excludes local academic results and their preceding question from model history', async () => {
  const messages: CampusAssistantMessage[] = [
    { role: 'user', content: '查我的匯入成績' },
    { role: 'assistant', content: '私人課程：成績 85', tool: 'saved-academics',
      academicRead: { owner: 'firebase:A', schoolId: 'pu', checkedAt: new Date().toISOString() } },
    { role: 'user', content: '這週有哪些校園活動？' },
  ];
  await askCampusAssistant({ ...input(''), mode: 'campus', messages });
  expect(mockCallable).toHaveBeenCalledWith(expect.objectContaining({
    messages: [{ role: 'user', content: '這週有哪些校園活動？' }],
  }));
});

test.each(['device', 'campus'] as const)(
  'later %s inference keeps ordinary context while excluding a source-backed plan and its question',
  async (mode) => {
    const privateQuestion = '幫我安排未公開專題「個人收入預測」與課堂小考';
    const privatePlan = '私人作業：收入預測報告，11/9 23:59 截止。私人測驗：資料庫期中小考。';
    const ordinaryHistory: CampusAssistantMessage[] = [
      { role: 'user', content: '回答請用繁體中文。' },
      { role: 'assistant', content: '可以，我會使用繁體中文。' },
    ];
    const currentQuestion = { role: 'user' as const, content: '請用簡單例子解釋二分搜尋。' };
    const messages: CampusAssistantMessage[] = [
      ...ordinaryHistory,
      { role: 'user', content: privateQuestion },
      { role: 'assistant', content: privatePlan, tool: 'campus-plan' },
      currentQuestion,
    ];
    const { localLLM } = require('../../services/localLLMInference');
    if (mode === 'device') {
      localLLM.getRuntimeAvailability.mockReturnValueOnce({ available: true });
      localLLM.isModelDownloaded.mockResolvedValueOnce(true);
      localLLM.getState
        .mockReturnValueOnce({ status: 'ready', modelId: 'qwen2.5-0.5b' })
        .mockReturnValueOnce({ status: 'ready', modelId: 'qwen2.5-0.5b' });
      // Exercise both model entry points: tool selection, then ordinary chat.
      mockCollect.mockResolvedValueOnce({ ownerUid: 'A', schoolId: 'pu', schoolName: '靜宜大學',
        checkedAt: new Date().toISOString(),
        timetable: { source: 'saved-device-copy', updatedAt: new Date().toISOString(), courses: [] } });
      localLLM.generate
        .mockResolvedValueOnce({ content: '{"v":1,"calls":[]}', finishReason: 'stop' })
        .mockResolvedValueOnce({ content: '一般回答', finishReason: 'stop' });
    }

    const result = await askCampusAssistant({ ...input(''), mode, messages });
    expect(result).toMatchObject({ source: mode, content: '一般回答' });
    const expectedMessages = [...ordinaryHistory, currentQuestion];
    if (mode === 'campus') {
      expect(mockCallable).toHaveBeenCalledWith(expect.objectContaining({ messages: expectedMessages }));
      expect(localLLM.generate).not.toHaveBeenCalled();
    } else {
      expect(localLLM.generate).toHaveBeenCalledTimes(2);
      const selectionPrompt = localLLM.generate.mock.calls[0][0].messages;
      expect(JSON.parse(selectionPrompt[1].content)).toEqual({
        history: ordinaryHistory.map((message) => ({ role: message.role, text: message.content, truncated: false })),
        current: currentQuestion.content,
      });
      expect(localLLM.generate.mock.calls[1][0].messages).toEqual([
        { role: 'system', content: 'device context' }, ...expectedMessages,
      ]);
      expect(mockCallable).not.toHaveBeenCalled();
    }
    // The private result remains visible to its owner; only model input is projected.
    expect(messages).toHaveLength(5);
    expect(messages[3]).toEqual({ role: 'assistant', content: privatePlan, tool: 'campus-plan' });
  },
);
