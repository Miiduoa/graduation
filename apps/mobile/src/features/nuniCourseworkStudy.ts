import { parseAssistantCalendarEvent, type AssistantCalendarEvent } from '@campus/shared/src/assistantExecution';
import { isPersonalImportDate } from '@campus/shared/src/imports/validation';
import {
  assistantCalendarOwner, confirmAssistantCalendarTask, createAssistantCalendarTask,
  findPersistedAssistantCalendarTask, recheckAssistantCalendarTask,
  type AssistantCalendarContext, type AssistantCalendarTask,
} from '../services/assistantCalendarExecution';
import { assistantCalendarEventIdentity } from '../services/assistantCalendarJournal';
import { subscribeNuniAssignmentChanges } from '../services/nuniAssignmentChanges';
import { abortableCampusRead } from '../services/abortableCampusRead';
import { answerNuniCoursework, type CourseworkRead, type CourseworkRequests } from './nuniCourseworkFollowUp';

export type CourseworkStudyTime = { date: string; startTime: string; endTime: string };
export type CourseworkStudySource = Readonly<{
  owner: string; schoolId: string; workspaceId: string; assignmentId: string;
  title: string; courseName: string; dueAt: string; checkedAt: string;
}>;
export type CourseworkStudyDraft = Readonly<{
  source: CourseworkStudySource;
  event: Readonly<AssistantCalendarEvent>;
}>;
export type CourseworkStudyResult =
  | { kind: 'calendar'; task: AssistantCalendarTask; sourceCheckedAt?: string }
  | { kind: 'blocked' | 'changed' | 'unavailable'; message: string; refreshed?: CourseworkRead };

export class CourseworkStudyError extends Error {
  constructor(readonly code: 'invalid-source' | 'invalid-time' | 'session-changed' | 'invalid-draft', message: string) {
    super(message);
    this.name = 'CourseworkStudyError';
  }
}

type PrivateDraft = {
  read: CourseworkRead;
  sourceVersion: number;
  claim: object;
  flight?: Promise<CourseworkStudyResult>;
  attempt?: AssistantCalendarTask;
  sourceCheckedAt?: string;
};
const drafts = new WeakMap<CourseworkStudyDraft, PrivateDraft>();
const claims = new Map<string, object>();
const sourceVersions = new Map<string, number>();
const SOURCE_WAIT_MS = 20_000;
const SOURCE_CHANGED = '這份作業或課程來源已變更，請重新查詢作業並核對準備時間。這次沒有開始新的行程操作。';
const EXISTING = '這個時段已有同名的準備行程或尚待核對的操作，請先到個人行事曆核對，或重新選擇時段。';
const STOPPED = '這次處理已停止，或帳號與學校狀態已變更。請重新查詢作業後再安排。';
const UNAVAILABLE = '目前無法完整核對原作業或行程操作紀錄，這次沒有開始新的行程操作。請稍後重新查詢。';
const sourceKey = (accountId: string, workspaceId: string, assignmentId: string) =>
  JSON.stringify([accountId, workspaceId, assignmentId]);

// Versioning also invalidates a preview when a known change arrives before its
// button is pressed. The event carries no assignment body or submission files.
subscribeNuniAssignmentChanges(({ accountId, workspaceId, assignmentId }) => {
  const key = sourceKey(accountId, workspaceId, assignmentId);
  sourceVersions.set(key, (sourceVersions.get(key) ?? 0) + 1);
});

function current(context: AssistantCalendarContext, source?: CourseworkStudySource): boolean {
  try {
    const platform = context.platformTimetable;
    const owner = assistantCalendarOwner(context);
    return !!platform && !context.uid && !!owner && owner === `nuni:${platform.accountId}` &&
      (!source || (owner === source.owner && context.schoolId === source.schoolId));
  } catch { return false; }
}

