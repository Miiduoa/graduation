import { CourseAccessError, courseScope, sameCourseScope } from '@campus/shared/src/courseAccess';
import { createCourseAccess, type CourseTransport } from '@campus/shared/src/courseAccessClient';
import { createNuniClasses, NuniError, nuniId, nuniRecord } from '@campus/shared/src/nuni';
import { toPublicSchoolId } from '@campus/shared/src/schoolIds';
import { readAssistantTimetable } from './assistantTimetableSource';

/** A live plan's exact reference, never an authorization or a saved-plan action grant. */
export type NuniPlanAssignmentSource = {
  accountId: string;
  schoolId: string;
  academicYear: string;
  semester: string;
  workspaceId: string;
  assignmentId: string;
};

export type NuniPlanQuizSource = Omit<NuniPlanAssignmentSource, 'assignmentId'> & {
  quizId: string;
};

export type NuniPlanActivityIdentity = {
  kind?: 'assignment' | 'quiz';
  nuniSource?: NuniPlanAssignmentSource;
  nuniQuizSource?: NuniPlanQuizSource;
};

export type NuniPlanAssignmentTargetInput = {
  source: NuniPlanAssignmentSource;
  accountId: string;
  schoolId: string;
  isCurrent: () => boolean;
  request: CourseTransport;
  bffRequest: (path: string) => Promise<unknown>;
  signal?: AbortSignal;
};

export type NuniPlanQuizTargetInput = Omit<NuniPlanAssignmentTargetInput, 'source'> & {
  source: NuniPlanQuizSource;
};

export type NuniPlanAssignmentTargetResult =
  | { kind: 'ready'; params: {
    tab: 'courses'; workspaceId: string; assignmentId: string; assistantAccountId: string;
  } }
  | { kind: 'changed' | 'unavailable' | 'session-changed' | 'cancelled' };

const MAX_ACTIVITIES = 100;
type ActivityKind = 'assignment' | 'quiz';
type ActivitySource = Omit<NuniPlanAssignmentSource, 'assignmentId'> & { activityId: string };
type ActivityLookup = Omit<NuniPlanAssignmentTargetInput, 'source'> & { source: ActivitySource };

function assertCurrent(input: Pick<NuniPlanAssignmentTargetInput, 'signal' | 'isCurrent'>): void {
  if (input.signal?.aborted) throw new NuniError(0, 'REQUEST_CANCELLED');
  if (!input.isCurrent()) throw new NuniError(409, 'SESSION_CHANGED');
}

function parseSource(value: NuniPlanAssignmentSource | NuniPlanQuizSource, kind: ActivityKind): ActivitySource {
  const raw = nuniRecord(value);
  const scope = courseScope(raw);
  // The planner supplies canonical values; do not repair a malformed reference into a new target.
  if (scope.schoolId !== raw.schoolId || scope.academicYear !== raw.academicYear ||
      scope.semester !== raw.semester || (toPublicSchoolId(scope.schoolId) || scope.schoolId) !== scope.schoolId) {
    throw new NuniError(422, 'INVALID_INPUT');
  }
  return { ...scope, accountId: nuniId(raw.accountId, 'pa'),
    workspaceId: nuniId(raw.workspaceId, 'cw'),
    activityId: kind === 'quiz' ? nuniId(raw.quizId, 'cwq') : nuniId(raw.assignmentId, 'cwa') };
}

/** Multiple meetings may share a workspace, but every binding must agree on the selected term. */
async function readBinding(input: ActivityLookup): Promise<string | null> {
  assertCurrent(input);
  const local = await readAssistantTimetable('', input.schoolId, {
    accountId: input.accountId, isCurrent: input.isCurrent,
  });
  assertCurrent(input);
  const target = input.source;
  if (!local || local.schoolId !== target.schoolId) return null;
  const linked = local.records.filter((row) => row.kind === 'timetable' && row.linkedCourseId === target.workspaceId);
  if (!linked.length) return null;
  const ids = new Set<string>();
  for (const row of linked) {
    try {
      if (!sameCourseScope(courseScope(row), target) || !row.id || ids.has(row.id)) return null;
    } catch { return null; }
    ids.add(row.id);
  }
  // A colliding local row ID must not conceal a second, differently bound record.
  if (local.records.some((row) => ids.has(row.id) && !linked.includes(row))) return null;
  // Titles and meeting times may change without changing the explicit workspace binding.
  return JSON.stringify([...ids].sort());
}

