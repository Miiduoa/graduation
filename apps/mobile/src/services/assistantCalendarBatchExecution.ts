import {
  createAssistantCalendarReceipt, parseAssistantCalendarEvent,
  type AssistantCalendarEvent,
} from '@campus/shared/src/assistantExecution';
import { PERSONAL_IMPORT_BACKUP_MAX_RECORDS } from '@campus/shared/src/imports/backup';
import { exclusiveAllDayEnd } from '@campus/shared/src/imports/eventCalendar';
import { createPersonalImportId } from '@campus/shared/src/imports/records';
import {
  assistantCalendarOwner, confirmAssistantCalendarTask, createAssistantCalendarTask,
  findPersistedAssistantCalendarTask, restoreAssistantCalendarTasks, sameAssistantCalendarEvent,
  type AssistantCalendarContext, type AssistantCalendarProposal, type AssistantCalendarTask,
} from './assistantCalendarExecution';
import {
  ASSISTANT_CALENDAR_JOURNAL_MAX_BYTES, ASSISTANT_CALENDAR_JOURNAL_MAX_ENTRIES,
  ASSISTANT_CALENDAR_SOURCE_NAME, assistantCalendarEventIdentity, readAssistantCalendarJournal,
} from './assistantCalendarJournal';
import {
  ASSISTANT_CALENDAR_BATCH_MAX_STEPS, AssistantCalendarBatchError,
  cancelAssistantCalendarBatchPlan, parseAssistantCalendarBatchPlan, readAssistantCalendarBatchPlans,
  sameAssistantCalendarBatchPlan, saveAssistantCalendarBatchPlan, type AssistantCalendarBatchPlan,
} from './assistantCalendarBatchStore';
import { personalImportStorageKey, snapshotPersonalImports, type PersonalImportScope } from './personalImports';

export type AssistantCalendarBatchTask = Extract<AssistantCalendarTask, { state: 'verified' | 'unknown' | 'blocked' }>;
export type AssistantCalendarBatchStepView =
  | { id: string; event: AssistantCalendarEvent; state: 'not-started' | 'running'; task?: never }
  | { id: string; event: AssistantCalendarEvent; state: 'recorded'; task: AssistantCalendarBatchTask };
export type AssistantCalendarBatchStop = {
  reason: 'unknown' | 'blocked' | 'warning' | 'aborted' | 'cancelled' | 'preflight' | 'unavailable' | 'timeout';
  message: string;
};
export type AssistantCalendarBatchView = {
  plan: AssistantCalendarBatchPlan;
  state: 'review' | 'running' | 'paused' | 'completed' | 'cancelled';
  steps: AssistantCalendarBatchStepView[];
  progress: { verified: number; total: number; notStarted: number };
  stop?: AssistantCalendarBatchStop;
  checking?: boolean;
};
export type AssistantCalendarBatchRunOptions = {
  signal?: AbortSignal;
  onUpdate?: (view: AssistantCalendarBatchView) => void;
};
export type AssistantCalendarWorkspace = {
  tasks: AssistantCalendarTask[];
  batches: AssistantCalendarBatchView[];
  batchError?: string;
};
const READ_WAIT_MS = 20_000;
const RUN_WAIT_MS = ASSISTANT_CALENDAR_BATCH_MAX_STEPS * 20_000;
const STOPPED = '後續安排已停止。處理中的行程仍須核對；這不會刪除已建立的行程，也不會自動重送。';
const CANCELLED = '已取消這份計畫尚未開始的安排。已建立或待核對的行程仍保留原紀錄。';
type Run = {
  plan: AssistantCalendarBatchPlan;
  latest?: AssistantCalendarBatchView;
  current?: { index: number; proposal: AssistantCalendarProposal };
  stopped?: 'aborted' | 'cancelled' | 'timeout';
  finished: boolean;
};
const runs = new Map<string, Run>();

