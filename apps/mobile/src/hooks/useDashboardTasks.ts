import { useCallback, useEffect, useRef, useState } from 'react';
import type { NextBestAction } from '../data';

export type DashboardTaskStatus = 'loading' | 'ready' | 'error';

/** Keep school-account tasks separate across refreshes and account/campus changes. */
export function useDashboardTasks(scope: string, load: () => Promise<NextBestAction[]>) {
  const [snapshot, setSnapshot] = useState<{
    scope: string;
    status: DashboardTaskStatus;
    tasks: NextBestAction[];
  }>({ scope, status: 'loading', tasks: [] });
  const generation = useRef(0);
  const mounted = useRef(true);
  const currentScope = useRef(scope);
  currentScope.current = scope;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current += 1;
    };
  }, []);

  const refresh = useCallback(async () => {
    const run = ++generation.current;
    setSnapshot({ scope, status: 'loading', tasks: [] });
    const current = () =>
      mounted.current && currentScope.current === scope && generation.current === run;
    try {
      const tasks = await load();
      if (current()) setSnapshot({ scope, status: 'ready', tasks });
    } catch {
      if (current()) setSnapshot({ scope, status: 'error', tasks: [] });
    }
  }, [load, scope]);

  return {
    tasks: snapshot.scope === scope ? snapshot.tasks : [],
    status: snapshot.scope === scope ? snapshot.status : ('loading' as DashboardTaskStatus),
    refresh,
  };
}
