import type { PersonalImportRecord } from '@campus/shared';
import { CourseAccessError, courseScope, sameCourseScope } from '@campus/shared/src/courseAccess';
import { parseCourseWorkspace } from '@campus/shared/src/courseAccessClient';
import { NuniError, nuniId, nuniRecord } from '@campus/shared/src/nuni';
import { toPublicSchoolId } from '@campus/shared/src/schoolIds';
import { abortableCampusRead } from '../services/abortableCampusRead';
import type { AssistantCalendarContext } from '../services/assistantCalendarExecution';
import { readAssistantTimetable } from '../services/assistantTimetableSource';
import { subscribeNuniAssignmentChanges } from '../services/nuniAssignmentChanges';
import { currentSavedClasses, nextSavedClasses } from '../services/nextSavedClasses';
import { readNuniPlanAssignmentTarget, type NuniPlanAssignmentSource } from '../services/nuniPlanAssignmentTarget';
import { subscribePersonalImports } from '../services/personalImports';
import { subscribeTimetableChanges } from '../widgets/timetableChanges';
import { answerNuniCoursework, type CourseworkRead, type CourseworkRequests } from './nuniCourseworkFollowUp';
import { isCourseworkStudyInstant } from './nuniCourseworkStudy';

export type NuniPlanCourseworkStudyResult =
  | { kind: 'ready'; read: CourseworkRead; assignmentId: string }
  | { kind: 'changed' | 'unavailable' | 'cancelled'; message: string };

type Lookup = {
  source: NuniPlanAssignmentSource;
  context: AssistantCalendarContext;
  transport: CourseworkRequests;
  signal?: AbortSignal;
};
type TimetableRead = NonNullable<Awaited<ReturnType<typeof readAssistantTimetable>>>;
type Binding = {
  fingerprint: string;
  records: PersonalImportRecord[];
  updatedAt: string | null;
};
type FailureKind = Exclude<NuniPlanCourseworkStudyResult['kind'], 'ready'>;
const WAIT_MS = 20_000;
const CHANGED = '作業來源、課程連結或課表已變更，請依目前資料重新規劃後再安排準備時間。';
const UNAVAILABLE = '目前無法完整核對這份作業，請稍後重試，或開啟原作業確認。';
const STOPPED = '已停止核對這份作業，尚未建立準備行程。';
const IDENTITY_CHANGED = '帳號或學校狀態已變更，請重新規劃後再安排這份作業。';

class PlanStudyError extends Error {
  constructor(readonly kind: FailureKind, message: string) { super(message); }
}

function sourceLocator(value: unknown): Readonly<NuniPlanAssignmentSource> {
  const raw = nuniRecord(value);
  const scope = courseScope(raw);
  if (scope.schoolId !== raw.schoolId || scope.academicYear !== raw.academicYear ||
      scope.semester !== raw.semester || (toPublicSchoolId(scope.schoolId) || scope.schoolId) !== scope.schoolId) {
    throw new PlanStudyError('changed', CHANGED);
  }
  // Copy only identifiers before the first await. Plan text, slots and saved
  // checklist state never supply a coursework read or a calendar write grant.
  return Object.freeze({ ...scope, accountId: nuniId(raw.accountId, 'pa'),
    workspaceId: nuniId(raw.workspaceId, 'cw'), assignmentId: nuniId(raw.assignmentId, 'cwa') });
}

function binding(value: TimetableRead | null, source: NuniPlanAssignmentSource): Binding {
  if (!value || value.schoolId !== source.schoolId || !Array.isArray(value.records) ||
      value.records.some((row) => !row || row.kind !== 'timetable' || row.schoolId !== source.schoolId ||
        typeof row.id !== 'string' || !row.id)) throw new PlanStudyError('unavailable', UNAVAILABLE);
  const records = JSON.parse(JSON.stringify(value.records)) as PersonalImportRecord[];
  if (new Set(records.map((row) => row.id)).size !== records.length) {
    throw new PlanStudyError('unavailable', '課表含有無法分辨的重複紀錄，請先核對課表再安排。');
  }
  const linked = records.filter((row) => row.linkedCourseId === source.workspaceId);
  if (!linked.length) throw new PlanStudyError('changed', CHANGED);
  for (const row of linked) {
    try {
      if (!sameCourseScope(courseScope(row), source)) throw new Error('Different course term');
    } catch { throw new PlanStudyError('changed', CHANGED); }
  }
  return {
    fingerprint: JSON.stringify({ schoolId: value.schoolId, updatedAt: value.updatedAt,
      records: records.slice().sort((a, b) => a.id.localeCompare(b.id)) }),
    records: linked, updatedAt: value.updatedAt,
  };
}