function scopeFor(context: AssistantCalendarContext): PersonalImportScope {
  const owner = assistantCalendarOwner(context);
  if (!owner) throw new AssistantCalendarBatchError('session-changed');
  return { owner, schoolId: context.schoolId };
}
function current(scope: PersonalImportScope, context: AssistantCalendarContext) {
  try { return assistantCalendarOwner(context) === scope.owner && context.schoolId === scope.schoolId; } catch { return false; }
}
function guard(scope: PersonalImportScope, context: AssistantCalendarContext) {
  if (!current(scope, context)) throw new AssistantCalendarBatchError('session-changed');
}
function safeError(error: unknown, scope: PersonalImportScope, context: AssistantCalendarContext): AssistantCalendarBatchError {
  guard(scope, context);
  return error instanceof AssistantCalendarBatchError ? error : new AssistantCalendarBatchError('batch-unavailable');
}
async function boundedRead<T>(context: AssistantCalendarContext,
  work: (access: AssistantCalendarContext, scope: PersonalImportScope) => Promise<T>): Promise<T> {
  const scope = scopeFor(context);
  let live = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const access = { ...context, isCurrent: () => live && current(scope, context) };
  try {
    const result = await Promise.race([
      work(access, scope),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => { live = false; reject(new AssistantCalendarBatchError('batch-timeout')); }, READ_WAIT_MS);
      }),
    ]);
    guard(scope, context);
    return result;
  } catch (error) { throw safeError(error, scope, context); }
  finally { live = false; if (timer !== undefined) clearTimeout(timer); }
}
function terminal(task: AssistantCalendarTask): AssistantCalendarBatchTask {
  if (task.state !== 'verified' && task.state !== 'unknown' && task.state !== 'blocked')
    throw new AssistantCalendarBatchError('batch-corrupt');
  return task;
}
function expectedTask(event: AssistantCalendarEvent, rawTask: AssistantCalendarTask): AssistantCalendarBatchTask {
  const task = terminal(rawTask);
  if (sameAssistantCalendarEvent(event, task.proposal.event)) return task;
  const historical = task.state === 'verified' ? task.receipt : task.state === 'unknown' ? task.lastVerified : undefined;
  return {
    proposal: task.proposal, state: 'unknown', reason: 'changed',
    message: '原行程紀錄與這份計畫要求的內容不同。請核對原紀錄；這裡不會覆寫內容或另外建立。',
    ...(historical ? { lastVerified: historical } : {}),
  };
}
function derive(plan: AssistantCalendarBatchPlan, steps: AssistantCalendarBatchStepView[],
  sticky?: AssistantCalendarBatchStop): AssistantCalendarBatchView {
  const verified = steps.filter((step) => step.state === 'recorded' && step.task.state === 'verified').length;
  const view: AssistantCalendarBatchView = {
    plan, state: 'review', steps, progress: {
      verified, total: steps.length, notStarted: steps.filter((step) => step.state === 'not-started').length,
    },
  };
  if (plan.cancelledAt) return { ...view, state: 'cancelled', stop: { reason: 'cancelled', message: CANCELLED } };
  const unresolved = steps.find((step) => step.state === 'recorded' && step.task.state !== 'verified');
  if (unresolved?.state === 'recorded' && unresolved.task.state !== 'verified')
    return { ...view, state: 'paused', stop: { reason: unresolved.task.state, message: unresolved.task.message } };
  const warned = steps.find((step) => step.state === 'recorded' && step.task.state === 'verified' && step.task.warning);
  if (warned?.state === 'recorded' && warned.task.state === 'verified')
    return { ...view, state: 'paused', stop: { reason: 'warning', message: warned.task.warning! } };
  if (sticky) return { ...view, state: 'paused', stop: sticky };
  if (steps.some((step) => step.state === 'running')) return { ...view, state: 'running' };
  if (verified === steps.length) return { ...view, state: 'completed' };
  return view;
}
function viewFor(plan: AssistantCalendarBatchPlan, tasks: readonly AssistantCalendarTask[]): AssistantCalendarBatchView {
  const steps: AssistantCalendarBatchStepView[] = plan.steps.map((step) => {
    const task = tasks.find((candidate) => candidate.proposal.owner === plan.owner && candidate.proposal.schoolId === plan.schoolId &&
      assistantCalendarEventIdentity(candidate.proposal.event) === assistantCalendarEventIdentity(step.event));
    return task ? { ...step, state: 'recorded', task: expectedTask(step.event, task) } : { ...step, state: 'not-started' };
  });
  return derive(plan, steps);
}

