import { parsePersonalImportSnapshot } from '@campus/shared/src/imports/sync';
import { authenticateCourseworkFollowup, eventInterval, eventRecord, signCard } from './actions';
import { courseworkStudyGuard, courseworkStudyTarget, courseworkStudyWindows, readCourseworkStudyTask,
  selectCourseworkStudyEvent, studyGuardForTask } from './courseworkStudy';
import { COURSEWORK_STUDY_MESSAGES } from './courseworkStudyRequest';
import { bounded, eventArgs, fail, hash, id, object, requireAssistantPermission,
  type Adapter, type Binding, type Card, type CourseworkStudyGuard, type CourseworkStudyTarget,
  type EventArgs, type Ledger, type Step } from './contracts';
import { operationSignal, withOperationSignal } from './operation';

/** Old signatures authenticate provenance only; the new card carries a compact, signed source guard. */
export type CourseworkRecoveryGuard = { mutationId: string; recordHash: string };
export type CourseworkRecoveryProof = { issuedContext: string; conversationId: string; token: string; args: EventArgs };
export function courseworkRecoveryProof(raw: unknown): CourseworkRecoveryProof {
  const value = object(raw, ['issuedContext', 'conversationId', 'token', 'args']);
  if (typeof value.issuedContext !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value.issuedContext) ||
      typeof value.token !== 'string' || value.token.length > 4096) return fail();
  return { issuedContext: value.issuedContext, conversationId: id(value.conversationId), token: value.token, args: eventArgs(value.args) };
}
export function courseworkRecoveryGuard(raw: unknown): CourseworkRecoveryGuard {
  const value = object(raw, ['mutationId', 'recordHash']);
  if (typeof value.mutationId !== 'string' || !/^av2_[a-f0-9]{32}$/.test(value.mutationId) ||
      typeof value.recordHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.recordHash)) return fail();
  return { mutationId: value.mutationId, recordHash: value.recordHash };
}
export function courseworkRecoveryId(binding: Binding, originalMutationId: string): string {
  return 'av2_' + hash({ operation: 'coursework.recovery.v1', account: binding.account,
    schoolId: binding.schoolId, originalMutationId }).slice(0, 32);
}

/** Validate the original event against the same ledger revision that will guard the write. */
export function verifyCourseworkRecoveryCalendar(binding: Binding, raw: CourseworkRecoveryGuard,
  study: CourseworkStudyGuard, sourceLedger: Ledger, now: number): void {
  operationSignal()?.throwIfAborted();
  const guard = courseworkRecoveryGuard(raw);
  if (study.policy !== 'coursework-gap') return fail('COURSEWORK_RECOVERY_UNAVAILABLE', 409);
  const ledger = parsePersonalImportSnapshot(sourceLedger, binding.schoolId);
  const childId = courseworkRecoveryId(binding, guard.mutationId);
  if (ledger.records.some(row => row.id === childId)) return fail('COURSEWORK_RECOVERY_EXISTS', 409);
  const originals = ledger.records.filter(row => row.id === guard.mutationId);
  // Absence cannot establish a completed original write: it may be undispatched
  // or still in flight after a timeout. Only an exact, elapsed stored row qualifies.
  if (originals.length !== 1) return fail('COURSEWORK_RECOVERY_UNAVAILABLE', 409);
  const original = originals[0];
  if (original.kind !== 'events' || hash(original) !== guard.recordHash)
    return fail('COURSEWORK_RECOVERY_UNAVAILABLE', 409);
  const originalEvent = eventArgs({ title: original.title, date: original.date, allDay: original.allDay ?? !original.startTime,
    ...(original.endDate ? { endDate: original.endDate } : {}), ...(original.startTime ? { startTime: original.startTime } : {}),
    ...(original.endTime ? { endTime: original.endTime } : {}) });
  const [start, end] = eventInterval(originalEvent);
  if (end > now) return fail('COURSEWORK_RECOVERY_UNAVAILABLE', 409);
  const remaining = { ...ledger, records: ledger.records.filter(row => row.id !== guard.mutationId) };
  if (!remaining.records.some(row => row.kind === 'timetable')) return fail('SCHEDULE_INCOMPLETE', 409);
  if (!courseworkStudyWindows(remaining, binding, originalEvent.date).some(gap => gap.start <= start && gap.end >= end))
    return fail('COURSEWORK_RECOVERY_UNAVAILABLE', 409);
  // The ledger has no task IDs. Conservatively reject a still-active event with
  // the same reviewed title; this does not claim to identify renamed arrangements.
  for (const row of ledger.records) {
    if (row.kind !== 'events' || row.id === guard.mutationId || row.title !== originalEvent.title) continue;
    const event = eventArgs({ title: row.title, date: row.date,
      ...(row.endDate ? { endDate: row.endDate } : {}), allDay: row.allDay ?? !row.startTime,
      ...(row.startTime ? { startTime: row.startTime } : {}), ...(row.endTime ? { endTime: row.endTime } : {}) });
    if (eventInterval(event)[1] > now) return fail('COURSEWORK_RECOVERY_UNAVAILABLE', 409);
  }
}

