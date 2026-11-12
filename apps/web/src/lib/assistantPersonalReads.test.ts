import { beforeEach, describe, expect, it, vi } from 'vitest';
import { answerAssistantPersonalQuestion as answer, personalAssistantReadIntent as intent } from './assistantPersonalReads';
import { personalImportsStorageKey } from './personalImports';
import { browserRequest } from '@/features/nuni/Session';
import { loadPersonalTimetable } from './timetable/store';
import { classMeetingKey } from '@campus/shared/src/timetable/classExceptions';
import { NuniError } from '@campus/shared/src/nuni';
import type { PersonalImportRecord } from '@campus/shared/src/imports/types';

vi.mock('@/features/nuni/Session', () => ({ browserRequest: vi.fn() }));
vi.mock('./timetable/store', () => ({ loadPersonalTimetable: vi.fn() }));
const accountId = 'pa_22222222-2222-4222-8222-222222222222';
const workspaceId = 'cw_11111111-1111-4111-8111-111111111111';
const scope = { owner: 'platform:' + accountId, schoolId: 'pu' };
const now = new Date('2026-11-12T09:30:00+08:00');
const options = () => ({ context: 'a'.repeat(43), signal: new AbortController().signal, now });
const lesson = (extra: Partial<PersonalImportRecord> = {}): PersonalImportRecord => ({
  id: 'lesson-one', kind: 'timetable', title: '資料庫管理', schoolId: 'pu',
  academicYear: '115', semester: '1', dayOfWeek: 4, startTime: '09:10', endTime: '10:00', location: '主顧 203',
  batchId: 'saved', importedAt: '2026-11-10T01:00:00Z', source: { type: 'paste', line: 1, rawText: '不應回傳的原文' },
  ...extra,
});
const save = (records: PersonalImportRecord[], owner = scope) =>
  localStorage.setItem(personalImportsStorageKey(owner), JSON.stringify({ version: 1, records }));

beforeEach(() => {
  localStorage.clear();
  vi.mocked(browserRequest).mockReset();
  vi.mocked(loadPersonalTimetable).mockReset().mockResolvedValue({
    schoolId: 'pu', courses: [], meta: { school: 'pu', year: '115', semester: '1', className: '', credits: 0, title: '' },
    updatedAt: '2026-11-10T01:00:00Z', shareWithFriends: false,
  });
});

describe('direct personal reads', () => {
  it('answers the actual saved classes, rooms and times without a provider or a page handoff', async () => {
    save([lesson(), lesson({ id: 'tomorrow', title: '資訊安全', dayOfWeek: 5 })]);
    const result = await answer('今天有哪些課？', scope, options());
    expect(result?.content).toContain('資料庫管理');
    expect(result?.content).toContain('09:10–10:00');
    expect(result?.content).toContain('主顧 203');
    expect(result?.content).not.toMatch(/資訊安全|不應回傳的原文/);
    expect(result?.kind).toBe('personal');
    expect(browserRequest).not.toHaveBeenCalled();
  });

  it('finds the next future class across midnight and excludes the ongoing class', async () => {
    save([lesson(), lesson({ id: 'tomorrow', title: '資訊安全', dayOfWeek: 5 })]);
    const result = await answer('下一堂課在哪，幾點？', scope, options());
    expect(result?.content).toContain('資訊安全');
    expect(result?.content).toContain('2026-11-13');
    expect(result?.content).not.toContain('資料庫管理');
  });

  it('answers the currently active class without including later classes', async () => {
    save([lesson(), lesson({ id: 'later', title: '下午的課', startTime: '14:10', endTime: '16:00' })]);
    const result = await answer('現在上什麼課？', scope, options());
    expect(result?.content).toContain('資料庫管理');
    expect(result?.content).not.toContain('下午的課');
  });

  it('applies saved class cancellations and afternoon filtering', async () => {
    const original = lesson();
    vi.mocked(loadPersonalTimetable).mockResolvedValueOnce({
      schoolId: 'pu', courses: [], meta: { school: 'pu', year: '115', semester: '1', className: '', credits: 0, title: '' },
      updatedAt: '2026-11-10T01:00:00Z', shareWithFriends: false,
      classExceptions: [{ id: 'cancel', kind: 'cancel', originalDate: '2026-11-12', original,
        courseKey: classMeetingKey(original), createdAt: '2026-11-11T00:00:00Z' }],
    });
    save([original, lesson({ id: 'afternoon', title: '程式設計', startTime: '14:10', endTime: '16:00' })]);
    const result = await answer('今天下午有哪些課？', scope, options());
    expect(result?.content).toContain('程式設計');
    expect(result?.content).not.toContain('資料庫管理');
  });

  it('never substitutes an old or future semester for the requested current date', async () => {
    save([lesson({ academicYear: '114' }), lesson({ id: 'future', title: '未來學期', academicYear: '116' })]);
    const result = await answer('今天有哪些課？', scope, options());
    expect(result?.content).toContain('無法確認');
    expect(result?.content).not.toMatch(/資料庫管理|未來學期|沒有排課/);
  });

  it('keeps accounts and campuses isolated and does not treat corruption as an empty result', async () => {
    save([lesson()], { ...scope, owner: 'platform:other' });
    expect((await answer('今天有哪些課？', scope, options()))?.content).not.toContain('資料庫管理');
    localStorage.setItem(personalImportsStorageKey(scope), '{broken');
    const failed = await answer('今天有哪些課？', scope, options());
    expect(failed?.content).toContain('無法確認');
    expect(failed?.content).not.toContain('沒有排課');
  });

  it('keeps all-day end dates exclusive and includes overnight personal events', async () => {
    save([
      lesson({ id: 'all-day', kind: 'events', title: '已結束的全天活動', date: '2026-11-11', endDate: '2026-11-12', allDay: true, startTime: undefined, endTime: undefined, dayOfWeek: undefined }),
      lesson({ id: 'overnight', kind: 'events', title: '跨日討論', date: '2026-11-11', endDate: '2026-11-12', startTime: '23:00', endTime: '01:00', dayOfWeek: undefined }),
    ]);
    const result = await answer('今天有哪些個人行程？', scope, options());
    expect(result?.content).toContain('跨日討論');
    expect(result?.content).not.toContain('已結束的全天活動');
  });

  it.each([
    '幫我安排明天的課表', '今天有哪些課然後幫我訂餐', '下週五有哪些課',
    '今天和明天有哪些課', '我今天交了哪些作業', '資料庫的作業有哪些',
    '資料模型作業交了嗎', '開啟課表', '不要查我的作業', '2026-02-30有哪些課',
    '今天上午、下午有哪些課', '明天現在有什麼課', '現在有什麼課，下一堂課在哪',
  ])('does not swallow a mutation, precise filter or unsupported date: %s', (question) => {
    expect(intent(question, now)).toBeNull();
  });
});

