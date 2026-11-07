import { useCallback, useEffect, useRef, useState } from 'react';
import {
  assistantCalendarOwner, restoreAssistantCalendarTasks,
  type AssistantCalendarContext, type AssistantCalendarTask,
} from '../services/assistantCalendarExecution';

const LOAD_ERROR = '目前無法讀取先前的行程操作紀錄。請稍後重新載入；新的行程操作會在紀錄可讀取後才開放。';

/** Only task evidence is restored. Chat, cloud sessions and write approval are not. */
export function useAssistantCalendarRecovery(context: AssistantCalendarContext) {
  const owner = assistantCalendarOwner(context);
  const schoolId = context.schoolId;
  const latest = useRef(context);
  latest.current = context;
  const mounted = useRef(false);
  const generation = useRef(0);
  const [state, setState] = useState<{
    owner: string | null;
    schoolId: string;
    loading: boolean;
    error: string;
    tasks: AssistantCalendarTask[];
  }>({ owner, schoolId, loading: !!owner, error: '', tasks: [] });

  const reload = useCallback(async () => {
    const request = ++generation.current;
    const access = latest.current;
    const current = () => mounted.current && generation.current === request &&
      latest.current.schoolId === schoolId && assistantCalendarOwner(latest.current) === owner &&
      access.isCurrent() && (!access.platformTimetable || access.platformTimetable.isCurrent());
    if (!owner || !current()) return;
    setState({ owner, schoolId, loading: true, error: '', tasks: [] });
    try {
      const tasks = await restoreAssistantCalendarTasks({ ...access, isCurrent: current });
      if (current()) setState({ owner, schoolId, loading: false, error: '', tasks });
    } catch {
      if (current()) setState({ owner, schoolId, loading: false, error: LOAD_ERROR, tasks: [] });
    }
  }, [owner, schoolId]);

  useEffect(() => {
    mounted.current = true;
    if (owner) void reload();
    else setState({ owner, schoolId, loading: false, error: '', tasks: [] });
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
        tasks.findIndex((candidate) => candidate.proposal.mutationId === entry.proposal.mutationId) === index) };
    });
  };

  // Hide an invalid scope in this render, before an effect can clear old state.
  const visible = owner && state.owner === owner && state.schoolId === schoolId
    ? state : { loading: !!owner, error: '', tasks: [] as AssistantCalendarTask[] };
  return { ...visible, reload, updateTask };
}