/** Share fresh evidence across cards without changing another plan's reviewed event. */
export function updateAssistantCalendarBatchTask(view: AssistantCalendarBatchView,
  task: AssistantCalendarTask): AssistantCalendarBatchView {
  if (!['verified', 'unknown', 'blocked'].includes(task.state) ||
      task.proposal.owner !== view.plan.owner || task.proposal.schoolId !== view.plan.schoolId) return view;
  let changed = false;
  const steps: AssistantCalendarBatchStepView[] = view.steps.map((step) => {
    if (assistantCalendarEventIdentity(step.event) !== assistantCalendarEventIdentity(task.proposal.event)) return step;
    changed = true;
    return { id: step.id, event: step.event, state: 'recorded', task: expectedTask(step.event, task) };
  });
  if (!changed) return view;
  const sticky = view.stop && ['aborted', 'cancelled', 'preflight', 'unavailable', 'timeout', 'warning'].includes(view.stop.reason) ? view.stop : undefined;
  return derive(view.plan, steps, sticky);
}
async function authoritativePlan(raw: AssistantCalendarBatchPlan,
  access: AssistantCalendarContext, scope: PersonalImportScope): Promise<AssistantCalendarBatchPlan> {
  const requested = parseAssistantCalendarBatchPlan(raw, scope);
  const plans = await readAssistantCalendarBatchPlans(scope, () => current(scope, access));
  guard(scope, access);
  const plan = plans.find((candidate) => candidate.id === requested.id);
  if (!plan || !sameAssistantCalendarBatchPlan(plan, requested)) throw new AssistantCalendarBatchError('batch-corrupt');
  return plan;
}
function range(event: { date?: string; allDay?: boolean; endDate?: string; startTime?: string; endTime?: string }) {
  const start = Date.parse(event.date + 'T' + (event.allDay ? '00:00' : event.startTime) + ':00+08:00');
  const endDate = event.allDay ? exclusiveAllDayEnd(event.date!, event.endDate) : event.endDate || event.date;
  const end = Date.parse(endDate + 'T' + (event.allDay ? '00:00' : event.endTime) + ':00+08:00');
  return [start, end] as const;
}
function overlap(first: ReturnType<typeof range>, second: ReturnType<typeof range>) {
  return first[0] < second[1] && first[1] > second[0];
}
function validateEvents(raw: readonly AssistantCalendarEvent[]): AssistantCalendarEvent[] {
  if (!Array.isArray(raw) || raw.length < 2 || raw.length > ASSISTANT_CALENDAR_BATCH_MAX_STEPS)
    throw new AssistantCalendarBatchError('batch-invalid');
  let events: AssistantCalendarEvent[];
  try { events = raw.map(parseAssistantCalendarEvent); } catch { throw new AssistantCalendarBatchError('batch-invalid'); }
  if (new Set(events.map(assistantCalendarEventIdentity)).size !== events.length ||
      events.some((event, index) => events.slice(index + 1).some((other) => overlap(range(event), range(other)))))
    throw new AssistantCalendarBatchError('batch-invalid');
  return events;
}
function byteSize(raw: string) {
  let bytes = 0;
  for (const char of raw) {
    const code = char.codePointAt(0)!;
    bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
  }
  return bytes;
}
async function preflight(view: AssistantCalendarBatchView, access: AssistantCalendarContext,
  scope: PersonalImportScope): Promise<string | null> {
  validateEvents(view.plan.steps.map((step) => step.event));
  const pending = view.steps.filter((step) => step.state === 'not-started');
  if (!pending.length) return null;
  for (const step of pending) {
    const [start] = range(step.event);
    if (!Number.isFinite(start) || start <= Date.now()) return '尚未開始的行程已超過起始時間。請調整安排，這次沒有新增行程。';
  }
  const ledger = await snapshotPersonalImports(scope, () => current(scope, access));
  guard(scope, access);
  if (ledger.records.length + pending.length > PERSONAL_IMPORT_BACKUP_MAX_RECORDS)
    return '這台手機的個人紀錄剩餘空間不足以保存這批行程，請先整理紀錄。';
  if (pending.some((step) => ledger.records.some((row) => row.kind === 'events' && overlap(range(step.event), range(row)))))
    return '這批尚未開始的安排與已保存的個人行程重疊，請先核對行事曆並調整時段。';
  const journal = await readAssistantCalendarJournal(scope, () => current(scope, access));
  guard(scope, access);
  if (journal.length + pending.length > ASSISTANT_CALENDAR_JOURNAL_MAX_ENTRIES)
    return '行程操作紀錄的剩餘容量不足以保存這批安排，這次沒有新增行程。';
  const now = new Date().toISOString();
  // Estimate full receipts with the longest allowed ID; these are never saved
  // or used as proposals. Real mutation IDs are minted only during dispatch.
  const projected = pending.map((step, index) => {
    const mutationId = 'batch_capacity_' + String(index).padStart(2, '0') + 'x'.repeat(83);
    const proposal = { ...scope, mutationId, createdAt: now, event: step.event };
    const receipt = createAssistantCalendarReceipt({
      schoolId: scope.schoolId, mutationId, event: step.event, storage: 'device', verifiedAt: now,
      record: { ...step.event, id: mutationId, batchId: mutationId, kind: 'events',
        schoolId: scope.schoolId, academicYear: '', semester: '', importedAt: now,
        source: { type: 'paste', name: ASSISTANT_CALENDAR_SOURCE_NAME, line: 1, rawText: '' } },
    });
    return { proposal, attemptedAt: now, observation: { state: 'verified', checkedAt: now, receipt } };
  });
  if (byteSize(JSON.stringify({ version: 1, ...scope, entries: [...journal, ...projected] })) > ASSISTANT_CALENDAR_JOURNAL_MAX_BYTES)
    return '行程操作紀錄的剩餘儲存空間不足以完整保存這批安排，這次沒有新增行程。';
  return null;
}

