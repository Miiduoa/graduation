import { classDate } from '@campus/shared/src/timetable/classExceptions';
import { exclusiveAllDayEnd } from '@campus/shared/src/imports/eventCalendar';
import { toPublicSchoolId } from '@campus/shared/src/schoolIds';
import type { PersonalImportRecord } from '@campus/shared/src/imports/types';
import { abortableCampusRead } from './abortableCampusRead';
import { assistantCalendarOwner, type AssistantCalendarContext, type AssistantCalendarWriteCheck } from './assistantCalendarExecution';
import { readAssistantTimetable } from './assistantTimetableSource';
import { inspectCampusClockAvailability, selectCampusClockStudySlot, type CampusClockInterval } from './campusClockAvailability';
import { scheduledSavedClasses } from './nextSavedClasses';
import { snapshotPersonalImports, subscribePersonalImports, type PersonalImportLedger } from './personalImports';
import { subscribeTimetableChanges } from '../widgets/timetableChanges';

export type CourseworkStudySlot = Readonly<{
  date: string; startTime: string; endTime: string; checkedAt: string; summary: string;
}>;
type Failure = { kind: 'blocked' | 'unavailable' | 'no-slot'; message: string };
export type CourseworkStudySlots = Failure | {
  kind: 'available'; slots: readonly CourseworkStudySlot[]; checkedAt: string; message: string;
};
type Generation = { owner: string; schoolId: string; timetable: number; imports: number };
type Evidence = {
  generation: Generation; ledger: PersonalImportLedger;
  records: PersonalImportRecord[]; canonicalSchoolId: string; checkedAt: string;
};
type SlotProof = { owner: string; schoolId: string; deadline: number; windowEnd: number };
type Interval = { start: number; end: number };
const proofs = new WeakMap<CourseworkStudySlot, SlotProof>();
const importVersions = new Map<string, number>();
let timetableVersion = 0;
let observing = false;
const DAY = 86_400_000;
const BUFFER = 10 * 60_000;
const DURATION = 30 * 60_000;
const WAIT_MS = 20_000;
const CHANGED = '課表或個人行程已更新，請重新尋找並核對準備時段。這次沒有建立新的行程。';
const UNAVAILABLE = '目前無法完整核對這台手機的課表與個人行程，請稍後重試，或自行核對後手動輸入時間。';
const STOPPED = '尋找時段已停止，或帳號與學校狀態已變更。';
const SUMMARY = '依這台手機已存課表與個人行程，保留前後各 10 分鐘；只建議 08:00–22:00 的課間空堂。';
const scopeKey = (owner: string, schoolId: string) => JSON.stringify([owner, schoolId]);

class AvailabilityError extends Error {
  constructor(readonly kind: 'blocked' | 'unavailable', message: string) { super(message); }
}

function observeChanges() {
  if (observing) return;
  observing = true;
  subscribeTimetableChanges(() => { timetableVersion += 1; });
  subscribePersonalImports(({ scope }) => {
    const key = scopeKey(scope.owner, scope.schoolId);
    importVersions.set(key, (importVersions.get(key) ?? 0) + 1);
  });
}

function generation(context: AssistantCalendarContext): Generation {
  observeChanges();
  const owner = assistantCalendarOwner(context);
  if (!owner || context.uid || !context.platformTimetable || owner !== `nuni:${context.platformTimetable.accountId}`)
    throw new AvailabilityError('blocked', STOPPED);
  return { owner, schoolId: context.schoolId, timetable: timetableVersion,
    imports: importVersions.get(scopeKey(owner, context.schoolId)) ?? 0 };
}

function sameGeneration(before: Generation, context: AssistantCalendarContext): boolean {
  try {
    const next = generation(context);
    return next.owner === before.owner && next.schoolId === before.schoolId &&
      next.timetable === before.timetable && next.imports === before.imports;
  } catch { return false; }
}

