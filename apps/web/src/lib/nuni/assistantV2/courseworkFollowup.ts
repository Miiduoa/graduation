import {
  parseAssistantCourseworkFollowup,
  type AssistantCourseworkFollowup,
} from '@campus/shared/src/assistantCourseworkFollowup';
import { parsePersonalImportSnapshot } from '@campus/shared/src/imports/sync';
import { authenticateCourseworkFollowup, eventInterval, eventRecord } from './actions';
import { courseworkStudyWindows, readCourseworkStudySource, studyGuardForTask } from './courseworkStudy';
import { canonical, type Adapter, type Binding, type Ledger } from './contracts';
import { operationSignal } from './operation';
import { validateEventProposal } from './tools';

/** Exact signed provenance plus fresh scoped reads; no write or model dependency. */
export async function readCourseworkFollowup(input: {
  binding: Binding;
  proof: { token: unknown; args: unknown };
  secret: string;
  now: number;
  adapter: Adapter;
}): Promise<AssistantCourseworkFollowup> {
  operationSignal()?.throwIfAborted();
  // Invalid signatures/scopes are request failures, never an "unavailable" success.
  const proof = authenticateCourseworkFollowup(input.binding, input.proof, input.secret, input.now);
  const started = Date.now();
  const currentTime = () => input.now + Math.max(0, Date.now() - started);
  const guard = proof.studyGuard;
  const task = guard ? { workspaceId: guard.workspaceId, taskId: guard.taskId, kind: guard.kind } : null;
  let source: AssistantCourseworkFollowup['source'] = null;
  let calendar: AssistantCourseworkFollowup['calendar'] = 'unavailable';
  const result = (status: AssistantCourseworkFollowup['status'], checkedAt = currentTime()) => parseAssistantCourseworkFollowup({
    version: 1, operation: 'coursework.followup', schoolId: input.binding.schoolId,
    mutationId: proof.mutationId, checkedAt: new Date(checkedAt).toISOString(),
    status, task, source, calendar, event: proof.event,
  }, { schoolId: input.binding.schoolId, mutationId: proof.mutationId, event: proof.event });
  if (!guard || !task) return result('not_coursework');

  const reads = await Promise.allSettled([
    readCourseworkStudySource(input.adapter, task),
    input.adapter.ledger().then(ledger => parsePersonalImportSnapshot(ledger, input.binding.schoolId)),
  ]);
  operationSignal()?.throwIfAborted();
  for (const read of reads)
    if (read.status === 'rejected' && (read.reason as { status?: number })?.status === 401) throw read.reason;
  const [sourceRead, ledgerRead] = reads;
  if (sourceRead.status === 'fulfilled') {
    const { course, task: current } = sourceRead.value;
    source = { title: current.title, courseName: course.title, dueAt: current.dueAt,
      state: current.state as 'open' | 'closed', submitted: current.submitted };
  }
  let ledger: Ledger | null = null;
  if (ledgerRead.status === 'fulfilled') {
    ledger = ledgerRead.value;
    const row = ledger.records.find(record => record.id === proof.mutationId);
    const expected = eventRecord(proof.event, input.binding.schoolId, proof.mutationId, proof.iat);
    calendar = !row ? 'missing' : canonical(row) === canonical(expected) ? 'matching' : 'changed';
  }
  // A partial read cannot establish completion, readiness or absence of conflicts.
  if (sourceRead.status !== 'fulfilled' || !source || !ledger) return result('unavailable');
  if (source.submitted) return result('submitted');
  if (source.state === 'closed') return result('closed');
  if (calendar === 'changed') return result('event_changed');
  if (calendar === 'missing') return result('event_missing');
  if (studyGuardForTask(sourceRead.value.task, guard.policy).fingerprint !== guard.fingerprint)
    return result('source_changed');

  // The original record must not collide with itself. Recheck every other
  // currently synced event and the known timetable without inventing a blank schedule.
  const remaining = { ...ledger, records: ledger.records.filter(row => row.id !== proof.mutationId) };
  if (!remaining.records.some(row => row.kind === 'timetable')) return result('unavailable');
  const [start, end] = eventInterval(proof.event);
  try {
    if (guard.policy === 'coursework-gap') {
      if (!courseworkStudyWindows(remaining, input.binding, proof.event.date)
        .some(gap => gap.start <= start && gap.end >= end)) return result('conflict');
    } else validateEventProposal(remaining, proof.event, [], currentTime(), false);
  } catch (error) {
    if ((error as { code?: string }).code === 'EVENT_CONFLICT') return result('conflict');
    return result('unavailable');
  }
  const checkedAt = currentTime();
  return result(checkedAt >= end ? 'elapsed' : checkedAt >= start ? 'in_progress' : 'scheduled', checkedAt);
}
