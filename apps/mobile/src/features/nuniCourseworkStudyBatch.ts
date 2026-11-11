import { parseAssistantCalendarEvent } from '@campus/shared/src/assistantExecution';
import { courseScope, type CourseWorkspace } from '@campus/shared/src/courseAccess';
import { parseCourseWorkspace } from '@campus/shared/src/courseAccessClient';
import { nuniId } from '@campus/shared/src/nuni';
import { toPublicSchoolId } from '@campus/shared/src/schoolIds';
import { abortableCampusRead } from '../services/abortableCampusRead';
import { assistantCalendarOwner, type AssistantCalendarContext } from '../services/assistantCalendarExecution';
import {
  prepareAssistantCalendarBatch, type AssistantCalendarBatchSourceCheckFailure,
  type AssistantCalendarBatchSourceChecks, type AssistantCalendarBatchView,
} from '../services/assistantCalendarBatchExecution';
import {
  ASSISTANT_CALENDAR_BATCH_MAX_STEPS, ASSISTANT_CALENDAR_COURSE_IDENTITY_MAX_LENGTH,
  parseAssistantCalendarBatchPlan, sameAssistantCalendarBatchPlan,
  type AssistantCalendarBatchPlan, type AssistantCalendarBatchStep, type AssistantCalendarBatchStepSource,
} from '../services/assistantCalendarBatchStore';
import { findCourseworkStudyBatchSlots, recheckCourseworkStudyTime } from '../services/courseworkStudyAvailability';
import type { NuniPlanAssignmentSource } from '../services/nuniPlanAssignmentTarget';
import { subscribeNuniAssignmentChanges } from '../services/nuniAssignmentChanges';
import { subscribePersonalImports } from '../services/personalImports';
import { subscribeTimetableChanges } from '../widgets/timetableChanges';
import type { CourseworkRequests } from './nuniCourseworkFollowUp';
import { courseworkStudyEventTitle, resolveCourseworkStudySource } from './nuniCourseworkStudy';
import { readNuniPlanCourseworkStudy } from './nuniPlanCourseworkStudy';

type FailureKind = 'blocked' | 'changed' | 'unavailable' | 'no-slot' | 'cancelled';
type Failure = { kind: FailureKind; message: string };
export type NuniCourseworkStudyBatchResult = { kind: 'ready'; batch: AssistantCalendarBatchView } | Failure;
type PrepareInput = {
  sources: readonly NuniPlanAssignmentSource[];
  context: AssistantCalendarContext;
  transport: CourseworkRequests;
  signal?: AbortSignal;
};
type SelectedSource = { locator: Readonly<NuniPlanAssignmentSource>; label: string };
const INVALID = '這批安排的作業來源不完整，請重新選取二至四份不同的作業。';
const CHANGED = '作業來源、課程連結或課表已變更，請重新核對這批準備安排。';
const STOPPED = '已停止這批作業的準備安排，尚未開始新的行程操作。';
const UNAVAILABLE = '目前無法完整核對這批作業，請稍後重試。';
const IDENTITY_CHANGED = '帳號或學校狀態已變更，請重新開啟並核對這批作業。';
const locatorFields = ['accountId', 'schoolId', 'academicYear', 'semester', 'workspaceId', 'assignmentId'] as const;
const controls = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

