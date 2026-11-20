import { afterEach, expect, it } from 'vitest';
import { NuniError, type NuniAssignment, type NuniQuiz } from '@campus/shared/src/nuni';
import {
  GRADE_COPY,
  courseGradeFailure,
  gradeFilterLabel,
  gradeFromNuniAssignment,
  gradeFromNuniQuiz,
  gradeFromSchoolAssignment,
  gradeItemKey,
  gradeOwnerForSource,
  gradeReadOwner,
  gradeSourceFromHref,
  gradeStatusLabel,
  isPublishedGradeUnread,
  markPublishedGradeRead,
  matchesGradeFilter,
  sortGradeItems,
  summarizeGradeItems,
} from './lmsStudentGrades';

const course = { id: 'cw_00000000-0000-0000-0000-000000000001', title: '資料庫', state: 'active' as const };

function assignment(extra: Partial<NuniAssignment> = {}): NuniAssignment {
  return {
    id: 'cwa_00000000-0000-0000-0000-000000000001',
    workspaceId: course.id,
    title: '作業一',
    instructions: '請完成',
    state: 'open',
    createdAt: '2026-10-01T00:00:00Z',
    closedAt: null,
    dueAt: null,
    unitId: null,
    unitTitle: null,
    submissionCount: 0,
    mySubmission: null,
    ...extra,
  };
}

function quiz(extra: Partial<NuniQuiz> = {}): NuniQuiz {
  return {
    id: 'cwq_00000000-0000-0000-0000-000000000001',
    workspaceId: course.id,
    title: '小考',
    prompt: '請作答',
    state: 'open',
    createdAt: '2026-10-01T00:00:00Z',
    closedAt: null,
    dueAt: null,
    unitId: null,
    unitTitle: null,
    responseCount: 0,
    myResponse: null,
    ...extra,
  };
}

afterEach(() => {
  window.localStorage.clear();
});

it('labels missing, waiting and published nuni work without inventing a score', () => {
  const missing = gradeFromNuniAssignment(course, assignment());
  expect(missing.status).toBe('missing');
  expect(missing.score).toBeNull();
  expect(missing.hasNumericScore).toBe(false);
  expect(gradeStatusLabel(missing)).toBe(GRADE_COPY.missingOpen);

  const waiting = gradeFromNuniAssignment(course, assignment({
    mySubmission: {
      assignmentId: 'cwa_00000000-0000-0000-0000-000000000001',
      platformAccountId: 'pa_00000000-0000-0000-0000-000000000001',
      displayName: '學生',
      body: '我的繳交內容',
      state: 'submitted',
      submittedAt: '2026-10-08T00:00:00Z',
      teacherFeedback: null,
      reviewedAt: null,
    },
  }));
  expect(waiting.status).toBe('waiting');
  expect(waiting.score).toBeNull();
  expect(waiting.submissionPreview).toBe('我的繳交內容');
  expect(gradeStatusLabel(waiting)).toBe(GRADE_COPY.unpublished);

  const graded = gradeFromNuniAssignment(course, assignment({
    mySubmission: {
      assignmentId: 'cwa_00000000-0000-0000-0000-000000000001',
      platformAccountId: 'pa_00000000-0000-0000-0000-000000000001',
      displayName: '學生',
      body: '我的繳交內容',
      state: 'submitted',
      submittedAt: '2026-10-08T00:00:00Z',
      teacherFeedback: '請補充資料來源',
      reviewedAt: '2026-10-09T04:00:00Z',
    },
  }));
  expect(graded.status).toBe('graded');
  expect(graded.score).toBeNull();
  expect(graded.feedback).toBe('請補充資料來源');
  expect(gradeStatusLabel(graded)).toBe(GRADE_COPY.feedbackOnly);
  expect(graded.href).toBe(
    `/classroom/course/${course.id}#assignment-cwa_00000000-0000-0000-0000-000000000001`,
  );
});

it('keeps a closed unpaid assignment as missing instead of waiting', () => {
  const item = gradeFromNuniQuiz(
    { ...course, state: 'archived' },
    quiz({ state: 'closed', closedAt: '2026-10-08T00:00:00Z' }),
  );
  expect(item.status).toBe('missing');
  expect(item.closed).toBe(true);
  expect(gradeStatusLabel(item)).toBe(GRADE_COPY.missingClosed);
});

it('hides unpublished school scores including zero and still shows a published zero', () => {
  const hidden = gradeFromSchoolAssignment({
    courseId: 'cs101',
    courseName: '資料結構',
    assignmentId: 'hw-1',
    title: '期末報告',
    closed: false,
    points: 100,
    submittedAt: '2026-10-08T00:00:00Z',
    submittedText: '初稿',
    gradePublished: false,
    gradeScore: 0,
    gradeFeedback: '內部評語',
    gradePublishedAt: '2026-10-09T00:00:00Z',
  });
  expect(hidden.status).toBe('waiting');
  expect(hidden.score).toBeNull();
  expect(hidden.feedback).toBeNull();
  expect(hidden.points).toBeNull();
  expect(hidden.hasNumericScore).toBe(false);
  expect(JSON.stringify(hidden)).not.toContain('內部評語');

  const zero = gradeFromSchoolAssignment({
    courseId: 'cs101',
    courseName: '資料結構',
    assignmentId: 'hw-1',
    title: '期末報告',
    closed: false,
    points: 100,
    submittedAt: '2026-10-08T00:00:00Z',
    submittedText: '初稿',
    gradePublished: true,
    gradeScore: 0,
    gradeFeedback: '',
    gradePublishedAt: '2026-10-09T00:00:00Z',
  });
  expect(zero.status).toBe('graded');
  expect(zero.score).toBe(0);
  expect(zero.hasNumericScore).toBe(true);
  expect(gradeStatusLabel(zero)).toBe('已評分 · 0 / 100 分');
});

