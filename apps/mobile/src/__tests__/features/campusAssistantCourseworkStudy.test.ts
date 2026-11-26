import AsyncStorage from '@react-native-async-storage/async-storage';
import { askCampusAssistant, type CampusAssistantMessage } from '../../features/campusAssistant';
import type { CourseworkRead } from '../../features/nuniCourseworkFollowUp';
import * as execution from '../../services/assistantCalendarExecution';
import * as batchExecution from '../../services/assistantCalendarBatchExecution';

const mockCallable = jest.fn();
jest.mock('firebase/functions', () => ({ httpsCallable: jest.fn(() => mockCallable) }));
jest.mock('../../firebase', () => ({
  getAuthInstance: () => ({ currentUser: { uid: 'A' } }), getFunctionsInstance: () => ({}), isFirebaseMockMode: () => false,
}));
jest.mock('../../services/localLLMInference', () => ({
  localLLM: {
    getRuntimeAvailability: jest.fn(() => ({ available: true })), getSavedModelId: jest.fn(async () => null),
    isModelDownloaded: jest.fn(async () => true), getDownloadedModels: jest.fn(async () => ['qwen2.5-0.5b']),
    getState: jest.fn(() => ({ status: 'ready', modelId: 'qwen2.5-0.5b' })), loadModel: jest.fn(async () => true),
    generate: jest.fn(async () => ({ content: 'announcement', tokensGenerated: 3 })),
  }, getDefaultLocalLlmModelId: () => 'qwen2.5-0.5b',
}));
jest.mock('../../services/onDeviceSchoolContext', () => ({
  collectOnDeviceSchoolContext: jest.fn(async () => ({ ownerUid: 'A', checkedAt: new Date().toISOString(),
    schoolId: 'pu', schoolName: '靜宜大學', timetable: { source: 'not-available', updatedAt: null, courses: [] } })),
  formatOnDeviceSchoolPrompt: jest.fn(() => '本機上下文'),
}));
const localLLM = jest.requireMock('../../services/localLLMInference').localLLM;
const read: CourseworkRead = {
  anchor: { uid: '', owner: 'nuni:student-a', schoolId: 'pu', updatedAt: null, classes: [{ courseId: 'db', term: '115|1',
    name: '資料庫', date: '2026-11-05', room: 'A2', startTime: '10:10', endTime: '12:00' }] },
  checkedAt: '2026-11-08T02:30:00Z', result: { kind: 'assignments', limited: false,
    workspace: { id: 'workspace-a', title: '資料庫 A 班' }, assignments: [
      { id: 'first', title: '期末報告', dueAt: '2099-01-03T10:00:00Z', state: 'open', submittedAt: null },
      { id: 'second', title: '期末報告', dueAt: '2099-01-04T10:00:00Z', state: 'open', submittedAt: null },
    ],
  },
};
const input = (question: string, snapshot: CourseworkRead | undefined = read) => ({
  scope: { uid: '', schoolId: 'pu' }, platformTimetable: { accountId: 'student-a', isCurrent: () => true },
  isCurrent: () => true,
  messages: [...(snapshot ? [{ role: 'assistant' as const, content: '課堂作業', courseworkRead: snapshot }] : []),
    { role: 'user' as const, content: question }],
});
beforeEach(async () => {
  await AsyncStorage.clear(); jest.clearAllMocks();
  mockCallable.mockResolvedValue({ data: { content: '回答', run: { status: 'completed' }, actions: [] } });
});
afterEach(() => jest.restoreAllMocks());

test.each([
  '幫這份作業 2099-01-02 19:00 到 19:30 安排準備',
  '幫我 2099-01-02 19:00 到 19:30 安排這份作業的準備時間',
  '安排這份作業的準備時間',
])('source routing precedes single/batch creation and does not mint a generic proposal: %s', async (question) => {
  const single = jest.spyOn(execution, 'createAssistantCalendarTask');
  const batch = jest.spyOn(batchExecution, 'prepareAssistantCalendarBatch');
  const reply = await askCampusAssistant(input(question));
  expect(reply).toMatchObject({ source: 'device', tool: 'calendar-action', hasActions: false,
    courseworkStudy: { assignmentIds: ['first', 'second'] } });
  expect(reply.calendarTask).toBeUndefined(); expect(reply.calendarBatch).toBeUndefined();
  expect(single).not.toHaveBeenCalled(); expect(batch).not.toHaveBeenCalled();
  expect(AsyncStorage.getItem).not.toHaveBeenCalled(); expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  expect(localLLM.generate).not.toHaveBeenCalled(); expect(mockCallable).not.toHaveBeenCalled();
});

test.each([
  '幫我 2099-01-02 19:00 到 19:30 安排這份作業的準備時間',
  '幫我安排這份作業',
  '幫我安排以下行程：\n2099-01-02 19:00 到 19:30 這份作業的準備時間\n2099-01-02 20:00 到 20:30 英文',
])('absent source cannot fall through to a literal or batch event: %s', async (question) => {
  const missing = await askCampusAssistant({ ...input(question), messages: [{ role: 'user', content: question }] });
  expect(missing.courseworkStudy).toBeUndefined(); expect(missing.calendarTask).toBeUndefined(); expect(missing.calendarBatch).toBeUndefined();
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});

test('an exact typed source choice keeps the displayed time and chooses the requested ID', async () => {
  const reply = await askCampusAssistant({ ...input('選擇第二份'), courseworkStudyChoice: { assignmentId: 'second' },
    messages: [{ role: 'assistant', content: '請選作業', courseworkRead: read, tool: 'calendar-action',
      courseworkStudy: { assignmentIds: ['first', 'second'], time: { date: '2099-01-02', startTime: '19:00', endTime: '19:30' } } },
    { role: 'user', content: '選擇第二份' }],
  });
  expect(reply.courseworkStudy).toEqual({ assignmentIds: ['second'], time: { date: '2099-01-02', startTime: '19:00', endTime: '19:30' } });
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});

test('a literal event containing 作業 retains the existing generic flow', async () => {
  const result = await askCampusAssistant({ scope: { uid: 'A', schoolId: 'pu' }, isCurrent: () => true,
    messages: [{ role: 'user', content: '幫我 2099-01-02 19:00 到 20:00 安排英文作業複習' }] });
  expect(result.calendarTask).toMatchObject({ state: 'review', proposal: { event: { title: '英文作業複習' } } });
  expect(result.courseworkStudy).toBeUndefined(); expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});

test.each(['device', 'campus'] as const)('coursework source cards and their preceding questions stay out of later %s model history', async (mode) => {
  const messages: CampusAssistantMessage[] = [
    { role: 'user', content: 'SOURCE_QUERY_SECRET' },
    { role: 'assistant', content: 'COURSEWORK_BODY_SECRET', courseworkRead: read },
    { role: 'user', content: 'STUDY_QUESTION_SECRET' },
    { role: 'assistant', content: 'STUDY_SOURCE_SECRET', courseworkRead: read, courseworkStudy: { assignmentIds: ['first'] }, tool: 'calendar-action' },
    { role: 'user', content: '把「公告」翻譯成英文' },
  ];
  await askCampusAssistant({ scope: { uid: 'A', schoolId: 'pu' }, isCurrent: () => true, mode, messages });
  const sent = mode === 'device' ? localLLM.generate.mock.calls.at(-1)?.[0] : mockCallable.mock.calls.at(-1)?.[0];
  expect(sent).toBeDefined();
  expect(JSON.stringify(sent)).not.toMatch(/_SECRET|workspace-a|student-a|期末報告/);
  expect(JSON.stringify(sent)).toContain('把「公告」翻譯成英文');
});