class BatchSourceError extends Error {
  constructor(readonly kind: FailureKind, message: string) { super(message); }
}
function failure(error: unknown, fallback = UNAVAILABLE): Failure {
  return error instanceof BatchSourceError ? { kind: error.kind, message: error.message }
    : { kind: 'unavailable', message: fallback };
}
function forRunner(result: Failure): AssistantCalendarBatchSourceCheckFailure {
  return { kind: result.kind === 'cancelled' || result.kind === 'no-slot' ? 'blocked' : result.kind,
    message: result.message };
}
function locatorKey(source: NuniPlanAssignmentSource): string {
  return JSON.stringify(locatorFields.map((key) => source[key]));
}
function copyLocator(value: unknown): Readonly<NuniPlanAssignmentSource> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BatchSourceError('blocked', INVALID);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new BatchSourceError('blocked', INVALID);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== locatorFields.length) throw new BatchSourceError('blocked', INVALID);
  const raw: Record<string, unknown> = {};
  for (const field of locatorFields) {
    const descriptor = descriptors[field];
    if (!descriptor?.enumerable || !('value' in descriptor) || typeof descriptor.value !== 'string')
      throw new BatchSourceError('blocked', INVALID);
    raw[field] = descriptor.value;
  }
  try {
    const scope = courseScope(raw);
    if (scope.schoolId !== raw.schoolId || scope.academicYear !== raw.academicYear ||
        scope.semester !== raw.semester || (toPublicSchoolId(scope.schoolId) || scope.schoolId) !== scope.schoolId)
      throw new Error('Noncanonical source');
    return Object.freeze({ ...scope, accountId: nuniId(raw.accountId, 'pa'),
      workspaceId: nuniId(raw.workspaceId, 'cw'), assignmentId: nuniId(raw.assignmentId, 'cwa') });
  } catch { throw new BatchSourceError('blocked', INVALID); }
}
function selectedSources(sources: readonly NuniPlanAssignmentSource[]): readonly SelectedSource[] {
  if (!Array.isArray(sources) || sources.length < 2 || sources.length > ASSISTANT_CALENDAR_BATCH_MAX_STEPS)
    throw new BatchSourceError('blocked', INVALID);
  const selected = sources.map((value, index) => Object.freeze({ locator: copyLocator(value), label: `第 ${index + 1} 份選取的作業` }));
  if (new Set(selected.map(({ locator }) => locatorKey(locator))).size !== selected.length)
    throw new BatchSourceError('blocked', '選取的作業重複了，請選擇二至四份不同的作業。');
  return Object.freeze(selected);
}
function capturedTransport(transport: CourseworkRequests): CourseworkRequests {
  const request = transport?.request, bffRequest = transport?.bffRequest;
  if (typeof request !== 'function' || typeof bffRequest !== 'function') throw new BatchSourceError('unavailable', UNAVAILABLE);
  return Object.freeze({ request, bffRequest });
}

/** The lease covers all selected sources before any read starts. Its guard is
 * used only to authorize a future write, never to suppress a dispatched write's readback. */
function sourceLease(selected: readonly SelectedSource[], context: AssistantCalendarContext, signal?: AbortSignal) {
  const platform = context.platformTimetable;
  const accountId = platform?.accountId;
  const schoolId = context.schoolId;
  const owner = accountId && `nuni:${accountId}`;
  const isCurrent = context.isCurrent;
  const platformCurrent = platform?.isCurrent;
  const sameIdentity = () => {
    try {
      return !!platform && !context.uid && !!accountId && context.schoolId === schoolId &&
        context.platformTimetable === platform && platform.accountId === accountId &&
        context.isCurrent === isCurrent && platform.isCurrent === platformCurrent &&
        isCurrent() && platformCurrent!() && assistantCalendarOwner(context) === owner;
    } catch { return false; }
  };
  if (!sameIdentity() || selected.some(({ locator }) => locator.accountId !== accountId || locator.schoolId !== schoolId))
    throw new BatchSourceError('changed', IDENTITY_CHANGED);
  const abort = new AbortController();
  let disposed = false;
  let cause: BatchSourceError | undefined;
  const stop = (kind: FailureKind, message: string) => {
    if (disposed || cause) return;
    cause = new BatchSourceError(kind, message);
    abort.abort();
  };
  const cancel = () => stop('cancelled', STOPPED);
  const active = () => !disposed && !abort.signal.aborted && sameIdentity();
  const assertCurrent = () => {
    if (active()) return;
    throw cause ?? new BatchSourceError('changed', IDENTITY_CHANGED);
  };
  signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) cancel();
  const unsubscribeAssignment = subscribeNuniAssignmentChanges((event) => {
    const selectedSource = selected.find(({ locator }) => event.accountId === locator.accountId &&
      event.workspaceId === locator.workspaceId && event.assignmentId === locator.assignmentId);
    if (selectedSource) stop('changed', `${selectedSource.label}：作業已更新，請重新核對這批準備安排。`);
  });
  const unsubscribeTimetable = subscribeTimetableChanges(() => stop('changed', '這批作業使用的課表已變更，請重新核對準備時段。'));
  const unsubscribeImports = subscribePersonalImports(({ scope }) => {
    if (scope.owner === owner && scope.schoolId === schoolId)
      stop('changed', '這批作業使用的個人行程或課表已更新，請重新核對準備時段。');
  });
  const access: AssistantCalendarContext = Object.freeze({ uid: '', schoolId, platformTimetable: platform, isCurrent: active });
  return {
    context: access, signal: abort.signal, active, assertCurrent, stop,
    problem: (error: unknown) => failure(cause ?? (!sameIdentity() ? new BatchSourceError('changed', IDENTITY_CHANGED) : error)),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      abort.abort();
      signal?.removeEventListener('abort', cancel);
      unsubscribeAssignment(); unsubscribeTimetable(); unsubscribeImports();
    },
  };
}
type SourceLease = ReturnType<typeof sourceLease>;