it('marks a newly published result unread and clears it only for that version', () => {
  const owner = gradeReadOwner('nuni', 'pa_1');
  const item = gradeFromNuniAssignment(course, assignment({
    mySubmission: {
      assignmentId: 'cwa_00000000-0000-0000-0000-000000000001',
      platformAccountId: 'pa_00000000-0000-0000-0000-000000000001',
      displayName: '學生',
      body: '內容',
      state: 'submitted',
      submittedAt: '2026-10-08T00:00:00Z',
      teacherFeedback: '第一版',
      reviewedAt: '2026-10-09T04:00:00Z',
    },
  }));
  expect(isPublishedGradeUnread(owner, item)).toBe(true);
  markPublishedGradeRead(owner, item);
  expect(isPublishedGradeUnread(owner, item)).toBe(false);
  const revised = { ...item, publishedAt: '2026-10-10T04:00:00Z', feedback: '更正後' };
  expect(isPublishedGradeUnread(owner, revised)).toBe(true);
  expect(gradeItemKey(item)).toContain(item.id);
});

it('filters unread independently of waiting or missing work', () => {
  const owner = 'school:alice';
  const graded = gradeFromSchoolAssignment({
    courseId: 'cs101',
    courseName: '資料結構',
    assignmentId: 'hw-1',
    title: '報告',
    closed: false,
    points: 100,
    submittedAt: '2026-10-08T00:00:00Z',
    submittedText: '內容',
    gradePublished: true,
    gradeScore: 88,
    gradeFeedback: '清楚',
    gradePublishedAt: '2026-10-09T00:00:00Z',
  });
  const waiting = gradeFromSchoolAssignment({
    courseId: 'cs101',
    courseName: '資料結構',
    assignmentId: 'hw-2',
    title: '習題',
    closed: false,
    points: 100,
    submittedAt: '2026-10-08T00:00:00Z',
    submittedText: '內容',
    gradePublished: false,
    gradeScore: 99,
  });
  expect(matchesGradeFilter(graded, 'unread', owner)).toBe(true);
  expect(matchesGradeFilter(waiting, 'unread', owner)).toBe(false);
  expect(matchesGradeFilter(waiting, 'waiting', owner)).toBe(true);
  expect(summarizeGradeItems([graded, waiting], owner)).toEqual({
    graded: 1,
    waiting: 1,
    missing: 0,
    unread: 1,
  });
  expect(gradeFilterLabel('missing')).toBe('缺交');
});

it('sorts missing and waiting work ahead of older published results', () => {
  const missing = gradeFromNuniAssignment(course, assignment({ title: '尚未繳' }));
  const graded = gradeFromNuniAssignment(course, assignment({
    title: '已評',
    mySubmission: {
      assignmentId: 'cwa_00000000-0000-0000-0000-000000000001',
      platformAccountId: 'pa_00000000-0000-0000-0000-000000000001',
      displayName: '學生',
      body: '內容',
      state: 'submitted',
      submittedAt: '2026-10-01T00:00:00Z',
      teacherFeedback: '好',
      reviewedAt: '2026-10-02T00:00:00Z',
    },
  }));
  expect(sortGradeItems([graded, missing]).map((item) => item.title)).toEqual(['尚未繳', '已評']);
});

it('stores nuni and school unread marks on separate owners', () => {
  expect(gradeSourceFromHref('/classroom/course/cw_1#assignment-a')).toBe('nuni');
  expect(gradeSourceFromHref('/course/cs101#assignment-hw-1')).toBe('school');
  expect(gradeOwnerForSource('nuni', 'pa_1', 'alice')).toBe('nuni:pa_1');
  expect(gradeOwnerForSource('school', 'pa_1', 'alice')).toBe('school:alice');
});

it('keeps a denied course from looking like an empty gradebook', () => {
  expect(courseGradeFailure(new NuniError(403, 'ACCESS_DENIED'))).toEqual({
    status: 'denied',
    message: GRADE_COPY.denied,
  });
  expect(courseGradeFailure(new Error('offline'), { online: false }).status).toBe('offline');
});

it('does not borrow another source account for read markers', () => {
  expect(gradeOwnerForSource('nuni', null, 'student-b')).toBe('');
  expect(gradeOwnerForSource('school', 'student-a', null)).toBe('');
  const item = { source: 'nuni' as const, courseId: 'synthetic-course', kind: 'quiz' as const,
    id: 'synthetic-quiz', status: 'graded' as const, publishedAt: '2026-10-31T00:00:00Z' };
  markPublishedGradeRead(gradeReadOwner('nuni', 'student-a'), item);
  expect(isPublishedGradeUnread(gradeReadOwner('nuni', 'student-a'), item)).toBe(false);
  expect(isPublishedGradeUnread(gradeReadOwner('nuni', 'student-b'), item)).toBe(true);
  expect(isPublishedGradeUnread(gradeReadOwner('school', 'student-a'), item)).toBe(true);
});
