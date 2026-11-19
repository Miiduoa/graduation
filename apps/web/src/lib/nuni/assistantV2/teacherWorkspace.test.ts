// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { formatTeachingRead, parseTeachingArguments, parseTeachingRead, parseTeachingResult, type TeachingRead } from './teacherWorkspace';

const workspaceId = 'cw_11111111-1111-4111-8111-111111111111';
const read = (): TeachingRead => ({ version: 1, source: 'platform-teaching', schoolId: 'pu',
  checkedAt: '2026-11-17T02:00:00.000Z', query: { limit: 3 }, status: 'ready', partial: false,
  partialReasons: [], unreadCourseCount: 0, href: '/classroom', courses: [{ workspaceId, schoolId: 'pu', title: '資料庫',
    memberRole: 'owner-teacher', partial: false, href: '/classroom/course/' + workspaceId,
    assignments: [{ id: 'cwa_11111111-1111-4111-8111-111111111111', title: '期末作業', state: 'open',
      dueAt: '2026-11-18T12:00:00.000Z', receivedCount: 7 }], quizzes: [{
      id: 'cwq_11111111-1111-4111-8111-111111111111', title: '複習測驗', state: 'closed', dueAt: null, receivedCount: 5 }],
  }] });

describe('teacher workbench request contracts', () => {
  it('accepts a bounded course count without any caller role or school authority', () => {
    expect(parseTeachingArguments({})).toEqual({ limit: 3 });
    expect(parseTeachingArguments({ limit: 1 })).toEqual({ limit: 1 });
    for (const args of [{ limit: 0 }, { limit: 4 }, { limit: 1.5 }, { limit: null }, { limit: undefined },
      { role: 'teacher' }, { schoolId: 'pu' }, { workspaceId }, { cursor: 'next' }, []])
      expect(() => parseTeachingArguments(args)).toThrow();
  });
  it('does not evaluate getters or inherit an attacker-provided argument', () => {
    const getter = vi.fn(() => 2);
    expect(() => parseTeachingArguments(Object.defineProperty({}, 'limit', { enumerable: true, get: getter }))).toThrow();
    expect(() => parseTeachingArguments(Object.create({ limit: 2 }))).toThrow();
    expect(getter).not.toHaveBeenCalled();
  });
  it.each(['查我的授課課程', '幫我查看教師工作概況', '我的授課作業有哪些？', '查看我教的課', '老師課務總覽', '我的教學概況'])
    ('recognizes only an entire explicit teaching summary: %s', question => {
      expect(parseTeachingRead(question)).toEqual({ tool: 'get_teaching_overview', args: {} });
    });
  it.each(['不要查我的授課課程', '假設我是老師，查我的授課課程', '查「我的授課課程」這句話',
    '查我明天的授課課程', '查我本週的授課作業', '查資料庫課程的授課概況', '查其他學校的授課課程',
    '查我的授課課程，然後刪除作業', '我的作業有哪些', '學生的測驗作答', '幫我批改所有授課作業',
    '每天查我的授課課程', '查我的授課課程\n', '查我的授課\u200b課程'])
    ('leaves filters, writes, other people and compound tasks intact: %s', question => {
      expect(parseTeachingRead(question)).toBeNull();
    });
});

describe('teacher read projection', () => {
  it('roundtrips a scoped course summary and formats counts without inventing grading or missing-student counts', () => {
    expect(parseTeachingResult(read(), 'pu')).toEqual(read());
    const answer = formatTeachingRead(read());
    expect(answer).toContain('資料庫');
    expect(answer).toContain('截止 2026-11-18 20:00');
    expect(answer).toContain('已交 7');
    expect(answer).toContain('已答 5');
    expect(answer).toContain('尚未查核批閱狀態與全班缺交人數');
    expect(answer).not.toContain('7 份待批');
  });
  it.each([
    (value: TeachingRead) => ({ ...value, schoolId: 'foreign' }),
    (value: TeachingRead) => ({ ...value, query: { limit: 2 } }),
    (value: TeachingRead) => ({ ...value, source: 'school-teaching' }),
    (value: TeachingRead) => ({ ...value, href: 'https://evil.test' }),
    (value: TeachingRead) => ({ ...value, checkedAt: '2026-11-17' }),
    (value: TeachingRead) => ({ ...value, courses: [...value.courses, ...value.courses] }),
    (value: TeachingRead) => ({ ...value, courses: [{ ...value.courses[0], memberRole: 'student' }] }),
    (value: TeachingRead) => ({ ...value, courses: [{ ...value.courses[0], schoolId: 'foreign' }] }),
    (value: TeachingRead) => ({ ...value, courses: [{ ...value.courses[0], href: '/classroom/course/other' }] }),
    (value: TeachingRead) => ({ ...value, courses: [{ ...value.courses[0], students: ['private'] }] }),
    (value: TeachingRead) => ({ ...value, courses: [{ ...value.courses[0], assignments: [{
      ...value.courses[0].assignments[0], mySubmission: { body: 'private answer' } }] }] }),
    (value: TeachingRead) => ({ ...value, courses: [{ ...value.courses[0], assignments: [{
      ...value.courses[0].assignments[0], receivedCount: -1 }] }] }),
    (value: TeachingRead) => ({ ...value, partial: true }),
    (value: TeachingRead) => ({ ...value, unreadCourseCount: 2 }),
    (value: TeachingRead) => ({ ...value, status: 'unavailable', unavailable: 'SOURCE_UNAVAILABLE' }),
    (value: TeachingRead) => ({ ...value, partial: true, partialReasons: ['work-limit'], courses: [] }),
    (value: TeachingRead) => ({ ...value, courses: Array(1) }),
  ])('rejects a corrupt or broader projection', mutate => {
    expect(() => parseTeachingResult(mutate(read()), 'pu')).toThrowError('INVALID_TEACHING_RESULT');
  });
  it('keeps unknown access separate from an empty verified list', () => {
    const unavailable: TeachingRead = { ...read(), courses: [], status: 'unavailable', partial: true,
      partialReasons: ['scope-unverified'], unreadCourseCount: 2, unavailable: 'SCOPE_UNVERIFIED' };
    expect(parseTeachingResult(unavailable, 'pu')).toEqual(unavailable);
    expect(formatTeachingRead(unavailable)).toContain('2 個授課工作區尚未核對');
    expect(formatTeachingRead(unavailable)).toContain('目前無法確認');
    expect(formatTeachingRead(unavailable)).not.toContain('沒有作業');
  });
  it('puts partial coverage before course excerpts and bounds the display summary', () => {
    const value = read();
    value.partial = true; value.partialReasons = ['work-limit', 'api-budget']; value.unreadCourseCount = 4;
    value.courses[0].partial = true;
    value.courses[0].assignments = Array.from({ length: 5 }, (_, index) => ({ ...value.courses[0].assignments[0],
      id: `cwa_11111111-1111-4111-8111-${String(index).padStart(12, '0')}`, title: '課務'.repeat(80) }));
    const answer = formatTeachingRead(parseTeachingResult(value, 'pu'));
    expect(answer.indexOf('部分課務摘要')).toBeLessThan(answer.indexOf('【資料庫】'));
    expect(answer.length).toBeLessThanOrEqual(1200);
  });
});
