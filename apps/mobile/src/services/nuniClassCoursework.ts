import { CourseAccessError, courseFold, courseScope, sameCourseScope, type CourseMetadata, type CourseScope } from '@campus/shared/src/courseAccess';
import { createCourseAccess, type CourseTransport } from '@campus/shared/src/courseAccessClient';
import { createNuniClasses, NuniError, type NuniWorkspace } from '@campus/shared/src/nuni';
import { sortStudyTasks } from '@campus/shared/src/nuniStudyAgenda';
import { readAssistantTimetable, type PlatformTimetableAccess } from './assistantTimetableSource';
import { findSavedClassOccurrences, type SavedClassOccurrence } from './nextSavedClasses';

export type ReviewedWorkspaceCourse = Omit<CourseMetadata, 'title'>;
type WorkspaceChoice = Pick<NuniWorkspace, 'id' | 'title'> & {
  reviewed?: ReviewedWorkspaceCourse;
};
type AssignmentRow = {
  id: string;
  title: string;
  dueAt: string | null;
  state: 'open' | 'closed';
  submittedAt: string | null;
};

export type NuniClassCoursework =
  | { kind: 'assignments'; workspace: WorkspaceChoice; assignments: AssignmentRow[]; limited: boolean }
  | { kind: 'choose'; workspaces: WorkspaceChoice[] }
  | { kind: 'unlinked' }
  | { kind: 'changed' }
  | { kind: 'unavailable' };

type Lookup = PlatformTimetableAccess & {
  schoolId: string;
  occurrence: SavedClassOccurrence;
  selectedWorkspaceId?: string;
  expectedReviewed?: ReviewedWorkspaceCourse;
  expectedLinkedWorkspaceId?: string;
  request: CourseTransport;
  bffRequest: (path: string) => Promise<unknown>;
};

function assertCurrent(input: Lookup) {
  if (!input.isCurrent()) throw new NuniError(409, 'SESSION_CHANGED');
}

/** The chat carries a timetable row ID. Only the saved record can supply a workspace binding. */
async function savedCourse(input: Lookup) {
  const { occurrence } = input;
  const source = await readAssistantTimetable('', input.schoolId, input);
  assertCurrent(input);
  if (!source) return;
  const matches = findSavedClassOccurrences(source.records, {
    ...occurrence, schoolId: source.schoolId,
    startAt: Date.parse(`${occurrence.date}T${occurrence.startTime}:00+08:00`),
  });
  if (matches.length !== 1 || matches[0].row.title !== occurrence.name ||
      matches[0].endTime !== occurrence.endTime) return;
  return matches[0].row;
}

async function describeChoice(choice: WorkspaceChoice, scope: CourseScope, input: Lookup): Promise<WorkspaceChoice | null> {
  // These optional labels must not hold up the choice screen on a cold platform service.
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const detail = await Promise.race([
      createCourseAccess(input.request).workspace(choice.id, scope.schoolId),
      new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), 2500); }),
    ]);
    assertCurrent(input);
    if (!detail) return choice;
    if (detail.memberRole !== 'student') return null;
    if (detail.status !== 'reviewed') return choice;
    if (!sameCourseScope(detail.course, scope) || courseFold(detail.course.title) !== courseFold(choice.title)) return null;
    const { schoolId: reviewedSchool, academicYear, semester, courseCode, teacher, className } = detail.course;
    return { ...choice, reviewed: { schoolId: reviewedSchool, academicYear, semester, courseCode, teacher, className } };
  } catch (error) {
    assertCurrent(input);
    if (error instanceof NuniError && (error.status === 401 || error.code === 'SESSION_CHANGED')) throw error;
    // A mismatched identity, denied membership or malformed directory record is not a usable candidate.
    if (error instanceof CourseAccessError || (error instanceof NuniError && (error.status === 403 || error.status === 404))) return null;
    return choice;
  } finally {
    clearTimeout(timer);
  }
}

export async function readNuniClassCoursework(input: Lookup): Promise<NuniClassCoursework> {
  assertCurrent(input);
  try {
    const row = await savedCourse(input);
    if (!row || (input.expectedLinkedWorkspaceId && row.linkedCourseId !== input.expectedLinkedWorkspaceId)) {
      return { kind: 'changed' };
    }

    // Memberships use the platform API. The assignment BFF also includes file submissions.
    const classes = createNuniClasses((path) =>
      path === 'class-workspaces' ? input.request(path) : input.bffRequest(path), input.accountId);
    const memberships = await classes.list();
    assertCurrent(input);
    if (new Set(memberships.map((item) => item.id)).size !== memberships.length) {
      return { kind: 'unavailable' };
    }
    const studying = memberships.filter((course) => course.state === 'active' && course.memberRole === 'student');
    const title = courseFold(row.title);
    const candidates = row.linkedCourseId
      ? studying.filter((course) => course.id === row.linkedCourseId)
      : studying.filter((course) => courseFold(course.title) === title);
    const workspaces = candidates.map(({ id, title }) => ({ id, title }));
    const target = input.selectedWorkspaceId ?? row.linkedCourseId;
    if (!workspaces.length || (!row.linkedCourseId && workspaces.length > 4)) return { kind: input.selectedWorkspaceId ? 'changed' : 'unlinked' };
    if (!target) {
      const choices = workspaces.length === 1 ? workspaces
        : (await Promise.all(workspaces.map((choice) => describeChoice(choice, courseScope(row), input))))
          .filter((choice) => choice !== null);
      assertCurrent(input);
      return choices.length ? { kind: 'choose', workspaces: choices } : { kind: 'unlinked' };
    }
    const workspace = workspaces.find((item) => item.id === target);
    if (!workspace) return { kind: input.selectedWorkspaceId ? 'changed' : 'unlinked' };

    if (!row.linkedCourseId || input.expectedReviewed) {
      const verifiedChoice = await describeChoice(workspace, courseScope(row), input);
      assertCurrent(input);
      if (!verifiedChoice) return { kind: 'changed' };
      const prior = input.expectedReviewed;
      const fresh = verifiedChoice.reviewed;
      if (prior && (!fresh || !sameCourseScope(prior, fresh) || prior.className !== fresh.className ||
          prior.teacher !== fresh.teacher || prior.courseCode !== fresh.courseCode)) return { kind: 'changed' };
    }
    const items = await classes.assignments(workspace.id);
    assertCurrent(input);
    const latest = await savedCourse(input);
    if (!latest || latest.linkedCourseId !== row.linkedCourseId) return { kind: 'changed' };
    if (new Set(items.map((item) => item.id)).size !== items.length) return { kind: 'unavailable' };
    const tasks = sortStudyTasks(items.map((item) => ({
      kind: 'assignment' as const, id: item.id, title: item.title, state: item.state, dueAt: item.dueAt,
      courseId: workspace.id, courseTitle: workspace.title,
      submittedAt: item.mySubmission?.submittedAt ?? null,
      feedback: item.mySubmission?.teacherFeedback ?? null, reviewedAt: item.mySubmission?.reviewedAt ?? null,
    })), Date.now());
    return {
      kind: 'assignments', workspace,
      assignments: tasks.map(({ id, title, dueAt, state, submittedAt }) => ({ id, title, dueAt, state, submittedAt })),
      // The source returns at most 100 rows and does not expose a continuation cursor.
      limited: items.length >= 100,
    };
  } catch (error) {
    assertCurrent(input);
    if (error instanceof NuniError && (error.status === 401 || error.code === 'SESSION_CHANGED')) {
      throw new NuniError(409, 'SESSION_CHANGED');
    }
    return { kind: 'unavailable' };
  }
}