function directoryIdentity(detail: CourseWorkspace): readonly unknown[] {
  if (detail.status === 'unreviewed') return ['unreviewed'];
  const course = detail.course;
  return ['reviewed', course.id, course.title, course.schoolId, course.academicYear, course.semester,
    course.courseCode ?? null, course.teacher ?? null, course.className ?? null];
}
function boundedSourceText(value: string, max: number) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || controls.test(value))
    throw new BatchSourceError('changed', CHANGED);
  try { encodeURIComponent(value); } catch { throw new BatchSourceError('changed', CHANGED); }
  return value;
}

/** Observe only metadata from requests the real reader already performs. No
 * private assignment body, receipt or occurrence snapshot enters the saved plan. */
async function readFresh(selected: SelectedSource, lease: SourceLease, transport: CourseworkRequests): Promise<AssistantCalendarBatchStepSource> {
  const { locator, label } = selected;
  let directory: readonly unknown[] | undefined;
  let inconsistent = false;
  try {
    lease.assertCurrent();
    const request: CourseworkRequests['request'] = async (path, body) => {
      lease.assertCurrent();
      const result = await transport.request(path, body);
      lease.assertCurrent();
      if (path === 'course-access/workspace-course') {
        if (body?.workspaceId !== locator.workspaceId || body?.schoolId !== locator.schoolId)
          throw new BatchSourceError('changed', CHANGED);
        const next = directoryIdentity(parseCourseWorkspace(result, locator.workspaceId, locator.schoolId));
        if (directory && JSON.stringify(directory) !== JSON.stringify(next)) {
          inconsistent = true;
          throw new BatchSourceError('changed', CHANGED);
        }
        directory = next;
      }
      return result;
    };
    const result = await readNuniPlanCourseworkStudy({ source: locator, context: lease.context,
      transport: { request, bffRequest: transport.bffRequest }, signal: lease.signal });
    lease.assertCurrent();
    if (inconsistent) throw new BatchSourceError('changed', CHANGED);
    if (result.kind !== 'ready') throw new BatchSourceError(result.kind, result.message);
    if (!directory || result.assignmentId !== locator.assignmentId) throw new BatchSourceError('unavailable', UNAVAILABLE);
    const source = resolveCourseworkStudySource(result.read, locator.assignmentId, lease.context);
    if (source.workspaceId !== locator.workspaceId || source.owner !== `nuni:${locator.accountId}` ||
        source.schoolId !== locator.schoolId) throw new BatchSourceError('changed', CHANGED);
    const courseIdentity = JSON.stringify([1, locator.schoolId, locator.academicYear, locator.semester,
      locator.workspaceId, source.courseName, directory]);
    boundedSourceText(courseIdentity, ASSISTANT_CALENDAR_COURSE_IDENTITY_MAX_LENGTH);
    return Object.freeze({ kind: 'nuni-assignment', locator, expected: Object.freeze({
      title: boundedSourceText(source.title, 200), courseName: boundedSourceText(source.courseName, 200),
      dueAt: source.dueAt, courseIdentity,
    }) });
  } catch (error) {
    const result = lease.problem(error);
    lease.stop(result.kind, `${label}：${result.message}`);
    throw new BatchSourceError(result.kind, `${label}：${result.message}`);
  }
}
async function readAll(selected: readonly SelectedSource[], lease: SourceLease, transport: CourseworkRequests) {
  const results = await Promise.allSettled(selected.map((source) => readFresh(source, lease, transport)));
  lease.assertCurrent();
  return results.map((result) => {
    if (result.status === 'rejected') throw result.reason;
    return result.value;
  });
}