/** A deadline needs a real calendar date, clock and explicit offset. */
function strictInstant(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4}-\d{2}-\d{2})T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,9})?)?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/.exec(value);
  if (!match || !isPersonalImportDate(match[1])) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

export function isCourseworkStudyInstant(value: unknown): value is string {
  return strictInstant(value) !== null;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function validWindow(event: AssistantCalendarEvent, dueAt: string) {
  const start = Date.parse(`${event.date}T${event.startTime}:00+08:00`);
  const end = Date.parse(`${event.date}T${event.endTime}:00+08:00`);
  const due = strictInstant(dueAt);
  return due !== null && Number.isFinite(start) && Number.isFinite(end) && Date.now() < start && start < end && end <= due;
}

export function prepareCourseworkStudyDraft(read: CourseworkRead, assignmentId: string,
  time: CourseworkStudyTime, context: AssistantCalendarContext): CourseworkStudyDraft {
  if (!current(context)) throw new CourseworkStudyError('session-changed', STOPPED);
  const platform = context.platformTimetable!;
  if (!read?.anchor || read.result?.kind !== 'assignments' || !Array.isArray(read.anchor.classes) ||
      !Array.isArray(read.result.assignments) || read.anchor.uid ||
      read.anchor.owner !== `nuni:${platform.accountId}` || read.anchor.schoolId !== context.schoolId ||
      read.anchor.classes.length !== 1 || read.changedAssignmentId || strictInstant(read.checkedAt) === null ||
      (read.selectedWorkspaceId && read.selectedWorkspaceId !== read.result.workspace.id) ||
      new Set(read.result.assignments.map((row) => row.id)).size !== read.result.assignments.length) {
    throw new CourseworkStudyError('invalid-source', '請重新查詢這門課的作業，再選擇要安排的那一份。');
  }
  const row = read.result.assignments.find((item) => item.id === assignmentId);
  if (!row || !row.id || !read.result.workspace.id || !row.title?.trim() ||
      /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(row.title)) {
    throw new CourseworkStudyError('invalid-source', '無法核對選取的作業名稱與來源，請重新查詢。');
  }
  if (row.state !== 'open' || row.submittedAt !== null) {
    throw new CourseworkStudyError('invalid-source', row.submittedAt
      ? '這份作業已有繳交紀錄，請先到原作業確認。' : '這份作業已停止收件，請先到原作業確認。');
  }
  if (strictInstant(row.dueAt) === null) {
    throw new CourseworkStudyError('invalid-source', '這份作業沒有可核對的明確截止時間，請先到原作業確認。');
  }
  const fullTitle = `準備：${row.title.trim()}`;
  const title = fullTitle.length <= 200 ? fullTitle : `準備：${Array.from(row.title.trim()).slice(0, 90).join('')}…`;
  let event: AssistantCalendarEvent;
  try {
    event = parseAssistantCalendarEvent({ title, date: time.date.trim(), allDay: false,
      startTime: time.startTime.trim(), endTime: time.endTime.trim() });
  } catch {
    throw new CourseworkStudyError('invalid-time', '請填寫有效日期，以及同一天由早到晚的起訖時間。');
  }
  if (!validWindow(event, row.dueAt!)) {
    throw new CourseworkStudyError('invalid-time', '請選擇尚未開始、且能在作業截止前結束的準備時段。');
  }
  const source = Object.freeze({
    owner: read.anchor.owner!, schoolId: context.schoolId, workspaceId: read.result.workspace.id,
    assignmentId: row.id, title: row.title, courseName: read.result.workspace.title,
    dueAt: row.dueAt!, checkedAt: read.checkedAt!,
  });
  const draft = Object.freeze({ source, event: Object.freeze(event) });
  let saved: CourseworkRead;
  try { saved = deepFreeze(JSON.parse(JSON.stringify(read)) as CourseworkRead); }
  catch { throw new CourseworkStudyError('invalid-source', '無法保存這次預覽的作業來源，請重新查詢。'); }
  drafts.set(draft, { read: saved,
    sourceVersion: sourceVersions.get(sourceKey(platform.accountId, source.workspaceId, source.assignmentId)) ?? 0,
    claim: Object.freeze({}),
  });
  return draft;
}

function waitingResult(state: PrivateDraft): CourseworkStudyResult {
  if (!state.attempt) return { kind: 'blocked', message: STOPPED };
  const previous = state.attempt;
  const lastVerified = previous.state === 'verified' ? previous.receipt
    : previous.state === 'unknown' ? previous.lastVerified : undefined;
  state.attempt = { proposal: previous.proposal, state: 'unknown', reason: 'unavailable',
    message: '這筆準備行程已開始處理，但保存結果尚待核對。請核對原行程紀錄，這裡不會再次建立。',
    ...(lastVerified && { lastVerified }),
  };
  return { kind: 'calendar', task: state.attempt, sourceCheckedAt: state.sourceCheckedAt };
}

async function run(draft: CourseworkStudyDraft, state: PrivateDraft, context: AssistantCalendarContext,
  transport: CourseworkRequests | undefined, signal?: AbortSignal): Promise<CourseworkStudyResult> {
  const key = JSON.stringify([draft.source.owner, draft.source.schoolId, assistantCalendarEventIdentity(draft.event)]);
  const sourceId = sourceKey(context.platformTimetable!.accountId, draft.source.workspaceId, draft.source.assignmentId);
  const abort = new AbortController();
  let running = true;
  let changed = false;
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stop = () => abort.abort();
  signal?.addEventListener('abort', stop, { once: true });
  if (signal?.aborted) stop();
  const active = () => running && !abort.signal.aborted && current(context, draft.source);
  const access = { ...context, isCurrent: active };
  const version = () => sourceVersions.get(sourceId) ?? 0;
  const unsubscribe = subscribeNuniAssignmentChanges((event) => {
    if (sourceKey(event.accountId, event.workspaceId, event.assignmentId) === sourceId) {
      changed = true;
      stop();
    }
  });
  try {
    if (!active()) return waitingResult(state);
    // An already attempted draft is a read-only operation, including after a
    // source change. Only its original proposal ID can be checked again.
    if (state.attempt) {
      if (state.attempt.state === 'blocked') return { kind: 'calendar', task: state.attempt, sourceCheckedAt: state.sourceCheckedAt };
      const result = await abortableCampusRead(() => recheckAssistantCalendarTask(state.attempt!.proposal,
        access, state.attempt), abort.signal);
      if (!active()) return waitingResult(state);
      state.attempt = result;
      return { kind: 'calendar', task: result, sourceCheckedAt: state.sourceCheckedAt };
    }
    if (version() !== state.sourceVersion) return { kind: 'changed', message: SOURCE_CHANGED };
    const claim = claims.get(key);
    if (claim && claim !== state.claim) return { kind: 'blocked', message: EXISTING };
    claims.set(key, state.claim);
    if (!validWindow(draft.event, draft.source.dueAt)) return { kind: 'blocked', message: '原先預覽的時段已無法在截止前安排，請重新選擇日期與時間。' };
    const existing = await abortableCampusRead(() => findPersistedAssistantCalendarTask(draft.event, access), abort.signal);
    if (!active()) return waitingResult(state);
    // Generic calendar receipts do not prove assignment provenance. A different
    // fresh draft must not borrow a same-title receipt, even when all times match.
    if (existing) return { kind: 'blocked', message: EXISTING };
    if (!transport) return { kind: 'unavailable', message: UNAVAILABLE };
    timer = setTimeout(() => { timedOut = true; stop(); }, SOURCE_WAIT_MS);
    const refreshed = await abortableCampusRead(() => answerNuniCoursework({ courseworkRead: state.read },
      context.platformTimetable!, draft.source.schoolId, active, transport, { refreshAssignmentId: draft.source.assignmentId }), abort.signal);
    clearTimeout(timer); timer = undefined;
    if (!active()) return waitingResult(state);
    const newest = refreshed.courseworkRead;
    if (!newest || newest.result.kind === 'unavailable') return { kind: 'unavailable', message: UNAVAILABLE, refreshed: newest };
    const result = newest.result;
    const row = result.kind === 'assignments' && result.workspace.id === draft.source.workspaceId
      ? result.assignments.find((candidate) => candidate.id === draft.source.assignmentId) : undefined;
    if (version() !== state.sourceVersion || !row || result.kind !== 'assignments' ||
        result.workspace.title !== draft.source.courseName || row.title !== draft.source.title || row.state !== 'open' ||
        row.submittedAt !== null || strictInstant(row.dueAt) !== strictInstant(draft.source.dueAt) ||
        newest.anchor.owner !== draft.source.owner || newest.anchor.schoolId !== draft.source.schoolId ||
        newest.anchor.uid || newest.changedAssignmentId || strictInstant(newest.checkedAt) === null) {
      return { kind: 'changed', message: SOURCE_CHANGED, refreshed: newest };
    }
    if (!active()) return waitingResult(state);
    if (!validWindow(draft.event, draft.source.dueAt)) return { kind: 'blocked', message: '原先預覽的開始時間已經過了，請重新選擇日期與時間。' };
    state.sourceCheckedAt = newest.checkedAt;
    state.attempt = createAssistantCalendarTask(draft.event, access);
    const proposal = state.attempt.proposal;
    const task = await abortableCampusRead(() => confirmAssistantCalendarTask(proposal, access), abort.signal);
    if (!active()) return waitingResult(state);
    if (task.proposal.mutationId !== proposal.mutationId) {
      // A generic operation may have won the ledger lock since our initial read.
      // Keep our original attempt inaccessible to new writes; never adopt it.
      state.attempt = { proposal, state: 'blocked', message: EXISTING };
      return { kind: 'blocked', message: EXISTING };
    }
    state.attempt = task;
    return { kind: 'calendar', task, sourceCheckedAt: state.sourceCheckedAt };
  } catch {
    if (state.attempt) return waitingResult(state);
    if (changed || version() !== state.sourceVersion) return { kind: 'changed', message: SOURCE_CHANGED };
    if (timedOut) return { kind: 'unavailable', message: '重新核對作業的等待時間已過，這次沒有開始行程操作。請稍後重新查詢。' };
    if (!active()) return { kind: 'blocked', message: STOPPED };
    return { kind: 'unavailable', message: UNAVAILABLE };
  } finally {
    running = false;
    clearTimeout(timer);
    signal?.removeEventListener('abort', stop);
    unsubscribe();
    // An uncertain dispatched operation retains its in-memory claim as well as
    // the durable journal protection. Completed/blocked operations are bounded
    // by the existing executor; future drafts must inspect the journal again.
    if ((!state.attempt || state.attempt.state !== 'unknown') && claims.get(key) === state.claim) claims.delete(key);
  }
}

export function confirmCourseworkStudyDraft(draft: CourseworkStudyDraft, context: AssistantCalendarContext,
  transport?: CourseworkRequests, options: { signal?: AbortSignal } = {}): Promise<CourseworkStudyResult> {
  const state = drafts.get(draft);
  if (!state) return Promise.resolve({ kind: 'blocked', message: '這份準備行程預覽已失效，請重新查詢作業並建立預覽。' });
  if (!current(context, draft.source) || options.signal?.aborted) return Promise.resolve({ kind: 'blocked', message: STOPPED });
  if (state.flight) return state.flight;
  const flight = run(draft, state, context, transport, options.signal);
  state.flight = flight;
  void flight.finally(() => { if (state.flight === flight) state.flight = undefined; });
  return flight;
}
