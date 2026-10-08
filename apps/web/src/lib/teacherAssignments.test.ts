import { beforeEach, expect, it, vi } from 'vitest';
import {
  getDocFromServer,
  getDocsFromServer,
  runTransaction,
} from 'firebase/firestore';
import {
  loadTeacherSubmissions,
  publishSubmissionGrade,
  publishTeacherAssignment,
  reviseSubmissionGrade,
  loadGradeRevisions,
  loadEditableTeacherAssignment,
  updateTeacherAssignment,
  toTaipeiDateTimeInput,
} from './teacherAssignments';

const auth = vi.hoisted(() => ({ uid: 'teacher' }));
vi.mock('./firebase', () => ({
  getDb: () => ({}),
  getAuth: () => ({ currentUser: { uid: auth.uid } }),
}));
vi.mock('./teacherCourse', () => ({
  authorizeTeacherCourse: vi.fn(async () => ({ id: 'course' })),
  TeacherCourseError: class TeacherCourseError extends Error {},
}));
vi.mock('firebase/firestore', () => ({
  collection: (root: unknown, ...parts: string[]) =>
    (typeof root === 'string' ? root + '/' : '') + parts.join('/'),
  doc: (root: unknown, ...parts: string[]) =>
    (typeof root === 'string' ? root + '/' : '') + (parts.length ? parts.join('/') : 'generated'),
  getDocFromServer: vi.fn(),
  getDocsFromServer: vi.fn(),
  runTransaction: vi.fn(),
  serverTimestamp: () => 'server-time',
}));

const scope = { uid: 'teacher', schoolId: 'pu', courseId: 'course' };
const document = (data: Record<string, unknown> | null) => ({
  exists: () => data !== null,
  data: () => data,
});
const records: Record<string, Record<string, unknown> | null> = {};
const transaction = {
  get: vi.fn(async (path: string) => document(records[path] ?? null)),
  set: vi.fn(),
  update: vi.fn(),
};
const draft = {
  title: '  練習一  ',
  description: '  樹狀結構  ',
  points: 100,
  dueAt: '',
  allowLateSubmission: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  auth.uid = 'teacher';
  for (const key of Object.keys(records)) delete records[key];
  Object.assign(records, {
    'schools/pu/members/teacher': { status: 'active' },
    'groups/course/members/teacher': { status: 'active', role: 'instructor' },
    'groups/course': { type: 'course', schoolId: 'pu' },
    'groups/course/assignments/work': null,
    'groups/course/assignments/work/submissions/student': {
      userId: 'student',
      content: '已繳交',
      submittedAt: '2026-10-08T01:00:00Z',
    },
  });
  transaction.get.mockImplementation(async (path: string) => document(records[path] ?? null));
  vi.mocked(runTransaction).mockImplementation(async (_db, callback) =>
    callback(transaction as never));
  vi.mocked(getDocFromServer).mockImplementation(async (path) =>
    document(records[String(path)] ?? null) as never);
  vi.mocked(getDocsFromServer).mockResolvedValue({ docs: [] } as never);
});

it('publishes a real assignment only after verifying both memberships and the course', async () => {
  records['groups/course/assignments/work'] = {
    title: '練習一', description: '樹狀結構',
    createdBy: 'teacher', points: 100, dueAt: null, allowLateSubmission: false,
  };
  await publishTeacherAssignment(scope, 'work', draft);
  expect(transaction.get.mock.calls.slice(0, 3).map(([path]) => path)).toEqual([
    'schools/pu/members/teacher',
    'groups/course/members/teacher',
    'groups/course',
  ]);
  expect(transaction.set).not.toHaveBeenCalled(); // Safe replay acknowledges the same published assignment without rewriting it.
});

it('persists the published payload and limits drafts to textual assignment types', async () => {
  vi.mocked(getDocFromServer).mockResolvedValueOnce(document({ createdBy: 'teacher' }) as never);
  await publishTeacherAssignment(scope, 'work', draft);
  expect(transaction.set).toHaveBeenCalledWith(
    'groups/course/assignments/work',
    expect.objectContaining({
      title: '練習一',
      description: '樹狀結構',
      type: 'assignment',
      points: 100,
      dueAt: null,
      published: true,
      status: 'published',
      createdBy: 'teacher',
      createdAt: 'server-time',
    }),
  );
});

it.each([
  ['no school membership', 'schools/pu/members/teacher', null],
  ['revoked course membership', 'groups/course/members/teacher', { status: 'removed', role: 'instructor' }],
  ['student role', 'groups/course/members/teacher', { status: 'active', role: 'member' }],
  ['wrong school', 'groups/course', { type: 'course', schoolId: 'wrong' }],
])('blocks assignment writes on %s', async (_label, path, value) => {
  records[path as string] = value as Record<string, unknown> | null;
  await expect(publishTeacherAssignment(scope, 'work', draft)).rejects.toThrow();
  expect(transaction.set).not.toHaveBeenCalled();
});

