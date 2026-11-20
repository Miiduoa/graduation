import { describe, expect, it } from 'vitest';
import type { NuniAssignment, NuniMaterial, NuniQuiz, NuniUnit } from '@campus/shared/src/nuni';
import { buildCourseOutline, courseActivityStatus, courseTaskTotals, selectCourseUnit } from './courseOutline';

const course = 'cw_11111111-1111-4111-8111-111111111111';
const unitA: NuniUnit = {
  id: 'cwu_11111111-1111-4111-8111-111111111111',
  workspaceId: course,
  title: '第二章',
  position: 2,
  createdAt: '2026-10-10T00:00:00Z',
};
const unitB: NuniUnit = {
  id: 'cwu_22222222-2222-4222-8222-222222222222',
  workspaceId: course,
  title: '第一章',
  position: 1,
  createdAt: '2026-10-10T00:00:00Z',
};
const material: NuniMaterial = {
  id: 'cwm_33333333-3333-4333-8333-333333333333',
  workspaceId: course,
  title: '關聯式模型',
  body: '閱讀課程說明',
  unitId: unitB.id,
  unitTitle: unitB.title,
  createdByPlatformAccountId: 'pa_11111111-1111-4111-8111-111111111111',
  createdAt: '2026-10-10T00:00:00Z',
};
const assignment: NuniAssignment = {
  id: 'cwa_44444444-4444-4444-8444-444444444444',
  workspaceId: course,
  title: '第一週作業',
  instructions: '完成練習',
  state: 'open',
  createdAt: '2026-10-10T00:00:00Z',
  closedAt: null,
  dueAt: '2026-10-15T00:00:00Z',
  unitId: unitB.id,
  unitTitle: unitB.title,
  submissionCount: 0,
  mySubmission: null,
};
const quiz: NuniQuiz = {
  id: 'cwq_55555555-5555-4555-8555-555555555555',
  workspaceId: course,
  title: '複習測驗',
  prompt: '說明正規化',
  state: 'open',
  createdAt: '2026-10-10T00:00:00Z',
  closedAt: null,
  dueAt: null,
  unitId: unitA.id,
  unitTitle: unitA.title,
  responseCount: 1,
  myResponse: null,
};

describe('unit-based learning outline', () => {
  it('sorts units by teaching order and binds materials, assignments and quizzes without mutating input', () => {
    const units = [unitA, unitB];
    const sections = buildCourseOutline(units, [material], [assignment], [quiz]);
    expect(sections.map((section) => section.title)).toEqual(['第一章', '第二章']);
    expect(sections[0].materials[0].id).toBe(material.id);
    expect(sections[0].assignments[0].id).toBe(assignment.id);
    expect(sections[1].quizzes[0].id).toBe(quiz.id);
    expect(units).toEqual([unitA, unitB]);
  });

  it('does not hide content when the referenced teaching unit is missing', () => {
    const missing = { ...material, unitId: 'cwu_99999999-9999-4999-8999-999999999999' };
    const groups = buildCourseOutline([unitB], [missing], [{ ...assignment, unitId: null }], []);
    expect(groups.at(-1)?.title).toBe('其他內容');
    expect(groups.at(-1)?.missingUnit).toBe(true);
    expect(groups.at(-1)?.materials).toEqual([missing]);
    expect(groups.at(-1)?.assignments).toHaveLength(1);
    expect(buildCourseOutline([], [], [], [])).toHaveLength(1);
  });

  it('counts only receipt-confirmed activities as done and treats times as suggestions, not closure', () => {
    const now = Date.parse('2026-10-14T00:00:00Z');
    const receipt = { assignmentId: assignment.id, platformAccountId: 'pa_11111111-1111-4111-8111-111111111111',
      displayName: '學生', body: '已完成', state: 'submitted' as const,
      submittedAt: '2026-10-13T00:00:00Z', teacherFeedback: null, reviewedAt: null };
    const totals = courseTaskTotals(
      [assignment, { ...assignment, id: 'cwa_66666666-6666-4666-8666-666666666666', mySubmission: receipt, state: 'closed', closedAt: now ? '2026-10-14T00:00:00Z' : null }],
      [quiz], now,
    );
    expect(totals).toEqual({ assigned: 3, completed: 1, pending: 2, suggestedSoon: 1 });
    expect(courseActivityStatus(assignment, 'assignment')).toBe('待繳交');
    expect(courseActivityStatus({ ...quiz, state: 'closed', closedAt: '2026-10-14T00:00:00Z' }, 'quiz')).toBe('已結束');
  });

  it('refuses invalid or stale chapter choices before a publish request', () => {
    const form = new FormData();
    expect(selectCourseUnit(form, [unitA])).toBeUndefined();
    form.set('unitId', unitA.id);
    expect(selectCourseUnit(form, [unitA])).toBe(unitA.id);
    expect(() => selectCourseUnit(form, [unitB])).toThrowError('UNIT_NOT_AVAILABLE');
    expect(() => selectCourseUnit(form, null)).toThrowError('UNIT_NOT_AVAILABLE');
    form.set('unitId', '');
    expect(selectCourseUnit(form, null)).toBeUndefined();
  });
});
