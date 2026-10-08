import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useAuth } from '../state/auth';
import { useSchool } from '../state/school';
import { getThemeVersion, subscribeToTheme } from '../ui/theme';
import {
  loadCampusEventPage,
  type CampusEvent,
  type CampusEventCursor,
} from '../services/publicCampusContent';

type State = {
  scope: string;
  items: CampusEvent[];
  cursor: CampusEventCursor | null;
  loaded: boolean;
  loading: boolean;
  error: string;
  failedAction: 'refresh' | 'more';
};

export function useCampusEvents() {
  useSyncExternalStore(subscribeToTheme, getThemeVersion, getThemeVersion);
  const { user } = useAuth();
  const { school } = useSchool();
  const scope = JSON.stringify([user?.uid, school.id]);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const mounted = useRef(true);
  const activeRequest = useRef<{ scope: string; token: symbol } | null>(null);
  const [state, setState] = useState<State>({
    scope,
    items: [],
    cursor: null,
    loaded: false,
    loading: true,
    error: '',
    failedAction: 'refresh',
  });
  const latestState = useRef(state);
  latestState.current = state;
  const current = () => mounted.current && currentScope.current === scope;

  const load = useCallback(
    async (action: 'refresh' | 'more') => {
      if (
        !mounted.current ||
        currentScope.current !== scope ||
        activeRequest.current?.scope === scope
      )
        return;
      const previous = latestState.current.scope === scope ? latestState.current : null;
      if (action === 'more' && !previous?.cursor) return;
      const token = Symbol(action);
      activeRequest.current = { scope, token };
      const isCurrent = () =>
        mounted.current && currentScope.current === scope && activeRequest.current?.token === token;
      setState({
        scope,
        items: previous?.items ?? [],
        cursor: previous?.cursor ?? null,
        loaded: previous?.loaded ?? false,
        loading: true,
        error: '',
        failedAction: action,
      });
      try {
        const page = await loadCampusEventPage(
          school.id,
          action === 'more' ? previous!.cursor : null,
        );
        if (!isCurrent()) return;
        // A document may be edited between pages. Keep one row per source document.
        const items = new Map(
          (action === 'more' ? (previous?.items ?? []) : []).map((item) => [
            `${item.source}:${item.id}`,
            item,
          ]),
        );
        page.items.forEach((item) => items.set(`${item.source}:${item.id}`, item));
        setState({
          scope,
          items: Array.from(items.values()),
          cursor: page.nextCursor,
          loaded: true,
          loading: false,
          error: '',
          failedAction: action,
        });
      } catch {
        if (isCurrent())
          setState({
            scope,
            items: previous?.items ?? [],
            cursor: previous?.cursor ?? null,
            loaded: previous?.loaded ?? false,
            loading: false,
            error:
              action === 'more'
                ? '無法載入更多活動，已載入的資料仍保留。'
                : '無法更新活動，請確認網路連線後重試。',
            failedAction: action,
          });
      } finally {
        if (activeRequest.current?.token === token) activeRequest.current = null;
      }
    },
    [scope, school.id],
  );

  useEffect(() => {
    mounted.current = true;
    void load('refresh');
    return () => {
      mounted.current = false;
      if (activeRequest.current?.scope === scope) activeRequest.current = null;
    };
  }, [scope, load]);

  const visibleState =
    state.scope === scope
      ? state
      : {
          items: [],
          cursor: null,
          loading: true,
          loaded: false,
          error: '',
          failedAction: 'refresh' as const,
        };
  return {
    ...visibleState,
    current,
    reload: () => load('refresh'),
    loadMore: () => load('more'),
    retry: () => load(visibleState.failedAction),
  };
}
