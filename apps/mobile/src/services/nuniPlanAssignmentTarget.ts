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

export type NuniPlanAssignmentTargetInput = {
  source: NuniPlanAssignmentSource;
  accountId: string;
  schoolId: string;
  isCurrent: () => boolean;
  request: CourseTransport;
  bffRequest: (path: string) => Promise<unknown>;
  signal?: AbortSignal;
};

export type NuniPlanAssignmentTargetResult =
  | { kind: 'ready'; params: {
    tab: 'courses'; workspaceId: string; assignmentId: string; assistantAccountId: string;
  } }
  | { kind: 'changed' | 'unavailable' | 'session-changed' | 'cancelled' };

const MAX_ASSIGNMENTS = 100;

function assertCurrent(input: NuniPlanAssignmentTargetInput): void {
  if (input.signal?.aborted) throw new NuniError(0, 'REQUEST_CANCELLED');
  if (!input.isCurrent()) throw new NuniError(409, 'SESSION_CHANGED');
}

function parseSource(value: NuniPlanAssignmentSource): NuniPlanAssignmentSource {
  const raw = nuniRecord(value);
  const scope = courseScope(raw);
  // The planner supplies canonical values; do not repair a malformed reference into a new target.
  if (scope.schoolId !== raw.schoolId || scope.academicYear !== raw.academicYear ||
      scope.semester !== raw.semester || (toPublicSchoolId(scope.schoolId) || scope.schoolId) !== scope.schoolId) {
    throw new NuniError(422, 'INVALID_INPUT');
  }
  return { ...scope, accountId: nuniId(raw.accountId, 'pa'),
    workspaceId: nuniId(raw.workspaceId, 'cw'), assignmentId: nuniId(raw.assignmentId, 'cwa') };
}

/** Multiple meetings may share a workspace, but every binding must agree on the selected term. */
async function readBinding(input: NuniPlanAssignmentTargetInput): Promise<string | null> {
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
export async function readNuniPlanAssignmentTarget(input: NuniPlanAssignmentTargetInput): Promise<NuniPlanAssignmentTargetResult> {
  try {
    assertCurrent(input);
    let source: NuniPlanAssignmentSource;
    let schoolId: string;
    try {
      source = parseSource(input.source);
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
      const assignmentsPath = `class-workspaces/${source.workspaceId}/assignments`;
      const value = path === assignmentsPath ? await lookup.bffRequest(path) : await lookup.request(path);
      assertCurrent(lookup);
      if (path === assignmentsPath) {
        const rows = nuniRecord(value).assignments;
        // This BFF has no continuation cursor. Reject over-limit data instead of silently slicing it.
        if (!Array.isArray(rows) || rows.length > MAX_ASSIGNMENTS) throw new NuniError(502, 'INVALID_RESPONSE');
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

    // Reuse receipt/workspace/account validation, including file submissions, from the real BFF parser.
    const assignments = await classes.assignments(source.workspaceId);
    assertCurrent(lookup);
    if (new Set(assignments.map((item) => item.id)).size !== assignments.length) return { kind: 'unavailable' };
    if (await readBinding(lookup) !== before) return { kind: 'changed' };
    assertCurrent(lookup);
    if (!assignments.some((item) => item.id === source.assignmentId)) {
      // An omitted row at the source limit is unknown, never evidence of completion or removal.
      return { kind: assignments.length === MAX_ASSIGNMENTS ? 'unavailable' : 'changed' };
    }
    // Renamed, rescheduled, closed or submitted work can still be opened by its exact ID for review.
    // No private content or receipt is carried across the navigation boundary; the destination rereads it.
    return { kind: 'ready', params: { tab: 'courses', workspaceId: source.workspaceId,
      assignmentId: source.assignmentId, assistantAccountId: lookup.accountId } };
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