/** Recheck the current account, saved binding and authorized source immediately before navigation. */
async function readNuniPlanActivityTarget(
  input: NuniPlanAssignmentTargetInput | NuniPlanQuizTargetInput,
  kind: ActivityKind,
): Promise<NuniPlanAssignmentTargetResult> {
  try {
    assertCurrent(input);
    let source: ActivitySource;
    let schoolId: string;
    try {
      source = parseSource(input.source, kind);
      nuniId(input.accountId, 'pa');
      const current = courseScope({ ...source, schoolId: input.schoolId });
      schoolId = toPublicSchoolId(current.schoolId) || current.schoolId;
    } catch { return { kind: 'changed' }; }
    if (input.accountId !== source.accountId) return { kind: 'session-changed' };
    if (schoolId !== source.schoolId) return { kind: 'changed' };
    // Capture the reference before the first await; a mutated UI object cannot retarget this read.
    const lookup = { ...input, source };
    const before = await readBinding(lookup);
    if (before === null) return { kind: 'changed' };

    const classes = createNuniClasses(async (path) => {
      assertCurrent(lookup);
      const collection = kind === 'quiz' ? 'quizzes' : 'assignments';
      const activityPath = `class-workspaces/${source.workspaceId}/${collection}`;
      const value = kind === 'assignment' && path === activityPath
        ? await lookup.bffRequest(path) : await lookup.request(path);
      assertCurrent(lookup);
      if (path === activityPath) {
        const rows = nuniRecord(value)[collection];
        // This BFF has no continuation cursor. Reject over-limit data instead of silently slicing it.
        if (!Array.isArray(rows) || rows.length > MAX_ACTIVITIES) throw new NuniError(502, 'INVALID_RESPONSE');
      }
      return value;
    }, lookup.accountId);
    const workspace = await classes.get(source.workspaceId);
    assertCurrent(lookup);
    if (workspace.state !== 'active' || workspace.memberRole !== 'student') return { kind: 'changed' };

    const directory = createCourseAccess(async (path, body) => {
      assertCurrent(lookup);
      const value = await lookup.request(path, body);
      assertCurrent(lookup);
      return value;
    });
    const detail = await directory.workspace(source.workspaceId, schoolId);
    assertCurrent(lookup);
    if (detail.memberRole !== 'student' || (detail.status === 'reviewed' && !sameCourseScope(detail.course, source))) {
      return { kind: 'changed' };
    }

    // Both real parsers verify the workspace, activity and receipt owner's account.
    const activities = kind === 'quiz' ? await classes.quizzes(source.workspaceId)
      : await classes.assignments(source.workspaceId);
    assertCurrent(lookup);
    if (new Set(activities.map((item) => item.id)).size !== activities.length) return { kind: 'unavailable' };
    if (await readBinding(lookup) !== before) return { kind: 'changed' };
    assertCurrent(lookup);
    if (!activities.some((item) => item.id === source.activityId)) {
      // An omitted row at the source limit is unknown, never evidence of completion or removal.
      return { kind: activities.length === MAX_ACTIVITIES ? 'unavailable' : 'changed' };
    }
    // Renamed, rescheduled, closed or submitted work can still be opened by its exact ID for review.
    // No private content or receipt is carried across the navigation boundary; the destination rereads it.
    return { kind: 'ready', params: { tab: 'courses', workspaceId: source.workspaceId,
      // The existing course route accepts both cwa_ assignments and cwq_ quizzes in this field.
      assignmentId: source.activityId, assistantAccountId: lookup.accountId } };
  } catch (error) {
    if (input.signal?.aborted || (error instanceof NuniError && error.code === 'REQUEST_CANCELLED') ||
        (error instanceof Error && error.name === 'AbortError')) return { kind: 'cancelled' };
    if (!input.isCurrent() || (error instanceof NuniError && (error.status === 401 || error.code === 'SESSION_CHANGED')) ||
        (error instanceof CourseAccessError && error.statusCode === 401)) return { kind: 'session-changed' };
    if ((error instanceof NuniError && (error.status === 403 || error.status === 404)) ||
        (error instanceof CourseAccessError && (error.statusCode === 403 || error.statusCode === 404))) return { kind: 'changed' };
    return { kind: 'unavailable' };
  }
}

export function readNuniPlanAssignmentTarget(input: NuniPlanAssignmentTargetInput): Promise<NuniPlanAssignmentTargetResult> {
  return readNuniPlanActivityTarget(input, 'assignment');
}

export function readNuniPlanQuizTarget(input: NuniPlanQuizTargetInput): Promise<NuniPlanAssignmentTargetResult> {
  return readNuniPlanActivityTarget(input, 'quiz');
}