/** Wait for queued imports, then read scoped timetable evidence under one bounded observation. */
async function readEvidence(context: AssistantCalendarContext, signal?: AbortSignal): Promise<Evidence> {
  const before = generation(context);
  const abort = new AbortController();
  let running = true;
  let timedOut = false;
  const stop = () => abort.abort();
  const active = () => running && !abort.signal.aborted && sameGeneration(before, context);
  signal?.addEventListener('abort', stop, { once: true });
  if (signal?.aborted) stop();
  const unsubscribeTimetable = subscribeTimetableChanges(stop);
  const unsubscribeImports = subscribePersonalImports(({ scope }) => {
    if (scope.owner === before.owner && scope.schoolId === before.schoolId) stop();
  });
  const timer = setTimeout(() => { timedOut = true; stop(); }, WAIT_MS);
  try {
    if (!active()) throw new AvailabilityError('blocked', STOPPED);
    const ledger = await abortableCampusRead(() => snapshotPersonalImports(before, active), abort.signal);
    if (!active()) throw new AvailabilityError('blocked', CHANGED);
    const timetable = await abortableCampusRead(() => readAssistantTimetable('', before.schoolId,
      context.platformTimetable), abort.signal);
    if (!active()) throw new AvailabilityError('blocked', CHANGED);
    const canonicalSchoolId = toPublicSchoolId(before.schoolId) || before.schoolId;
    if (!timetable || timetable.schoolId !== canonicalSchoolId || !Array.isArray(timetable.records) ||
        !timetable.records.length || timetable.records.some((row) => !row || row.kind !== 'timetable' ||
          row.schoolId !== canonicalSchoolId)) throw new AvailabilityError('unavailable', UNAVAILABLE);
    return { generation: before, ledger, canonicalSchoolId, checkedAt: new Date().toISOString(),
      records: JSON.parse(JSON.stringify(timetable.records)) as PersonalImportRecord[] };
  } catch (error) {
    if (timedOut) throw new AvailabilityError('unavailable', '核對課表與行程的等待時間已過，請稍後重新尋找。');
    if (signal?.aborted) throw new AvailabilityError('blocked', STOPPED);
    if (!sameGeneration(before, context)) throw new AvailabilityError('blocked', CHANGED);
    if (error instanceof AvailabilityError) throw error;
    throw new AvailabilityError('unavailable', UNAVAILABLE);
  } finally {
    running = false;
    clearTimeout(timer);
    signal?.removeEventListener('abort', stop);
    unsubscribeTimetable(); unsubscribeImports();
  }
}

function eventIntervals(ledger: PersonalImportLedger): Interval[] {
  return ledger.records.filter((row) => row.kind === 'events').map((row) => {
    const endDate = row.allDay ? exclusiveAllDayEnd(row.date!, row.endDate) : row.endDate || row.date;
    const start = Date.parse(`${row.date}T${row.allDay ? '00:00' : row.startTime}:00+08:00`);
    const end = Date.parse(`${endDate}T${row.allDay ? '00:00' : row.endTime}:00+08:00`);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
      throw new AvailabilityError('unavailable', UNAVAILABLE);
    return { start: start - BUFFER, end: end + BUFFER };
  }).sort((a, b) => a.start - b.start || a.end - b.end);
}

function freeWindows(evidence: Evidence, date: string): CampusClockInterval[] | null {
  const meetings = scheduledSavedClasses(evidence.records, evidence.canonicalSchoolId, date);
  if (!meetings) return null;
  const availability = inspectCampusClockAvailability(meetings.map((entry) => ({
    name: entry.row.title, room: entry.row.location || '',
    startAt: new Date(entry.startAt).toISOString(), endAt: new Date(entry.endAt).toISOString(),
  })), date);
  if (!availability.valid) return null;
  const earliest = Date.parse(`${date}T08:00:00+08:00`);
  const latest = Date.parse(`${date}T22:00:00+08:00`);
  let gaps = availability.gaps.map((gap) => ({
    start: Math.max(Date.parse(gap.startAt) + BUFFER, earliest),
    end: Math.min(Date.parse(gap.endAt) - BUFFER, latest),
  })).filter((gap) => gap.end > gap.start);
  for (const busy of eventIntervals(evidence.ledger)) {
    gaps = gaps.flatMap((gap) => {
      if (busy.end <= gap.start || busy.start >= gap.end) return [gap];
      return [
        ...(busy.start > gap.start ? [{ start: gap.start, end: busy.start }] : []),
        ...(busy.end < gap.end ? [{ start: busy.end, end: gap.end }] : []),
      ];
    });
  }
  return gaps.map((gap) => ({ startAt: new Date(gap.start).toISOString(), endAt: new Date(gap.end).toISOString() }));
}

function clock(time: number): string { return new Date(time + 8 * 3_600_000).toISOString().slice(11, 16); }
function failure(error: unknown): Failure {
  return error instanceof AvailabilityError ? { kind: error.kind, message: error.message }
    : { kind: 'unavailable', message: UNAVAILABLE };
}