it('rejects invalid fields without starting any write', async () => {
  await expect(publishTeacherAssignment(scope, 'work', { ...draft, points: 0 })).rejects.toThrow();
  await expect(publishTeacherAssignment(scope, 'work', { ...draft, dueAt: '2001-01-01T00:00' })).rejects.toThrow();
  await expect(publishTeacherAssignment(scope, 'work', { ...draft, title: ' ' })).rejects.toThrow();
  expect(runTransaction).not.toHaveBeenCalled();
});

it('blocks retry with changed content rather than overwriting an existing assignment', async () => {
  records['groups/course/assignments/work'] = {
    title: '不同作業', createdBy: 'teacher', points: 100,
  };
  await expect(publishTeacherAssignment(scope, 'work', draft)).rejects.toThrow('可能已建立');
  expect(transaction.set).not.toHaveBeenCalled();
});

it('publishes a zero score without modifying the student answer', async () => {
  records['groups/course/assignments/work'] = { title: '練習一', type: 'assignment', points: 100 };
  vi.mocked(getDocFromServer).mockResolvedValueOnce(document({
    gradePublished: true, gradeScore: 0, gradePublishedBy: 'teacher',
  }) as never);
  await publishSubmissionGrade(scope, 'work', 'student', 0, '  需要補充內容  ');
  expect(transaction.update).toHaveBeenCalledWith(
    'groups/course/assignments/work/submissions/student',
    {
      gradeScore: 0,
      gradeFeedback: '需要補充內容',
      gradePublished: true,
      gradePublishedBy: 'teacher',
      gradePublishedAt: 'server-time',
    },
  );
});

it('refuses scores over the maximum, missing submissions and already published grades', async () => {
  records['groups/course/assignments/work'] = { type: 'assignment', points: 60 };
  await expect(publishSubmissionGrade(scope, 'work', 'student', 61, '')).rejects.toThrow('配分');
  records['groups/course/assignments/work/submissions/student'] = null;
  await expect(publishSubmissionGrade(scope, 'work', 'student', 15, '')).rejects.toThrow('尚未繳交');
  records['groups/course/assignments/work/submissions/student'] = {
    userId: 'student', submittedAt: '2026-10-08', gradePublished: true,
    gradePublishedBy: 'other', gradeScore: 15, gradeFeedback: '',
  };
  await expect(publishSubmissionGrade(scope, 'work', 'student', 15, '')).rejects.toThrow('已發布');
  expect(transaction.update).not.toHaveBeenCalled();
});

it('discards results when account changes during a transaction', async () => {
  transaction.get.mockImplementation(async (path: string) => {
    if (path === 'groups/course') auth.uid = 'someone-else';
    return document(records[path] ?? null);
  });
  await expect(publishTeacherAssignment(scope, 'work', draft)).rejects.toThrow('登入身分');
  expect(transaction.set).not.toHaveBeenCalled();
});

it('loads only confirmed submissions and does not show unpublished grades', async () => {
  records['groups/course/assignments/work'] = { title: '練習一', points: 100 };
  vi.mocked(getDocsFromServer).mockResolvedValueOnce({
    docs: [
      { id: 'student', data: () => ({
        userId: 'student', content: '答案', submittedAt: '2026-10-08',
        gradeScore: 95, gradePublished: false,
      }) },
      { id: 'other', data: () => ({ userId: 'someone-else', submittedAt: '2026-10-08' }) },
    ],
  } as never);
  const result = await loadTeacherSubmissions(scope, 'work');
  expect(result.submissions).toHaveLength(1);
  expect(result.submissions[0].score).toBeNull();
  expect(result.submissions[0].content).toBe('答案');
});


const previousGrade = {
  score: 60,
  feedback: '原評語',
  gradedAt: '2026-10-08T01:00:00.000Z',
};

function seedPublishedGrade() {
  records['groups/course/assignments/work'] = {
    type: 'assignment', points: 100,
  };
  records['groups/course/assignments/work/submissions/student'] = {
    userId: 'student', submittedAt: '2026-10-08T00:00:00Z',
    gradePublished: true, gradeScore: 60, gradeFeedback: '原評語',
    gradePublishedAt: previousGrade.gradedAt,
  };
}