/** Persist only the immutable preview. No task, permit or operation ID is created here. */
export function prepareAssistantCalendarBatch(events: readonly AssistantCalendarEvent[],
  context: AssistantCalendarContext): Promise<AssistantCalendarBatchView> {
  const parsed = validateEvents(events);
  return boundedRead(context, async (access, scope) => {
    const requested = parseAssistantCalendarBatchPlan({
      id: 'acb_' + createPersonalImportId(), ...scope, createdAt: new Date().toISOString(),
      steps: parsed.map((event) => ({ id: 'acs_' + createPersonalImportId(), event })),
    }, scope);
    const plan = await saveAssistantCalendarBatchPlan(requested, () => current(scope, access));
    guard(scope, access);
    const tasks = await restoreAssistantCalendarTasks(access);
    guard(scope, access);
    return viewFor(plan, tasks);
  });
}

/** Single cards and every batch derive from the same fresh operation snapshot. */
export function restoreAssistantCalendarWorkspace(context: AssistantCalendarContext): Promise<AssistantCalendarWorkspace> {
  return boundedRead(context, async (access, scope) => {
    const [operations, plans] = await Promise.allSettled([
      restoreAssistantCalendarTasks(access),
      readAssistantCalendarBatchPlans(scope, () => current(scope, access)),
    ]);
    guard(scope, access);
    if (operations.status === 'rejected') throw safeError(operations.reason, scope, access);
    if (plans.status === 'rejected') return {
      tasks: operations.value, batches: [],
      batchError: '目前無法完整讀取行程計畫，已保留原資料。請稍後重新載入計畫；下方單筆行程仍以本次核對結果為準。',
    };
    return { tasks: operations.value, batches: plans.value.map((plan) => viewFor(plan, operations.value)) };
  });
}

