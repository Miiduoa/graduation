import { useCallback, useEffect, useRef, useState } from 'react';
import {
  assistantCalendarOwner, sameAssistantCalendarEvent,
  type AssistantCalendarContext, type AssistantCalendarTask,
} from '../services/assistantCalendarExecution';
import {
  restoreAssistantCalendarWorkspace, updateAssistantCalendarBatchTask,
  type AssistantCalendarBatchView,
} from '../services/assistantCalendarBatchExecution';

const LOAD_ERROR = '目前無法讀取先前的行程操作紀錄。請稍後重新載入；新的行程操作會在紀錄可讀取後才開放。';
const BATCH_LOAD_ERROR = '目前無法讀取多筆行程的安排。請重新載入；未讀到的進度不能視為尚未開始。';

/** Reconcile every visible copy, without turning a draft or history into permission. */
export function calendarTaskFromBatch(task: AssistantCalendarTask, batch: AssistantCalendarBatchView): AssistantCalendarTask {
  if (task.proposal.owner !== batch.plan.owner || task.proposal.schoolId !== batch.plan.schoolId) return task;
  const match = batch.steps.find((step) => step.state === 'recorded' &&
    sameAssistantCalendarEvent(step.event, step.task.proposal.event) &&
    (step.task.proposal.mutationId === task.proposal.mutationId ||
      sameAssistantCalendarEvent(step.task.proposal.event, task.proposal.event)));
  return match?.state === 'recorded' ? match.task : task;
}

export function mergeCalendarBatchEvidence(previous: AssistantCalendarBatchView, next: AssistantCalendarBatchView) {
  if (previous.plan.id === next.plan.id) return next;
  return next.steps.reduce((view, step) => step.state === 'recorded' && sameAssistantCalendarEvent(step.event, step.task.proposal.event)
    ? updateAssistantCalendarBatchTask(view, step.task) : view, previous);
}

type CalendarRecoveryResult = {
  error: string;
  batchError: string;
  tasks: AssistantCalendarTask[];
  batches: AssistantCalendarBatchView[];
};

/** Only task evidence is restored. Chat, cloud sessions and write approval are not. */
export function useAssistantCalendarRecovery(context: AssistantCalendarContext,
  onRestored?: (result: CalendarRecoveryResult) => void) {
  const owner = assistantCalendarOwner(context);
  const schoolId = context.schoolId;
  const latest = useRef(context);
  latest.current = context;
  const notify = useRef(onRestored);
  notify.current = onRestored;
  const mounted = useRef(false);
  const generation = useRef(0);
  const [state, setState] = useState<{
    owner: string | null;
    schoolId: string;
    loading: boolean;
    error: string;
    batchError: string;
    tasks: AssistantCalendarTask[];
    batches: AssistantCalendarBatchView[];
  }>({ owner, schoolId, loading: !!owner, error: '', batchError: '', tasks: [], batches: [] });

  const reload = useCallback(async () => {
    const request = ++generation.current;
    const access = latest.current;
    const current = () => mounted.current && generation.current === request &&
      latest.current.schoolId === schoolId && assistantCalendarOwner(latest.current) === owner &&
      access.isCurrent() && (!access.platformTimetable || access.platformTimetable.isCurrent());
    if (!owner || !current()) return;
    setState({ owner, schoolId, loading: true, error: '', batchError: '', tasks: [], batches: [] });
    let result: CalendarRecoveryResult;
    try {
      // Single cards and batch progress must share the same fresh operation
      // snapshot; two racing restores could otherwise disagree about deletion.
      const restored = await restoreAssistantCalendarWorkspace({ ...access, isCurrent: current });
      result = { error: '', batchError: restored.batchError ? BATCH_LOAD_ERROR : '',
        tasks: restored.tasks, batches: restored.batches };
    } catch {
      result = { error: LOAD_ERROR, batchError: BATCH_LOAD_ERROR, tasks: [], batches: [] };
    }
    if (current()) {
      setState({ owner, schoolId, loading: false, ...result });
      notify.current?.(result);
    }
  }, [owner, schoolId]);

  useEffect(() => {
    mounted.current = true;
    if (owner) void reload();
    else setState({ owner, schoolId, loading: false, error: '', batchError: '', tasks: [], batches: [] });
    return () => { mounted.current = false; generation.current += 1; };
  }, [owner, schoolId, reload]);

  const updateTask = (task: AssistantCalendarTask, originalId = task.proposal.mutationId) => {
    if (!mounted.current || !owner || assistantCalendarOwner(latest.current) !== owner ||
        latest.current.schoolId !== schoolId || task.proposal.owner !== owner || task.proposal.schoolId !== schoolId) return;
    setState((previous) => {
      if (previous.owner !== owner || previous.schoolId !== schoolId) return previous;
      const tasks = previous.tasks.map((entry) => entry.proposal.mutationId === originalId ||
        entry.proposal.mutationId === task.proposal.mutationId ? task : entry);
      return { ...previous, tasks: tasks.filter((entry, index) =>
        tasks.findIndex((candidate) => candidate.proposal.mutationId === entry.proposal.mutationId) === index),
        batches: previous.batches.map((batch) => updateAssistantCalendarBatchTask(batch, task)) };
    });
  };

  const updateBatch = (batch: AssistantCalendarBatchView, originalId = batch.plan.id) => {
    if (!mounted.current || !owner || assistantCalendarOwner(latest.current) !== owner ||
        latest.current.schoolId !== schoolId || batch.plan.owner !== owner || batch.plan.schoolId !== schoolId) return;
    setState((previous) => {
      if (previous.owner !== owner || previous.schoolId !== schoolId) return previous;
      const existing = previous.batches.some((entry) => [originalId, batch.plan.id].includes(entry.plan.id));
      const batches = previous.batches.map((entry) => entry.plan.id === originalId
        ? batch : mergeCalendarBatchEvidence(entry, batch));
      if (!existing) batches.push(batch);
      return { ...previous,
        tasks: previous.tasks.map((task) => calendarTaskFromBatch(task, batch)),
        batches: batches.filter((entry, index) => batches.findIndex((candidate) => candidate.plan.id === entry.plan.id) === index),
      };
    });
  };

  // Hide an invalid scope in this render, before an effect can clear old state.
  const visible = owner && state.owner === owner && state.schoolId === schoolId
    ? state : { loading: !!owner, error: '', batchError: '', tasks: [] as AssistantCalendarTask[],
      batches: [] as AssistantCalendarBatchView[] };
  return { ...visible, reload, updateTask, updateBatch };
}
