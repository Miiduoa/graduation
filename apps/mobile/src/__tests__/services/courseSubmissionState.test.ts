import {
  canListAsPendingWork,
  canSubmitCourseWork,
  courseSubmissionState,
  submissionStatusText,
  summarizeCourseReceipts,
} from '../../features/courseSubmissionState';

test('only a server timestamp confirms that coursework was submitted', () => {
  expect(courseSubmissionState(null)).toEqual({ kind: 'not_submitted' });
  expect(courseSubmissionState({ status: 'draft', content: 'first version' })).toEqual({ kind: 'draft' });
  expect(courseSubmissionState({ status: 'submitted', submittedAt: 'invalid-date' }))
    .toEqual({ kind: 'unconfirmed' });
  expect(courseSubmissionState({ status: 'submitted', submittedAt: null }))
    .toEqual({ kind: 'unconfirmed' });
  expect(courseSubmissionState({ status: 'submitted', submittedAt: { unexpected: 'object' } }))
    .toEqual({ kind: 'unconfirmed' });
  expect(courseSubmissionState({
    status: 'submitted',
    submittedAt: { toDate: () => { throw new Error('invalid timestamp'); } },
  })).toEqual({ kind: 'unconfirmed' });
  expect(submissionStatusText({ kind: 'unconfirmed' })).toContain('尚未確認');
});

test('an acknowledged submission is not reopened as pending work', () => {
  const record = {
    status: 'submitted',
    submittedAt: { toDate: () => new Date('2026-10-26T15:59:00Z') },
    gradePublished: false,
    gradeScore: 100,
    gradeFeedback: 'private until release',
  };
  const state = courseSubmissionState(record);
  expect(state).toEqual({
    kind: 'submitted',
    submittedAt: '2026-10-26T15:59:00.000Z',
    grade: null,
  });
  expect(submissionStatusText(state)).toContain('已繳交');
  expect(submissionStatusText(state)).not.toContain('100');
  expect(canListAsPendingWork(state)).toBe(false);
  expect(canListAsPendingWork({ kind: 'unavailable' })).toBe(false);
  expect(canListAsPendingWork({ kind: 'not_submitted' })).toBe(true);
  expect(canListAsPendingWork({ kind: 'draft' })).toBe(true);
});

test('published and valid instructor grades are displayed, but missing grade consent is never inferred', () => {
  const state = courseSubmissionState({
    status: 'submitted',
    submittedAt: '2026-10-26T16:00:00Z',
    gradePublished: true,
    gradeScore: 87,
    gradeFeedback: '請補上資料來源',
    gradeRevisionCount: 2,
  });
  expect(state).toMatchObject({
    kind: 'submitted',
    grade: {
      score: 87,
      feedback: '請補上資料來源',
      revisionCount: 2,
    },
  });
  expect(submissionStatusText(state)).toBe('已繳交 · 已發布評分 87 分');

  expect(courseSubmissionState({
    submittedAt: '2026-10-26T16:00:00Z',
    gradePublished: true,
    gradeScore: '87',
  })).toMatchObject({ kind: 'submitted', grade: null });
});

test('course receipt counts never turn unverified or instructor records into submitted totals', () => {
  const summary = summarizeCourseReceipts([
    { submission: { kind: 'not_submitted' } },
    { submission: { kind: 'draft' } },
    { submission: { kind: 'unconfirmed' } },
    { submission: { kind: 'unavailable' } },
    { submission: { kind: 'instructor' } },
    { submission: courseSubmissionState({
      submittedAt: '2026-10-26T16:00:00Z',
      gradePublished: true,
      gradeScore: 91,
    }) },
    { submission: courseSubmissionState({
      submittedAt: '2026-10-26T16:00:00Z',
      gradePublished: false,
      gradeScore: 100,
    }) },
    {},
  ]);
  expect(summary).toEqual({
    submitted: 2,
    graded: 1,
    unsubmitted: 2,
    needsVerification: 3,
  });
});

test('a passed due date cannot be described as actionable unless the instructor permits late work', () => {
  const now = new Date('2026-10-26T12:00:00Z');
  const pending = {
    closed: false,
    dueAt: '2026-10-26T11:00:00Z',
    submission: { kind: 'not_submitted' as const },
  };
  expect(canSubmitCourseWork(pending, now)).toBe(false);
  expect(canSubmitCourseWork({ ...pending, allowLateSubmission: true }, now)).toBe(true);
  expect(canSubmitCourseWork({ ...pending, closed: true, allowLateSubmission: true }, now)).toBe(false);
  expect(canSubmitCourseWork({
    ...pending,
    submission: { kind: 'submitted', submittedAt: '2026-10-26T10:00:00Z', grade: null },
    allowLateSubmission: true,
  }, now)).toBe(false);
  expect(canSubmitCourseWork({ ...pending, dueAt: 'invalid', allowLateSubmission: true }, now)).toBe(false);
  expect(canSubmitCourseWork({ ...pending, dueAt: null }, now)).toBe(true);
});

test('closed overdue work stays blocked even when late submission is marked allowed', () => {
  const now = new Date('2026-10-26T12:00:00+08:00');
  const closedLate = {
    closed: true,
    dueAt: '2026-10-20T23:59:00+08:00',
    allowLateSubmission: true,
    submission: { kind: 'not_submitted' as const },
  };
  expect(canSubmitCourseWork(closedLate, now)).toBe(false);
  expect(
    canSubmitCourseWork({ ...closedLate, closed: false }, now),
  ).toBe(true);
});

test('Taipei-naive due strings share the same instant as an explicit +08:00 deadline', () => {
  const now = new Date('2026-10-26T12:00:00+08:00');
  const naive = {
    closed: false,
    dueAt: '2026-10-26T15:59:00',
    submission: { kind: 'not_submitted' as const },
  };
  const explicit = { ...naive, dueAt: '2026-10-26T15:59:00+08:00' };
  expect(canSubmitCourseWork(naive, now)).toBe(canSubmitCourseWork(explicit, now));
  expect(canSubmitCourseWork(naive, new Date('2026-10-26T16:00:00+08:00'))).toBe(false);
});


test.each(['', '   '])('blank deadline %j requires confirmation', (dueAt) => {
  expect(canSubmitCourseWork({ closed: false, dueAt, allowLateSubmission: true,
    submission: { kind: 'not_submitted' } })).toBe(false);
});