/**
 * An exact live-plan locator starts a fresh read through the existing coursework
 * reader. It cannot execute, restore a saved plan's authority or reuse its slot.
 */
export async function readNuniPlanCourseworkStudy(input: Lookup): Promise<NuniPlanCourseworkStudyResult> {
  let source: Readonly<NuniPlanAssignmentSource>;
  try { source = sourceLocator(input.source); }
  catch { return { kind: 'changed', message: CHANGED }; }
  const context = input.context;
  const platform = context?.platformTimetable;
  const request = input.transport?.request;
  const bffRequest = input.transport?.bffRequest;
  const signal = input.signal;
  const sameIdentity = () => {
    try {
      return !!platform && !context.uid && context.platformTimetable === platform &&
        context.schoolId === source.schoolId && platform.accountId === source.accountId &&
        context.isCurrent() && platform.isCurrent();
    } catch { return false; }
  };
  if (!sameIdentity()) return { kind: 'changed', message: IDENTITY_CHANGED };
  if (signal?.aborted) return { kind: 'cancelled', message: STOPPED };
  if (typeof request !== 'function' || typeof bffRequest !== 'function') {
    return { kind: 'unavailable', message: UNAVAILABLE };
  }
  const abort = new AbortController();
  let running = true;
  let timedOut = false;
  let invalidated = false;
  const stop = () => abort.abort();
  const invalidate = () => { invalidated = true; stop(); };
  const active = () => running && !abort.signal.aborted && sameIdentity();
  const assertCurrent = () => {
    if (!active()) throw new NuniError(409, 'SESSION_CHANGED');
  };
  signal?.addEventListener('abort', stop, { once: true });
  if (signal?.aborted) stop();
  const unsubscribeAssignment = subscribeNuniAssignmentChanges((event) => {
    if (event.accountId === source.accountId && event.workspaceId === source.workspaceId &&
        event.assignmentId === source.assignmentId) invalidate();
  });
  const unsubscribeTimetable = subscribeTimetableChanges(invalidate);
  const unsubscribeImports = subscribePersonalImports(({ scope }) => {
    if (scope.owner === `nuni:${source.accountId}` && scope.schoolId === source.schoolId) invalidate();
  });
  const timer = setTimeout(() => { timedOut = true; stop(); }, WAIT_MS);
  const workspacePath = `class-workspaces/${source.workspaceId}`;
  const assignmentsPath = `${workspacePath}/assignments`;
  let expectedReviewed: CourseworkRead['expectedReviewed'];
  const transport: CourseworkRequests = {
    request: async (path, body) => {
      assertCurrent();
      if (!['class-workspaces', workspacePath, 'course-access/workspace-course'].includes(path)) {
        throw new NuniError(422, 'INVALID_INPUT');
      }
      const value = await abortableCampusRead(() => request(path, body), abort.signal);
      assertCurrent();
      if (path === 'course-access/workspace-course') {
        const detail = parseCourseWorkspace(value, source.workspaceId, source.schoolId);
        if (detail.memberRole !== 'student' ||
            (detail.status === 'reviewed' && !sameCourseScope(detail.course, source))) {
          throw new NuniError(403, 'FORBIDDEN');
        }
        if (detail.status === 'reviewed' && !expectedReviewed) {
          const { schoolId, academicYear, semester, courseCode, teacher, className } = detail.course;
          expectedReviewed = { schoolId, academicYear, semester, courseCode, teacher, className };
        }
      }
      return value;
    },
    bffRequest: async (path) => {
      assertCurrent();
      if (path !== assignmentsPath) throw new NuniError(422, 'INVALID_INPUT');
      const value = await abortableCampusRead(() => bffRequest(path), abort.signal);
      assertCurrent();
      const rows = nuniRecord(value).assignments;
      // The shared assignment parser caps its array; inspect the original BFF
      // response on every read so excess or duplicate rows cannot disappear.
      if (!Array.isArray(rows) || rows.length > 100 ||
          new Set(rows.map((row) => nuniId(nuniRecord(row).id, 'cwa'))).size !== rows.length) {
        throw new NuniError(502, 'INVALID_RESPONSE');
      }
      return value;
    },
  };
  const readBinding = async () => {
    assertCurrent();
    const value = await abortableCampusRead(() => readAssistantTimetable('', source.schoolId,
      { accountId: source.accountId, isCurrent: active }), abort.signal);
    assertCurrent();
    return binding(value, source);
  };
  try {
    const before = await readBinding();
    const now = new Date();
    const occurrences = currentSavedClasses(before.records, source.schoolId, now);
    const candidates = occurrences?.length ? occurrences
      : nextSavedClasses(before.records, source.schoolId, now);
    const occurrence = candidates?.slice().sort((a, b) => a.courseId.localeCompare(b.courseId))[0];
    if (!occurrence) return { kind: 'unavailable',
      message: '這門課目前沒有可重新核對的近期上課時段，請先在課表核對日期與時間，或開啟原作業確認。' };
    assertCurrent();
    const target = await abortableCampusRead(() => readNuniPlanAssignmentTarget({
      source, accountId: source.accountId, schoolId: source.schoolId,
      isCurrent: active, signal: abort.signal, ...transport,
    }), abort.signal);
    assertCurrent();
    if (target.kind !== 'ready') return { kind: target.kind === 'unavailable' ? 'unavailable'
      : target.kind === 'cancelled' ? 'cancelled' : 'changed',
      message: target.kind === 'unavailable' ? UNAVAILABLE : target.kind === 'cancelled' ? STOPPED : CHANGED };
    if (target.params.tab !== 'courses' || target.params.workspaceId !== source.workspaceId ||
        target.params.assignmentId !== source.assignmentId || target.params.assistantAccountId !== source.accountId) {
      return { kind: 'changed', message: CHANGED };
    }
    const anchor = { uid: '', owner: `nuni:${source.accountId}`, schoolId: source.schoolId,
      classes: [{ ...occurrence }], updatedAt: before.updatedAt };
    // This seed chooses an already revalidated binding. Only the real reader can
    // return an assignments result, with its current membership and receipt data.
    const seed: CourseworkRead = { anchor, result: { kind: 'unavailable' },
      selectedWorkspaceId: source.workspaceId, expectedLinkedWorkspaceId: source.workspaceId,
      ...(expectedReviewed && { expectedReviewed: { ...expectedReviewed } }),
    };
    const response = await abortableCampusRead(() => answerNuniCoursework({ courseworkRead: seed },
      { accountId: source.accountId, isCurrent: active }, source.schoolId, active, transport), abort.signal);
    assertCurrent();
    if ((await readBinding()).fingerprint !== before.fingerprint) return { kind: 'changed', message: CHANGED };
    assertCurrent();
    const read = response.courseworkRead;
    if (!read || read.result.kind === 'unavailable') return { kind: 'unavailable', message: UNAVAILABLE };
    if (read.result.kind !== 'assignments' || read.result.workspace.id !== source.workspaceId ||
        read.anchor.uid || read.anchor.owner !== anchor.owner || read.anchor.schoolId !== source.schoolId ||
        read.anchor.classes.length !== 1 || JSON.stringify(read.anchor.classes[0]) !== JSON.stringify(occurrence) ||
        read.changedAssignmentId || !isCourseworkStudyInstant(read.checkedAt) ||
        new Set(read.result.assignments.map((row) => row.id)).size !== read.result.assignments.length) {
      return { kind: 'changed', message: CHANGED };
    }
    const assignment = read.result.assignments.find((row) => row.id === source.assignmentId);
    if (!assignment) return { kind: read.result.limited ? 'unavailable' : 'changed',
      message: read.result.limited ? UNAVAILABLE : CHANGED };
    if (assignment.state !== 'open' || assignment.submittedAt !== null) return { kind: 'changed',
      message: '這份作業已停止收件或已有繳交紀錄，請先開啟原作業核對。' };
    if (!isCourseworkStudyInstant(assignment.dueAt) || Date.parse(assignment.dueAt) <= Date.now()) {
      return { kind: 'changed', message: '這份作業沒有可安排準備時間的未來截止期限，請先開啟原作業核對。' };
    }
    return { kind: 'ready', assignmentId: source.assignmentId,
      read: { ...read, selectedWorkspaceId: source.workspaceId, expectedLinkedWorkspaceId: source.workspaceId } };
  } catch (error) {
    if (timedOut) return { kind: 'unavailable', message: '核對作業的等待時間已過，請稍後重試。這次尚未建立準備行程。' };
    if (invalidated) return { kind: 'changed', message: CHANGED };
    if (signal?.aborted) return { kind: 'cancelled', message: STOPPED };
    if (!sameIdentity()) return { kind: 'changed', message: IDENTITY_CHANGED };
    if (error instanceof PlanStudyError) return { kind: error.kind, message: error.message };
    if ((error instanceof NuniError && [401, 403, 404].includes(error.status)) ||
        (error instanceof CourseAccessError && [401, 403, 404].includes(error.statusCode))) {
      return { kind: 'changed', message: CHANGED };
    }
    return { kind: 'unavailable', message: UNAVAILABLE };
  } finally {
    running = false;
    clearTimeout(timer);
    signal?.removeEventListener('abort', stop);
    unsubscribeAssignment(); unsubscribeTimetable(); unsubscribeImports();
  }
}
