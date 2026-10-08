'use strict';

const mockDocuments = new Map();
const mockReads = [];
let mockReadHook;
function mockRef(path, constraints = []) {
  return {
    collection: (name) => mockRef(`${path}/${name}`),
    doc: (id) => mockRef(`${path}/${id}`),
    where: (...args) => mockRef(path, [...constraints, ['where', ...args]]),
    orderBy: (...args) => mockRef(path, [...constraints, ['orderBy', ...args]]),
    limit: (count) => mockRef(path, [...constraints, ['limit', count]]),
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
jest.mock('firebase-admin/firestore', () => ({ getFirestore: () => mockDb }));

const {
  fetchAssistantAnnouncements, fetchAssistantEvents, fetchAssistantMenus, fetchAssistantPois,
  fetchAssistantUserProfile, fetchAssistantDailyBrief, fetchAssistantWeeklyReport,
  fetchAssistantTodaySchedule, fetchAssistantPendingAssignments,
} = require('./assistantFetchers');
const getAnnouncements = require('../agent/tools/getAnnouncements');
const getAssignments = require('../agent/tools/getAssignments');
const getTodaySchedule = require('../agent/tools/getTodaySchedule');
const getPrioritySummary = require('../agent/tools/getPrioritySummary');

const row = (id, data) => ({ id, data });

beforeEach(() => {
  mockDocuments.clear();
  mockReads.length = 0;
  mockReadHook = undefined;
});

test('reads current announcement producers and preserves document identity and timestamps', async () => {
  const publishedAt = { toDate: () => new Date('2026-10-08T00:00:00Z') };
  mockDocuments.set('schools/pu/announcements', [row('school-notice', {
    id: 'forged-id', title: '課務公告', body: '正式內容', schoolId: 'pu', source: '課務組', pinned: true, publishedAt,
  })]);
  const rows = await fetchAssistantAnnouncements('pu');
  expect(rows[0]).toEqual({ id: 'school-notice', title: '課務公告', body: '正式內容', schoolId: 'pu', source: '課務組', pinned: true, publishedAt });
  expect(mockReads).toEqual([{ path: 'schools/pu/announcements', constraints: [['orderBy', 'publishedAt', 'desc'], ['limit', 20]] }]);
});

test('uses the active clubEvents producer and sorts actual event dates', async () => {
  mockDocuments.set('schools/pu/clubEvents', [
    row('later', { title: '晚場', startsAt: new Date('2026-10-09T10:00:00Z') }),
    row('first', { title: '早場', startsAt: { toDate: () => new Date('2026-10-09T08:00:00Z') } }),
  ]);
  mockDocuments.set('schools/pu/events', [row('obsolete', { title: '舊的遷移資料' })]);
  expect((await fetchAssistantEvents('pu')).map((entry) => entry.id)).toEqual(['first', 'later']);
  expect(mockReads.map((entry) => entry.path)).toEqual(['schools/pu/clubEvents']);
});

test('retains confirmed-empty migration fallbacks with an explicit school constraint', async () => {
  mockDocuments.set('events', [row('legacy', { title: '舊活動', schoolId: 'pu' })]);
  expect(await fetchAssistantEvents('pu')).toEqual([{ id: 'legacy', title: '舊活動', schoolId: 'pu' }]);
  expect(mockReads).toEqual([
    { path: 'schools/pu/clubEvents', constraints: [] },
    { path: 'schools/pu/events', constraints: [] },
    { path: 'events', constraints: [['where', 'schoolId', '==', 'pu']] },
  ]);
});

test.each([
  ['menus', fetchAssistantMenus, '每日飯'],
  ['pois', fetchAssistantPois, '教學大樓'],
])('exports a real school-scoped %s reader', async (collection, read, name) => {
  mockDocuments.set(`schools/pu/${collection}`, [row('one', { name, schoolId: 'pu' })]);
  expect(await read('pu')).toEqual([{ id: 'one', name, schoolId: 'pu' }]);
  expect(mockReads[0].path).toBe(`schools/pu/${collection}`);
});

test.each([fetchAssistantAnnouncements, fetchAssistantEvents, fetchAssistantMenus, fetchAssistantPois])(
  'rejects a missing school before accessing Firestore', async (read) => {
    await expect(read()).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(read('pu/private')).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(mockReads).toEqual([]);
  },
);

test('does not turn an authoritative failure into a legacy result or an empty success', async () => {
  mockDocuments.set('schools/pu/announcements', new Error('unavailable'));
  mockDocuments.set('announcements', [row('old', { title: '舊公告', schoolId: 'pu' })]);
  await expect(fetchAssistantAnnouncements('pu')).rejects.toThrow('unavailable');
  expect(mockReads).toHaveLength(1);
});

test.each(['nthu', undefined])('rejects untrusted legacy school metadata (%s)', async (schoolId) => {
  mockDocuments.set('announcements', [row('bad', { title: '別校公告', schoolId })]);
  await expect(fetchAssistantAnnouncements('pu')).rejects.toMatchObject({ code: 'failed-precondition' });
  expect(mockReads[1].constraints).toContainEqual(['where', 'schoolId', '==', 'pu']);
});

test('rejects inconsistent metadata in a canonical source and returns [] only for successful empty reads', async () => {
  mockDocuments.set('schools/pu/pois', [row('bad', { name: '別校地點', schoolId: 'nthu' })]);
  await expect(fetchAssistantPois('pu')).rejects.toMatchObject({ code: 'failed-precondition' });
  mockDocuments.clear();
  expect(await fetchAssistantPois('pu')).toEqual([]);
});

test('announcement tools cannot override the caller school or create one from model input', async () => {
  await expect(getAnnouncements.execute({ schoolId: 'pu' }, { schoolId: 'nthu' })).rejects.toMatchObject({ code: 'permission-denied' });
  await expect(getAnnouncements.execute({}, { schoolId: 'pu' })).rejects.toMatchObject({ code: 'permission-denied' });
  expect(mockReads).toEqual([]);
  mockDocuments.set('schools/pu/announcements', [row('one', { title: '校方公告' })]);
  expect(await getAnnouncements.execute({ schoolId: 'pu' }, {})).toEqual([{ id: 'one', title: '校方公告', schoolId: 'pu' }]);
});

test('loads only the authenticated profile fields used to resolve the school context', async () => {
  mockDocuments.set('users/alice', { primarySchoolId: 'pu', schoolId: 'old', displayName: 'Alice', role: 'student', privateField: 'unused', uid: 'bob' });
  expect(await fetchAssistantUserProfile('alice')).toEqual({ uid: 'alice', schoolId: 'pu', displayName: 'Alice', role: 'student' });
  expect(mockReads.map((entry) => entry.path)).toEqual(['users/alice']);
});

test.each([
  ['dailyBriefs', fetchAssistantDailyBrief, { content: '本人每日內容', date: '2026-10-08' }, '本人每日內容'],
  ['weeklyReports', fetchAssistantWeeklyReport, { summary: '本人每週內容', weekId: 'week' }, '本人每週內容'],
])('reads %s from the verified account and school and preserves actual content', async (collection, read, data, summary) => {
  mockDocuments.set('schools/pu/members/alice', { status: 'active' });
  mockDocuments.set(`users/alice/schools/pu/${collection}`, [row('latest', { ...data, schoolId: 'pu' })]);
  expect(await read('alice', 'pu')).toEqual({ ...data, id: 'latest', schoolId: 'pu', summary });
  expect(mockReads).toEqual([
    { path: 'schools/pu/members/alice', constraints: [] },
    { path: `users/alice/schools/pu/${collection}`, constraints: [['orderBy', 'generatedAt', 'desc'], ['limit', 1]] },
    { path: 'schools/pu/members/alice', constraints: [] },
  ]);
});

test('does not read a private summary without active membership or school context', async () => {
  await expect(fetchAssistantDailyBrief('alice')).rejects.toMatchObject({ code: 'invalid-argument' });
  await expect(fetchAssistantWeeklyReport('alice', 'pu')).rejects.toMatchObject({ code: 'permission-denied' });
  expect(mockReads.map((entry) => entry.path)).toEqual(['schools/pu/members/alice']);
});

test('discards a private summary when membership is revoked during the read', async () => {
  mockDocuments.set('schools/pu/members/alice', { status: 'active' });
  mockDocuments.set('users/alice/schools/pu/dailyBriefs', [row('latest', { content: '私人摘要', schoolId: 'pu' })]);
  mockReadHook = (path) => {
    if (path === 'users/alice/schools/pu/dailyBriefs') mockDocuments.set('schools/pu/members/alice', { status: 'inactive' });
  };
  await expect(fetchAssistantDailyBrief('alice', 'pu')).rejects.toMatchObject({ code: 'permission-denied' });
});

test('does not conceal a private summary source failure as an absent report', async () => {
  mockDocuments.set('schools/pu/members/alice', { status: 'active' });
  mockDocuments.set('users/alice/schools/pu/weeklyReports', new Error('offline'));
  await expect(fetchAssistantWeeklyReport('alice', 'pu')).rejects.toThrow('offline');
});

function seedCourse(groupId = 'course', { role = 'member', schoolId = 'pu' } = {}) {
  mockDocuments.set('schools/pu/members/alice', { status: 'active' });
  mockDocuments.set('users/alice/groups', [row(groupId, { groupId, schoolId, type: 'course', status: 'active' })]);
  mockDocuments.set(`groups/${groupId}`, { name: '程式設計', schoolId, type: 'course' });
  mockDocuments.set(`groups/${groupId}/members/alice`, { status: 'active', role });
  mockDocuments.set(`groups/${groupId}/assignments`, [row('pending', { title: '期末作業', dueAt: new Date('2099-10-10') })]);
}

test('reads real course assignments, excludes drafts and own submissions, and sorts due dates', async () => {
  seedCourse();
  mockDocuments.set('groups/course/assignments', [
    row('later', { title: '較晚作業', dueAt: new Date('2099-10-10') }),
    row('earlier', { id: 'forged', title: '較早作業', dueAt: new Date('2099-10-08'), groupId: 'course' }),
    row('draft', { title: '草稿', status: 'draft' }),
    row('hidden', { title: '未發佈', published: false }),
    row('closed', { title: '已關閉', status: 'closed' }),
    row('submitted', { title: '已繳交' }),
  ]);
  mockDocuments.set('groups/course/assignments/submitted/submissions/alice', { submittedAt: new Date() });
  mockDocuments.set('groups/course/assignments/earlier/submissions/bob', { submittedAt: new Date() });
  const result = await getAssignments.execute({ uid: 'alice', schoolId: 'pu' }, {});
  expect(result.map(({ id }) => id)).toEqual(['earlier', 'later']);
  expect(result[0]).toMatchObject({ title: '較早作業', groupName: '程式設計', groupId: 'course', schoolId: 'pu' });
  expect(mockReads).toContainEqual({ path: 'users/alice/groups', constraints: [['where', 'schoolId', '==', 'pu']] });
  expect(mockReads.filter(({ path }) => path.includes('/submissions/')).every(({ path }) => path.endsWith('/alice'))).toBe(true);
  expect(mockReads.filter(({ path }) => path === 'groups/course/members/alice')).toHaveLength(2);
  expect(mockReads.filter(({ path }) => path === 'schools/pu/members/alice')).toHaveLength(2);
});

test.each(['missing', 'inactive', 'other-school'])('rejects a model-selected course with %s authorization before reading assignments', async (state) => {
  seedCourse('untrusted', { schoolId: state === 'other-school' ? 'nthu' : 'pu' });
  if (state === 'missing') mockDocuments.delete('groups/untrusted/members/alice');
  if (state === 'inactive') mockDocuments.set('groups/untrusted/members/alice', { status: 'inactive' });
  await expect(getAssignments.execute({ uid: 'alice', schoolId: 'pu' }, { preferredGroupId: 'untrusted' })).rejects.toMatchObject({ code: 'permission-denied' });
  expect(mockReads.some(({ path }) => path.includes('/assignments'))).toBe(false);
});

test('does not report a teacher-owned course as personal pending homework', async () => {
  seedCourse('teaching', { role: 'instructor' });
  expect(await fetchAssistantPendingAssignments('alice', 'pu')).toEqual([]);
  expect(mockReads.some(({ path }) => path.includes('/assignments'))).toBe(false);
});

test('a legacy membership mirror without type still resolves its canonical course and assignments', async () => {
  seedCourse();
  mockDocuments.set('users/alice/groups', [row('course', { groupId: 'course', schoolId: 'pu', status: 'active' })]);
  expect(await fetchAssistantPendingAssignments('alice', 'pu')).toEqual([
    expect.objectContaining({ id: 'pending', title: '期末作業', groupId: 'course' }),
  ]);
});

test.each(['club', 'study'])('a same-school active %s group is skipped based on its canonical type', async (type) => {
  seedCourse();
  mockDocuments.set('groups/course', { name: '校園群組', schoolId: 'pu', type });
  expect(await fetchAssistantPendingAssignments('alice', 'pu')).toEqual([]);
  expect(mockReads.some(({ path }) => path.includes('/assignments'))).toBe(false);
});

test('rejects stale course authorization after submission reads and does not leak the pending list', async () => {
  seedCourse();
  mockReadHook = (path) => {
    if (path.includes('/submissions/')) mockDocuments.set('groups/course/members/alice', { status: 'inactive' });
  };
  await expect(fetchAssistantPendingAssignments('alice', 'pu')).rejects.toMatchObject({ code: 'permission-denied' });
});

test('assignment query and submission failures cannot become an empty pending list', async () => {
  seedCourse();
  mockDocuments.set('groups/course/assignments', new Error('assignments offline'));
  await expect(fetchAssistantPendingAssignments('alice', 'pu')).rejects.toThrow('assignments offline');
  seedCourse();
  mockDocuments.set('groups/course/assignments/pending/submissions/alice', new Error('submissions offline'));
  await expect(fetchAssistantPendingAssignments('alice', 'pu')).rejects.toThrow('submissions offline');
});

test('missing user and school context reject private readers before any data access', async () => {
  await expect(fetchAssistantPendingAssignments(null, 'pu')).rejects.toMatchObject({ code: 'invalid-argument' });
  await expect(fetchAssistantPendingAssignments('alice')).rejects.toMatchObject({ code: 'invalid-argument' });
  await expect(fetchAssistantTodaySchedule('alice')).rejects.toMatchObject({ code: 'invalid-argument' });
  expect(mockReads).toEqual([]);
});

test('the unconnected timetable is explicitly unavailable and the priority tool never claims zero classes', async () => {
  mockDocuments.set('schools/pu/members/alice', { status: 'active' });
  const todaySchedule = await getTodaySchedule.execute({ uid: 'alice', schoolId: 'pu' }, {});
  expect(todaySchedule).toMatchObject({ status: 'unavailable', slots: null });
  expect(todaySchedule.message).toContain('不能判定今天有沒有課');
  expect(await getPrioritySummary.execute({ prefetched: { todaySchedule } }, {})).toMatchObject({
    classCount: null, scheduleStatus: 'unavailable', assignmentsStatus: 'unavailable',
  });
  expect(mockReads.map(({ path }) => path)).toEqual(['schools/pu/members/alice']);
});