it('changes a published grade and writes its history atomically', async () => {
  seedPublishedGrade();
  vi.mocked(getDocFromServer).mockImplementation(async (path) =>
    document(String(path).endsWith('/gradeRevisions/revision-1234567890')
      ? { afterScore: 80, changedBy: 'teacher' }
      : { gradePublished: true, gradeRevisionId: 'revision-1234567890', gradeScore: 80 }
    ) as never);
  await reviseSubmissionGrade(scope, 'work', 'student', 'revision-1234567890',
    previousGrade, 80, '調整後評語', '重新核對評分規準');
  expect(transaction.update).toHaveBeenCalledWith(
    'groups/course/assignments/work/submissions/student',
    expect.objectContaining({
      gradeScore: 80, gradeFeedback: '調整後評語',
      gradeRevisionId: 'revision-1234567890', gradeRevisionCount: 1,
      gradePublishedAt: 'server-time', gradeRevisedAt: 'server-time',
      gradeRevisionReason: '重新核對評分規準',
    }),
  );
  expect(transaction.set).toHaveBeenCalledWith(
    'groups/course/assignments/work/submissions/student/gradeRevisions/revision-1234567890',
    {
      beforeScore: 60, afterScore: 80, beforeFeedback: '原評語',
      afterFeedback: '調整後評語', reason: '重新核對評分規準',
      changedBy: 'teacher', changedAt: 'server-time', revision: 1,
    },
  );
});

it('rejects stale grades, preventing one teacher from overwriting another', async () => {
  seedPublishedGrade();
  records['groups/course/assignments/work/submissions/student'] = {
    ...(records['groups/course/assignments/work/submissions/student'] ?? {}),
    gradeScore: 75,
  };
  await expect(reviseSubmissionGrade(scope, 'work', 'student', 'revision-1234567890',
    previousGrade, 80, '新評語', '重新核對配分')).rejects.toThrow('其他教師');
  expect(transaction.update).not.toHaveBeenCalled();
  expect(transaction.set).not.toHaveBeenCalled();
});

it('requires a meaningful reason and a valid score before any transaction', async () => {
  await expect(reviseSubmissionGrade(scope, 'work', 'student', 'revision-1234567890',
    previousGrade, 70, '新評語', '錯')).rejects.toThrow('更正原因');
  await expect(reviseSubmissionGrade(scope, 'work', 'student', 'revision-1234567890',
    previousGrade, 60, '原評語', '重新核對配分')).rejects.toThrow('均未改變');
  await expect(reviseSubmissionGrade(scope, 'work', 'student', 'revision-1234567890',
    previousGrade, 70.1234, '新評語', '重新核對配分')).rejects.toThrow('兩位小數');
  expect(runTransaction).not.toHaveBeenCalled();
});

it('rejects an attempt to correct a grade beyond assignment points', async () => {
  seedPublishedGrade();
  await expect(reviseSubmissionGrade(scope, 'work', 'student', 'revision-1234567890',
    previousGrade, 101, '', '重新核對配分')).rejects.toThrow('超過作業配分');
  expect(transaction.update).not.toHaveBeenCalled();
  expect(transaction.set).not.toHaveBeenCalled();
});

it('allows safe replay of the same correction without a second audit record', async () => {
  seedPublishedGrade();
  records['groups/course/assignments/work/submissions/student'] = {
    ...(records['groups/course/assignments/work/submissions/student'] ?? {}),
    gradeRevisionId: 'revision-1234567890', gradeScore: 80,
    gradeFeedback: '新評語',
  };
  records['groups/course/assignments/work/submissions/student/gradeRevisions/revision-1234567890'] = {
    beforeScore: 60, afterScore: 80, beforeFeedback: '原評語',
    afterFeedback: '新評語', changedBy: 'teacher', reason: '重新核對配分',
  };
  vi.mocked(getDocFromServer).mockImplementation(async (path) =>
    document(records[String(path)] ?? null) as never);
  await reviseSubmissionGrade(scope, 'work', 'student', 'revision-1234567890',
    previousGrade, 80, '新評語', '重新核對配分');
  expect(transaction.update).not.toHaveBeenCalled();
  expect(transaction.set).not.toHaveBeenCalled();
});

it('reads grade revisions only through a permission-checked teacher scope', async () => {
  vi.mocked(getDocsFromServer).mockResolvedValue({
    docs: [{ id: 'r1', data: () => ({
      beforeScore: 50, afterScore: 60,
      beforeFeedback: '', afterFeedback: '重新檢查',
      reason: '配分修正', changedBy: 'teacher', changedAt: '2026-10-08',
    }) }],
  } as never);
  const rows = await loadGradeRevisions(scope, 'work', 'student');
  expect(rows).toHaveLength(1);
  expect(rows[0].beforeScore).toBe(50);
  expect(getDocsFromServer).toHaveBeenCalledWith(
    'groups/course/assignments/work/submissions/student/gradeRevisions',
  );
});


const editable = {
  title: '新版練習', description: '補充說明', dueAt: '',
  allowLateSubmission: true,
};