/** A plan-store failure must not masquerade as an empty batch list. */
export async function restoreAssistantCalendarBatches(context: AssistantCalendarContext): Promise<AssistantCalendarBatchView[]> {
  const workspace = await restoreAssistantCalendarWorkspace(context);
  if (workspace.batchError) throw new AssistantCalendarBatchError('batch-unavailable');
  return workspace.batches;
}

export function recheckAssistantCalendarBatch(plan: AssistantCalendarBatchPlan,
  context: AssistantCalendarContext): Promise<AssistantCalendarBatchView> {
  return boundedRead(context, async (access, scope) => {
    const saved = await authoritativePlan(plan, access, scope);
    const tasks = await restoreAssistantCalendarTasks(access);
    guard(scope, access);
    return viewFor(saved, tasks);
  });
}

export function cancelRemainingAssistantCalendarBatch(plan: AssistantCalendarBatchPlan,
  context: AssistantCalendarContext): Promise<AssistantCalendarBatchView> {
  const scope = scopeFor(context);
  const requested = parseAssistantCalendarBatchPlan(plan, scope);
  const run = runs.get(personalImportStorageKey(scope));
  if (run?.plan.id === requested.id) {
    if (!sameAssistantCalendarBatchPlan(run.plan, requested)) throw new AssistantCalendarBatchError('batch-corrupt');
    run.stopped = 'cancelled'; // Immediate fence, independent of any pending native write.
  }
  return boundedRead(context, async (access) => {
    await authoritativePlan(requested, access, scope);
    const saved = await cancelAssistantCalendarBatchPlan(requested.id, scope, () => current(scope, access));
    guard(scope, access);
    const tasks = await restoreAssistantCalendarTasks(access);
    guard(scope, access);
    return viewFor(saved, tasks);
  });
}