describe('authenticated coursework reads', () => {
  const assignment = (id: number, submitted = false) => ({
    id: `cwa_00000000-0000-4000-8000-${String(id).padStart(12, '0')}`, workspaceId,
    title: submitted ? '已完成題目' : '資料庫期末實作', instructions: '不應回傳的作業全文',
    state: 'open', createdAt: '2026-11-10T00:00:00Z', closedAt: null,
    dueAt: '2026-11-13T15:59:00Z', unitId: null, unitTitle: null, submissionCount: submitted ? 1 : 0,
    mySubmission: submitted ? { assignmentId: `cwa_00000000-0000-4000-8000-${String(id).padStart(12, '0')}`,
      platformAccountId: accountId, displayName: '同學', body: '不應回傳的提交全文', state: 'submitted',
      submittedAt: '2026-11-11T10:00:00Z', teacherFeedback: null, reviewedAt: null } : null,
  });
  const receipt = { status: 'reviewed', workspaceId, memberRole: 'student', membershipActive: true,
    course: { id: 'ccd_11111111-1111-4111-8111-111111111111', workspaceId, version: 1,
      verification: 'administrator-reviewed', schoolId: 'pu', academicYear: '115', semester: '1',
      title: '資料庫', courseCode: 'CS301', teacher: '王老師', className: '三甲' } };
  const transport = async (path: string) => {
    if (path === 'class-workspaces') return { workspaces: [{ id: workspaceId, title: '課班', state: 'active', memberRole: 'student' }] };
    if (path === 'course-access/workspace-course') return receipt;
    if (path.endsWith('/assignments')) return { assignments: [assignment(1), assignment(2, true)] };
    if (path.endsWith('/quizzes')) return { quizzes: [] };
    throw new Error('Unexpected read: ' + path);
  };

  it('reads verified courses and own receipts and returns due dates instead of opening classroom', async () => {
    vi.mocked(browserRequest).mockImplementation(transport);
    const result = await answer('這禮拜有哪些未交作業？', scope, options());
    expect(result?.content).toContain('資料庫期末實作');
    expect(result?.content).toContain('2026/11/13');
    expect(result?.content).toContain('未交');
    expect(result?.content).not.toMatch(/已完成題目|不應回傳/);
    expect(browserRequest).toHaveBeenCalledWith('course-access/workspace-course', options().context, { workspaceId, schoolId: 'pu' });
    expect(vi.mocked(browserRequest).mock.calls.every(([, context]) => context === options().context)).toBe(true);
  });

  it('does not claim no work when a campus binding cannot be verified', async () => {
    vi.mocked(browserRequest).mockImplementation(async (path) => path === 'course-access/workspace-course'
      ? { ...receipt, course: { ...receipt.course, schoolId: 'nthu' } } : transport(path));
    const result = await answer('我有哪些未交作業？', scope, options());
    expect(result?.content).toContain('未查完整');
    expect(result?.content).not.toContain('資料庫期末實作');
    expect(vi.mocked(browserRequest).mock.calls.some(([path]) => path.endsWith('/assignments'))).toBe(false);
  });

  it('discards results on session expiry and stops late responses after cancellation', async () => {
    vi.mocked(browserRequest).mockRejectedValueOnce(new NuniError(401, 'UNAUTHENTICATED'));
    await expect(answer('我有哪些未交作業？', scope, options())).rejects.toThrow('登入狀態已變更');
    const controller = new AbortController();
    let resolve!: (value: unknown) => void;
    vi.mocked(browserRequest).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const pending = answer('我有哪些未交作業？', scope, { ...options(), signal: controller.signal });
    controller.abort();
    resolve(await transport('class-workspaces'));
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});
