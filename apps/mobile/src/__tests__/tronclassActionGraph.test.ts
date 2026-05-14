/**
 * @jest-environment node
 *
 * 測試：
 *  - TronClass adapter（原始 → 我們的型）
 *  - Action Graph（角色 × 動作 → 下游影響查詢）
 */
import {
  buildImportResult,
  toCourseSpaceFromTronClass,
  toQuizFromTronClass,
  toCourseGradebookDataFromTronClass,
  queryActionGraph,
  listActionsByRole,
  listActionsAffectingRole,
  listActionsWritingEntity,
  listActionsTriggeringSignal,
  explainActionChain,
  ACTION_GRAPH,
} from '@campus/shared';

describe('TronClass adapter', () => {
  test('toCourseSpaceFromTronClass 把原始課程轉成 CourseSpace', () => {
    const cs = toCourseSpaceFromTronClass(
      {
        id: 12345,
        course_code: 'CS101',
        name: '計算機概論',
        student_count: 50,
        unread_count: 3,
        homework_count: 4,
        exam_count: 1,
        module_count: 8,
        latest_due_at: '2026-05-20T15:00:00+08:00',
      },
      'PU',
    );
    expect(cs.id).toBe('tc:12345');
    expect(cs.courseId).toBe('CS101');
    expect(cs.name).toBe('計算機概論');
    expect(cs.memberCount).toBe(50);
    expect(cs.assignmentCount).toBe(4);
    expect(cs.quizCount).toBe(1);
    expect(cs.schoolId).toBe('PU');
    expect(cs.latestDueAt).toBeInstanceOf(Date);
  });

  test('toQuizFromTronClass 區分 exam / quiz', () => {
    const exam = toQuizFromTronClass(
      { id: 1, course_id: 100, title: '期中考', category: 'exam' },
      'CS101',
    );
    expect(exam.type).toBe('exam');
    const quiz = toQuizFromTronClass(
      { id: 2, course_id: 100, title: '小測驗', category: 'quiz' },
      'CS101',
    );
    expect(quiz.type).toBe('quiz');
  });

  test('toCourseGradebookDataFromTronClass 對應加權項與學生分數', () => {
    const gb = toCourseGradebookDataFromTronClass(
      [
        { id: 'hw1', course_id: 100, title: '作業 1', weight: 30 },
        { id: 'mid', course_id: 100, title: '期中考', weight: 30 },
      ],
      [
        {
          user_id: 'u1',
          course_id: 100,
          display_name: '阿明',
          final_score: 78,
          scores: [
            { grade_item_id: 'hw1', score: 80 },
            { grade_item_id: 'mid', score: 76 },
          ],
        },
      ],
      'CS101',
    );
    expect(gb.assignments).toHaveLength(2);
    expect(gb.rows[0].displayName).toBe('阿明');
    expect(gb.rows[0].assignmentBreakdown).toHaveLength(2);
  });

  test('buildImportResult 一次匯入所有實體並標 sourceMeta', () => {
    const r = buildImportResult('PU', {
      courses: [{ id: 1, name: 'A' }],
      modules: [{ id: 10, course_id: 1, name: 'Week 1' }],
      materials: [{ id: 100, module_id: 10, title: 'Slides', type: 'pdf' }],
      quizzes: [{ id: 1000, course_id: 1, title: 'Q1', category: 'quiz' }],
      attendanceSessions: [{ id: 'a1', course_id: 1, started_at: '2026-05-13T09:00:00Z' }],
      attendanceRecords: [{ session_id: 'a1', user_id: 'u1', status: 'present' }],
      gradeItems: [{ id: 'g1', course_id: 1, title: '作業', weight: 100 }],
      gradebookEntries: [
        { user_id: 'u1', course_id: 1, scores: [{ grade_item_id: 'g1', score: 85 }] },
      ],
    });
    expect(r.courseSpaces).toHaveLength(1);
    expect(r.modules).toHaveLength(1);
    expect(r.materials).toHaveLength(1);
    expect(r.quizzes).toHaveLength(1);
    expect(r.gradebooks).toHaveLength(1);
    expect(r.sourceMeta.provider).toBe('tronclass');
    expect(r.sourceMeta.courseCount).toBe(1);
  });
});

describe('Action Graph', () => {
  test('queryActionGraph 命中', () => {
    const a = queryActionGraph('student', 'submit_assignment');
    expect(a?.label).toBe('繳交作業');
    expect(a?.effect.visibleTo).toContain('teacher');
    expect(a?.effect.companionSignal).toBe('onAssignmentSubmitted');
  });

  test('listActionsByRole 列某角色全部動作', () => {
    const teacherActions = listActionsByRole('teacher');
    expect(teacherActions.length).toBeGreaterThanOrEqual(7);
    expect(teacherActions.every((a) => a.role === 'teacher')).toBe(true);
  });

  test('listActionsAffectingRole 列哪些動作會「影響」某角色', () => {
    const affectsStudent = listActionsAffectingRole('student');
    expect(affectsStudent.find((a) => a.action === 'publish_assignment')).toBeDefined();
    expect(affectsStudent.find((a) => a.action === 'open_attendance')).toBeDefined();
  });

  test('listActionsWritingEntity gradebookEntries 找批改 + 發布', () => {
    const writers = listActionsWritingEntity('gradebookEntries');
    expect(writers.map((a) => a.action)).toEqual(
      expect.arrayContaining(['grade_submission', 'publish_grades', 'take_quiz']),
    );
  });

  test('listActionsTriggeringSignal companion signal 查詢', () => {
    const r = listActionsTriggeringSignal('onLibraryBorrow');
    expect(r.find((a) => a.action === 'borrow_book')).toBeDefined();
  });

  test('explainActionChain 展開連鎖反應', () => {
    const chain = explainActionChain('teacher', 'open_attendance');
    expect(chain.primary?.label).toBe('開啟點名');
    expect(chain.affectedRoles).toContain('student');
    expect(chain.inboxToSend).toContain('live');
  });

  test('ACTION_GRAPH 涵蓋 7 角色都有至少一個動作', () => {
    const roles = new Set(ACTION_GRAPH.map((a) => a.role));
    expect(roles.has('student')).toBe(true);
    expect(roles.has('teacher')).toBe(true);
    expect(roles.has('admin')).toBe(true);
    expect(roles.has('staff')).toBe(true);
    expect(roles.has('department_head')).toBe(true);
    expect(roles.has('vendor')).toBe(true);
  });
});