/** Only a new explicit confirmation calls this. Restoring a plan never calls it. */
export async function confirmAssistantCalendarBatch(rawPlan: AssistantCalendarBatchPlan,
  context: AssistantCalendarContext, options: AssistantCalendarBatchRunOptions = {}): Promise<AssistantCalendarBatchView> {
  const scope = scopeFor(context);
  const requested = parseAssistantCalendarBatchPlan(rawPlan, scope);
  const key = personalImportStorageKey(scope);
  if (runs.has(key)) throw new AssistantCalendarBatchError('batch-busy');
  if (options.signal?.aborted) throw new AssistantCalendarBatchError('batch-unavailable');
  const run: Run = { plan: requested, finished: false };
  runs.set(key, run);
  const deadline = Date.now() + RUN_WAIT_MS;
  const active = () => !run.finished && !run.stopped && Date.now() < deadline && current(scope, context);
  const access = { ...context, isCurrent: active };
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  const publish = (view: AssistantCalendarBatchView) => {
    guard(scope, context);
    // The whole explicit run owns the UI lock, including read-only preflight
    // and the gaps between individual writes.
    const visible = view.state === 'review' ? { ...view, state: 'running' as const } : view;
    run.latest = visible;
    if (!run.finished) {
      try { options.onUpdate?.(visible); } catch { /* A renderer cannot authorize or invalidate a write. */ }
    }
    return visible;
  };
  const stopped = (): AssistantCalendarBatchView => {
    if (!run.latest) throw new AssistantCalendarBatchError(run.stopped === 'timeout' ? 'batch-timeout' : 'batch-unavailable');
    let steps = run.latest.steps;
    if (run.current && steps[run.current.index]?.state === 'running') {
      const { index, proposal } = run.current;
      steps = steps.map((step, position) => position === index ? {
        id: step.id, event: step.event, state: 'recorded' as const,
        task: { proposal, state: 'unknown' as const, reason: 'unavailable' as const, message: STOPPED },
      } : step);
    }
    const reason = run.stopped || 'aborted';
    const view = derive(run.plan, steps);
    return { ...view, state: run.plan.cancelledAt ? 'cancelled' : 'paused',
      stop: { reason, message: reason === 'timeout' ? new AssistantCalendarBatchError('batch-timeout').message : STOPPED } };
  };
  try {
    return await Promise.race([
      (async () => {
        try {
          run.plan = await authoritativePlan(requested, access, scope);
          const tasks = await restoreAssistantCalendarTasks(access);
          guard(scope, context);
          let view = publish(viewFor(run.plan, tasks));
          if (run.stopped) return publish(stopped());
          if (view.state === 'cancelled' || view.state === 'completed' || view.state === 'paused') return view;
          const issue = await preflight(view, access, scope);
          guard(scope, context);
          if (run.stopped) return publish(stopped());
          if (issue) return publish(derive(run.plan, view.steps, { reason: 'preflight', message: issue }));
          for (let index = 0; index < view.steps.length; index++) {
            if (run.stopped || !active()) return publish(stopped());
            if (view.steps[index].state !== 'not-started') continue;
            run.plan = await authoritativePlan(run.plan, access, scope);
            if (run.plan.cancelledAt) return publish(derive(run.plan, view.steps));
            const step = run.plan.steps[index];
            const existing = await findPersistedAssistantCalendarTask(step.event, access);
            guard(scope, context);
            if (run.stopped || !active()) return publish(stopped());
            let task: AssistantCalendarTask;
            if (existing) task = existing;
            else {
              const fresh = createAssistantCalendarTask(step.event, access);
              run.current = { index, proposal: fresh.proposal };
              view = publish(derive(run.plan, view.steps.map((item, position) => position === index
                ? { id: item.id, event: item.event, state: 'running' as const } : item)));
              if (run.stopped || !active()) return publish(stopped());
              task = await confirmAssistantCalendarTask(fresh.proposal, access);
            }
            guard(scope, context);
            if (run.stopped || !active()) return publish(stopped());
            run.current = undefined;
            view = publish(updateAssistantCalendarBatchTask({ ...view, plan: run.plan }, task));
            if (view.state === 'paused' || view.state === 'cancelled') return view;
          }
          return publish(derive(run.plan, view.steps));
        } catch (error) {
          guard(scope, context);
          if (run.stopped) return publish(stopped());
          if (!run.latest) throw safeError(error, scope, context);
          const latest = run.current ? stopped() : run.latest;
          return publish(derive(run.plan, latest.steps, { reason: 'unavailable',
            message: '後續安排已停止。已保存的行程與原操作紀錄仍保留，請重新核對整批結果後，再確認尚未開始的安排。',
          }));
        }
      })(),
      new Promise<AssistantCalendarBatchView>((resolve, reject) => {
        const stop = (reason: 'aborted' | 'timeout') => {
          run.stopped = reason;
          try { resolve(publish(stopped())); } catch (error) { reject(safeError(error, scope, context)); }
        };
        timer = setTimeout(() => stop('timeout'), RUN_WAIT_MS);
        abort = () => stop('aborted');
        options.signal?.addEventListener('abort', abort, { once: true });
        if (options.signal?.aborted) abort();
      }),
    ]);
  } finally {
    run.finished = true;
    if (timer !== undefined) clearTimeout(timer);
    if (abort) options.signal?.removeEventListener('abort', abort);
    if (runs.get(key) === run) runs.delete(key);
  }
}