const MESSAGES: Record<string, string> = {
  ...COURSEWORK_STUDY_MESSAGES,
  COURSEWORK_RECOVERY_UNAVAILABLE: '目前無法確認這筆準備行程可以重新安排。請重新核對作業與原行程；這次沒有建立行程。',
  COURSEWORK_RECOVERY_EXISTS: '這筆準備行程已經有重新安排的紀錄。請先讀回並查看行事曆，不會重複新增。',
};
export async function prepareCourseworkRecoveryRequest(input: {
  target: CourseworkStudyTarget; recovery: CourseworkRecoveryProof; adapter: Adapter; binding: Binding;
  secret: string; writes: boolean; now: number; signal: AbortSignal;
}): Promise<{ answer: string; cards: Card[]; steps: Step[]; stopReason: string; dataRead: true }> {
  const target = courseworkStudyTarget(input.target), recovery = courseworkRecoveryProof(input.recovery);
  const steps: Step[] = [];
  const started = Date.now(), currentTime = () => input.now + Math.max(0, Date.now() - started);
  try {
    return await bounded(signal => withOperationSignal(signal, async () => {
      const proof = authenticateCourseworkFollowup({ ...input.binding, session: recovery.issuedContext,
        conversationId: recovery.conversationId }, { token: recovery.token, args: recovery.args }, input.secret, currentTime());
      if (!proof.studyGuard || proof.studyGuard.policy !== 'coursework-gap' || proof.studyGuard.workspaceId !== target.workspaceId ||
          proof.studyGuard.taskId !== target.taskId || proof.studyGuard.kind !== target.kind)
        return fail('COURSEWORK_RECOVERY_UNAVAILABLE', 409);
      const study = courseworkStudyGuard(proof.studyGuard);
      await requireAssistantPermission(input.adapter, 'createPersonalEvent');
      // One source read + one ledger read fit the real adapter's request budget.
      // Do not compose followup and planning readers: that would read everything twice.
      const task = await readCourseworkStudyTask(input.adapter, target);
      if (studyGuardForTask(task, study.policy).fingerprint !== study.fingerprint) return fail('COURSEWORK_CHANGED', 409);
      const ledger = await input.adapter.ledger();
      signal.throwIfAborted();
      if (ledger.schoolId !== input.binding.schoolId) return fail('FORBIDDEN_SCOPE', 403);
      const guard = { mutationId: proof.mutationId,
        recordHash: hash(eventRecord(proof.event, input.binding.schoolId, proof.mutationId, proof.iat)) };
      verifyCourseworkRecoveryCalendar(input.binding, guard, study, ledger, currentTime());
      steps.push({ name: 'get_coursework_recovery', status: 'ok', summary: '已重新核對作業、原行程與其他已知安排' });
      const event = selectCourseworkStudyEvent(ledger, input.binding, task, currentTime(), target.date);
      if (!event) return { answer: '今天起七天內、截止前的已知課間空堂沒有符合條件的 30 分鐘；原行程保留，尚未建立新行程。',
        cards: [], steps, stopReason: 'NO_STUDY_SLOT', dataRead: true as const };
      if (!input.writes) return { answer: '已找到新的 30 分鐘時段，但目前未開放由助理儲存個人行程；尚未建立新行程。',
        cards: [], steps, stopReason: 'WRITES_DISABLED', dataRead: true as const };
      await requireAssistantPermission(input.adapter, 'createPersonalEvent');
      signal.throwIfAborted();
      const card = signCard(input.binding, 'propose_personal_event', event, ledger.revision,
        input.secret, currentTime(), undefined, undefined, study, undefined, guard);
      return { answer: `已重新找到準備時段：\n${event.date} ${event.startTime}–${event.endTime}｜${task.title}\n原行程保留。按下確認後會再次核對來源與行事曆，儲存並讀回確認；目前尚未新增，也不代表已繳交作業。`,
        cards: [card], steps: [...steps, { name: 'propose_personal_event', status: 'ok' as const, summary: '已準備新的 30 分鐘行程，等待確認' }],
        stopReason: '', dataRead: true as const };
    }), input.signal, 16000);
  } catch (error) {
    if (input.signal.aborted || (error as { status?: number }).status === 401) throw error;
    const code = (error as { code?: string }).code || 'COURSEWORK_RECOVERY_UNAVAILABLE';
    return { answer: MESSAGES[code] || MESSAGES.COURSEWORK_RECOVERY_UNAVAILABLE, cards: [],
      steps: [...steps, { name: 'propose_coursework_recovery', status: 'error', summary: code }], stopReason: code, dataRead: true };
  }
}