/** Suggestions are read-only, bounded to today plus six days, and never inferred from a blank day. */
export async function findCourseworkStudySlots(context: AssistantCalendarContext, dueAt: string,
  options: { signal?: AbortSignal } = {}): Promise<CourseworkStudySlots> {
  try {
    const deadline = Date.parse(dueAt);
    if (!Number.isFinite(deadline) || deadline <= Date.now())
      return { kind: 'no-slot', message: '作業期限已過，沒有可安排的未來準備時段。' };
    const evidence = await readEvidence(context, options.signal);
    const now = Date.now();
    const midnight = Date.parse(`${classDate(new Date(now))}T00:00:00+08:00`);
    const windowEnd = Math.min(midnight + 7 * DAY, deadline);
    const slots: CourseworkStudySlot[] = [];
    let incomplete = false;
    for (let day = midnight; day < windowEnd && slots.length < 3; day += DAY) {
      const date = classDate(new Date(day));
      const gaps = freeWindows(evidence, date);
      if (gaps === null) { incomplete = true; continue; }
      for (const gap of gaps) {
        // Strictly future, including an invocation exactly on a five-minute grid.
        const chosen = selectCampusClockStudySlot({ valid: true, gaps: [gap], conflicts: [] }, now + 1, windowEnd);
        if (!chosen) continue;
        const slot = Object.freeze({ date, startTime: clock(Date.parse(chosen.startAt)),
          endTime: clock(Date.parse(chosen.endAt)), checkedAt: evidence.checkedAt, summary: SUMMARY });
        proofs.set(slot, { owner: evidence.generation.owner, schoolId: evidence.generation.schoolId, deadline, windowEnd });
        slots.push(slot);
        if (slots.length === 3) break;
      }
    }
    if (options.signal?.aborted || !sameGeneration(evidence.generation, context)) return { kind: 'blocked', message: CHANGED };
    if (!slots.length) return incomplete ? { kind: 'unavailable', message: UNAVAILABLE }
      : { kind: 'no-slot', message: '今天起七天內、作業截止前，已存課表的課間空堂沒有足夠的 30 分鐘。可自行核對後手動輸入其他時段。' };
    return { kind: 'available', slots: Object.freeze(slots), checkedAt: evidence.checkedAt,
      message: '找到可供核對的 30 分鐘準備時段。請選擇一個，再確認建立；尚未保留或保存時段。' };
  } catch (error) { return failure(error); }
}

/** Re-read the selected interval. The final ledger comparison runs inside the existing write lock. */
export async function recheckCourseworkStudySlot(slot: CourseworkStudySlot, context: AssistantCalendarContext,
  options: { signal?: AbortSignal } = {}): Promise<
    { kind: 'ready'; writeCheck: AssistantCalendarWriteCheck } | { kind: 'blocked' | 'changed' | 'unavailable'; message: string }
  > {
  const proof = proofs.get(slot);
  if (!proof || assistantCalendarOwner(context) !== proof.owner || context.schoolId !== proof.schoolId)
    return { kind: 'blocked', message: '這份空堂建議已失效，請重新尋找並核對時段。' };
  try {
    const evidence = await readEvidence(context, options.signal);
    const start = Date.parse(`${slot.date}T${slot.startTime}:00+08:00`);
    const end = Date.parse(`${slot.date}T${slot.endTime}:00+08:00`);
    const gaps = freeWindows(evidence, slot.date);
    if (gaps === null) return { kind: 'unavailable', message: UNAVAILABLE };
    if (!(start > Date.now() && end - start === DURATION && end <= proof.deadline && end <= proof.windowEnd) ||
        !gaps.some((gap) => start >= Date.parse(gap.startAt) && end <= Date.parse(gap.endAt)))
      return { kind: 'changed', message: CHANGED };
    const fingerprint = JSON.stringify(evidence.ledger);
    return { kind: 'ready', writeCheck: {
      isCurrent: () => !options.signal?.aborted && sameGeneration(evidence.generation, context) && start > Date.now(),
      matches: (ledger) => JSON.stringify(ledger) === fingerprint,
      message: CHANGED,
    } };
  } catch (error) {
    const result = failure(error);
    return { kind: result.kind === 'no-slot' ? 'changed' : result.kind, message: result.message };
  }
}