/** Preparing a preview saves source locators and expected metadata only. The
 * batch runner remains the sole writer and must revalidate these sources. */
export async function prepareNuniCourseworkStudyBatch(input: PrepareInput): Promise<NuniCourseworkStudyBatchResult> {
  let lease: SourceLease | undefined;
  try {
    const selected = selectedSources(input.sources);
    const transport = capturedTransport(input.transport);
    lease = sourceLease(selected, input.context, input.signal);
    lease.assertCurrent();
    const sources = await readAll(selected, lease, transport);
    const indexed = sources.map((source, index) => ({ id: `selected-${index + 1}`, source }));
    const choices = await findCourseworkStudyBatchSlots(lease.context,
      indexed.map(({ id, source }) => ({ id, dueAt: source.expected.dueAt })), { signal: lease.signal });
    lease.assertCurrent();
    if (choices.kind !== 'available') {
      const unplaced = choices.unplacedIds?.length
        ? indexed.filter(({ id }) => choices.unplacedIds!.includes(id)) : indexed;
      const names = unplaced.map(({ source }) => `「${source.expected.title}」`).join('、');
      return { kind: choices.kind, message: `${names}：${choices.message}這次沒有保存縮減版的準備安排。` };
    }
    if (choices.slots.length !== indexed.length || new Set(choices.slots.map(({ id }) => id)).size !== indexed.length ||
        choices.slots.some(({ id }) => !indexed.some((item) => item.id === id)))
      throw new BatchSourceError('unavailable', '未能完整安排所有選取的作業，這次沒有保存部分安排。請重新核對。');
    const ordered = choices.slots.map(({ id, slot }) => {
      const source = indexed.find((item) => item.id === id)!.source;
      return { source, event: parseAssistantCalendarEvent({ title: courseworkStudyEventTitle(source.expected.title),
        date: slot.date, allDay: false, startTime: slot.startTime, endTime: slot.endTime }) };
    });
    lease.assertCurrent();
    const batch = await abortableCampusRead(() => prepareAssistantCalendarBatch(ordered.map(({ event }) => event),
      lease!.context, { kind: 'coursework-study', sources: ordered.map(({ source }) => source) }), lease.signal);
    lease.assertCurrent();
    return { kind: 'ready', batch };
  } catch (error) {
    return lease ? lease.problem(error) : failure(error);
  } finally { lease?.dispose(); }
}

function checkedPlan(raw: AssistantCalendarBatchPlan, context: AssistantCalendarContext): AssistantCalendarBatchPlan {
  const owner = assistantCalendarOwner(context);
  if (!context.platformTimetable || context.uid || owner !== `nuni:${context.platformTimetable.accountId}`)
    throw new BatchSourceError('changed', IDENTITY_CHANGED);
  let plan: AssistantCalendarBatchPlan;
  try { plan = parseAssistantCalendarBatchPlan(raw, { owner, schoolId: context.schoolId }); }
  catch { throw new BatchSourceError('blocked', INVALID); }
  if (plan.kind !== 'coursework-study' || plan.steps.some((step) => !step.source || step.source.kind !== 'nuni-assignment'))
    throw new BatchSourceError('blocked', INVALID);
  if (plan.cancelledAt) throw new BatchSourceError('blocked', '這批作業準備安排已取消，不會開始剩餘的行程操作。');
  return plan;
}
function checkedSteps(plan: AssistantCalendarBatchPlan, requested: readonly AssistantCalendarBatchStep[]): readonly AssistantCalendarBatchStep[] {
  if (!Array.isArray(requested) || requested.length > plan.steps.length) throw new BatchSourceError('blocked', INVALID);
  const ids = new Set<string>();
  return Object.freeze(requested.map((raw) => {
    const descriptor = raw && typeof raw === 'object' ? Object.getOwnPropertyDescriptor(raw, 'id') : undefined;
    const id = descriptor && 'value' in descriptor ? descriptor.value : undefined;
    const step = plan.steps.find((candidate) => candidate.id === id);
    if (!step || ids.has(step.id)) throw new BatchSourceError('blocked', INVALID);
    ids.add(step.id);
    try {
      const candidate = parseAssistantCalendarBatchPlan({ ...plan,
        steps: plan.steps.map((entry) => entry.id === step.id ? raw : entry) });
      if (!sameAssistantCalendarBatchPlan(plan, candidate)) throw new Error('Different step');
    } catch { throw new BatchSourceError('blocked', '選取的作業或準備時段已變更，請重新核對整份安排。'); }
    return step;
  }));
}
function expectedSelected(steps: readonly AssistantCalendarBatchStep[]): readonly SelectedSource[] {
  return steps.map((step) => ({ locator: copyLocator(step.source!.locator), label: `「${step.source!.expected.title}」（${step.source!.expected.courseName}）` }));
}
function sameExpected(fresh: AssistantCalendarBatchStepSource, expected: AssistantCalendarBatchStepSource): boolean {
  return locatorKey(fresh.locator) === locatorKey(expected.locator) && fresh.expected.title === expected.expected.title &&
    fresh.expected.courseName === expected.expected.courseName && Date.parse(fresh.expected.dueAt) === Date.parse(expected.expected.dueAt) &&
    fresh.expected.courseIdentity === expected.expected.courseIdentity;
}