it('loads an assignment only for its original author', async () => {
  records['groups/course/assignments/work'] = {
    type: 'assignment', createdBy: 'teacher', title: '原作業',
    description: '說明', updatedAt: '2026-10-08T01:00:00Z',
  };
  const result = await loadEditableTeacherAssignment(scope, 'work');
  expect(result.title).toBe('原作業');
  records['groups/course/assignments/work'] = {
    ...records['groups/course/assignments/work'], createdBy: 'another',
  };
  await expect(loadEditableTeacherAssignment(scope, 'work')).rejects.toThrow('沒有權限');
});

it('updates only editable assignment fields with optimistic concurrency', async () => {
  records['groups/course/assignments/work'] = {
    type: 'assignment', createdBy: 'teacher', published: true,
    status: 'published', updatedAt: '2026-10-08T01:00:00Z',
  };
  await updateTeacherAssignment(scope, 'work', '2026-10-08T01:00:00.000Z', editable);
  expect(transaction.update).toHaveBeenCalledWith(
    'groups/course/assignments/work',
    {
      title: '新版練習', description: '補充說明', dueAt: null,
      allowLateSubmission: true, updatedAt: 'server-time', lastEditedBy: 'teacher',
    },
  );
});

it('rejects stale assignment edits without any write', async () => {
  records['groups/course/assignments/work'] = {
    type: 'assignment', createdBy: 'teacher', published: true,
    status: 'published', updatedAt: '2026-10-08T02:00:00Z',
  };
  await expect(updateTeacherAssignment(scope, 'work', '2026-10-08T01:00:00Z', editable))
    .rejects.toThrow('其他操作更新');
  expect(transaction.update).not.toHaveBeenCalled();
});

it('rejects editing assignments authored by another teacher or already closed', async () => {
  records['groups/course/assignments/work'] = {
    type: 'assignment', createdBy: 'other', published: true,
    status: 'published', updatedAt: '2026-10-08T01:00:00Z',
  };
  await expect(updateTeacherAssignment(scope, 'work', '2026-10-08T01:00:00Z', editable))
    .rejects.toThrow('原建立教師');
  records['groups/course/assignments/work'] = {
    ...records['groups/course/assignments/work'], createdBy: 'teacher', status: 'closed',
  };
  await expect(updateTeacherAssignment(scope, 'work', '2026-10-08T01:00:00Z', editable))
    .rejects.toThrow('不可編輯');
  expect(transaction.update).not.toHaveBeenCalled();
});

it('validates edited assignment fields before a database transaction', async () => {
  await expect(updateTeacherAssignment(scope, 'work', null, { ...editable, title: ' ' }))
    .rejects.toThrow('標題');
  await expect(updateTeacherAssignment(scope, 'work', null, { ...editable, dueAt: 'not-a-date' }))
    .rejects.toThrow('截止時間');
  expect(runTransaction).not.toHaveBeenCalled();
});


it('uses Taiwan school time for deadlines instead of the browser local timezone', async () => {
  expect(toTaipeiDateTimeInput('2026-10-08T01:30:00.000Z')).toBe('2026-10-08T09:30');
  expect(toTaipeiDateTimeInput('not-a-date')).toBe('');
  vi.mocked(getDocFromServer).mockResolvedValueOnce(document({ createdBy: 'teacher' }) as never);
  await publishTeacherAssignment(scope, 'work', {
    ...draft, dueAt: '2099-06-01T10:45',
  });
  expect(transaction.set).toHaveBeenCalledWith(
    'groups/course/assignments/work',
    expect.objectContaining({ dueAt: '2099-06-01T02:45:00.000Z' }),
  );
});

it('refuses invalid calendar dates rather than silently shifting deadlines', async () => {
  await expect(publishTeacherAssignment(scope, 'work', {
    ...draft, dueAt: '2099-02-30T12:00',
  })).rejects.toThrow('截止時間');
  await expect(updateTeacherAssignment(scope, 'work', null, {
    ...editable, dueAt: '2099-02-30T12:00',
  })).rejects.toThrow('截止時間');
  expect(runTransaction).not.toHaveBeenCalled();
});

it('converts a Taipei-local edit back to the matching UTC instant', async () => {
  records['groups/course/assignments/work'] = {
    type: 'assignment', createdBy: 'teacher', published: true,
    status: 'published', updatedAt: '2026-10-08T01:00:00Z',
  };
  await updateTeacherAssignment(scope, 'work', '2026-10-08T01:00:00.000Z', {
    ...editable, dueAt: '2099-06-01T10:45',
  });
  expect(transaction.update).toHaveBeenCalledWith(
    'groups/course/assignments/work',
    expect.objectContaining({ dueAt: '2099-06-01T02:45:00.000Z' }),
  );
});