/** This resolver must also be supplied when resuming a persisted source batch.
 * The stored JSON selects what to re-read; it never replaces the fresh checks. */
export function createNuniCourseworkStudyBatchChecks(transport: CourseworkRequests): AssistantCalendarBatchSourceChecks {
  return {
    async preflight(rawPlan, pending, context, signal) {
      let lease: SourceLease | undefined;
      try {
        const plan = checkedPlan(rawPlan, context);
        const steps = checkedSteps(plan, pending);
        const reader = capturedTransport(transport);
        lease = sourceLease(expectedSelected(steps), context, signal);
        lease.assertCurrent();
        const fresh = await readAll(expectedSelected(steps), lease, reader);
        lease.assertCurrent();
        for (let index = 0; index < steps.length; index++) {
          if (!sameExpected(fresh[index], steps[index].source!))
            throw new BatchSourceError('changed', `「${steps[index].source!.expected.title}」的作業或課程資料已變更，請重新規劃後再確認。`);
        }
        return { kind: 'ready' };
      } catch (error) { return forRunner(lease ? lease.problem(error) : failure(error)); }
      finally { lease?.dispose(); }
    },
    async beforeStep(rawPlan, rawStep, context, signal) {
      let lease: SourceLease | undefined;
      let retained = false;
      try {
        const plan = checkedPlan(rawPlan, context);
        const step = checkedSteps(plan, [rawStep])[0];
        const selected = expectedSelected([step]);
        const reader = capturedTransport(transport);
        lease = sourceLease(selected, context, signal);
        lease.assertCurrent();
        const source = await readFresh(selected[0], lease, reader);
        if (!sameExpected(source, step.source!))
          throw new BatchSourceError('changed', `${selected[0].label}：作業或課程資料已變更，請重新規劃後再確認。`);
        if (step.event.allDay || !step.event.startTime || !step.event.endTime || step.event.endDate ||
            step.event.title !== courseworkStudyEventTitle(source.expected.title))
          throw new BatchSourceError('blocked', `${selected[0].label}：原先確認的準備行程內容無法核對，請重新規劃。`);
        const checked = await recheckCourseworkStudyTime({ date: step.event.date,
          startTime: step.event.startTime, endTime: step.event.endTime }, source.expected.dueAt,
        lease.context, { signal: lease.signal });
        lease.assertCurrent();
        if (checked.kind !== 'ready') return { kind: checked.kind, message: `${selected[0].label}：${checked.message}` };
        const live = lease;
        const message = `${selected[0].label}：作業、課程或準備時段已變更，這次不會開始新的行程操作。`;
        retained = true;
        return { kind: 'ready', writeCheck: {
          isCurrent: () => live.active() && checked.writeCheck.isCurrent(),
          matches: (ledger) => live.active() && checked.writeCheck.matches(ledger),
          message,
        }, dispose: live.dispose };
      } catch (error) { return forRunner(lease ? lease.problem(error) : failure(error)); }
      finally { if (!retained) lease?.dispose(); }
    },
  };
}
