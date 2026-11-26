import { StackActions } from '@react-navigation/native';
import { useEffect, useRef } from 'react';
import type { safeNavigate } from '../utils/safeNavigate';

type Navigation = NonNullable<Parameters<typeof safeNavigate>[0]> & {
  dispatch?: (action: ReturnType<typeof StackActions.pop> & { target?: string; source?: string }) => void;
};
type State = {
  key: string;
  type: string;
  index: number;
  routes: Array<{ key: string; name: string }>;
};
type Anchor = { navigation: Navigation; stateKey: string; routeKey: string; routeName: string };
export type AssistantContinuation = {
  owner: object;
  rootKey: string;
  sourceRouteKey: string;
  isCurrent: () => boolean;
  resume: () => boolean;
};

let continuation: AssistantContinuation | null = null;
const listeners = new Set<() => void>();
export const getAssistantContinuation = () => continuation;
export const subscribeAssistantContinuation = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
function publish(next: AssistantContinuation | null) {
  continuation = next;
  for (const listener of listeners) listener();
}
export function dismissAssistantContinuation(expected?: AssistantContinuation) {
  if (!expected || continuation === expected) publish(null);
}

function stateOf(navigation: Navigation): State | null {
  const state = navigation.getState?.() as Partial<State> | undefined;
  return state?.key && Array.isArray(state.routes) && typeof state.index === 'number'
    ? state as State : null;
}

/** Navigation-only return address: no question, credentials or write action is stored. */
function capture(navigation: Navigation, owner: object, current: () => boolean): AssistantContinuation | null {
  const anchors: Anchor[] = [];
  let cursor: Navigation | undefined = navigation;
  for (let depth = 0; cursor && depth < 8; depth += 1) {
    const state = stateOf(cursor);
    const route = state?.routes[state.index];
    if (!state || !route?.key || !route.name) return null;
    anchors.push({ navigation: cursor, stateKey: state.key, routeKey: route.key, routeName: route.name });
    cursor = cursor.getParent?.() as Navigation | undefined;
  }
  if (!anchors.length || cursor) return null;
  const isCurrent = () => current() && anchors.every((anchor) => {
    const state = stateOf(anchor.navigation);
    return state?.key === anchor.stateKey && state.routes.some((route) => route.key === anchor.routeKey);
  });
  const ticket: AssistantContinuation = {
    owner, rootKey: anchors[anchors.length - 1].stateKey, sourceRouteKey: anchors[0].routeKey,
    isCurrent,
    resume: () => {
      if (continuation !== ticket || !isCurrent()) { dismissAssistantContinuation(ticket); return false; }
      // Focus ancestor tabs first, then pop only screens above the exact source.
      // Existing destination stacks and source route params remain unchanged.
      for (const anchor of [...anchors].reverse()) {
        const state = stateOf(anchor.navigation);
        const index = state?.routes.findIndex((route) => route.key === anchor.routeKey) ?? -1;
        if (!state || index < 0 || !current()) { dismissAssistantContinuation(ticket); return false; }
        if (state.type === 'stack') {
          const count = state.index - index;
          if (count < 0 || (count > 0 && !anchor.navigation.dispatch)) {
            dismissAssistantContinuation(ticket);
            return false;
          }
          if (count > 0) anchor.navigation.dispatch!({ ...StackActions.pop(count), target: state.key,
            source: state.routes[state.index].key });
        } else if (state.index !== index) {
          anchor.navigation.navigate?.(anchor.routeName);
        }
      }
      dismissAssistantContinuation(ticket);
      return true;
    },
  };
  return ticket;
}

/** The source component owns the ticket; scope remounts and unmounts revoke it. */
export function useAssistantContinuation(
  navigation: Parameters<typeof safeNavigate>[0],
  isCurrent: () => boolean,
) {
  const owner = useRef({});
  const mounted = useRef(true);
  useEffect(() => {
    const currentOwner = owner.current;
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (continuation?.owner === currentOwner) dismissAssistantContinuation(continuation);
    };
  }, []);
  useEffect(() => {
    if (continuation?.owner === owner.current && !continuation.isCurrent()) dismissAssistantContinuation(continuation);
  });
  return (open: () => boolean) => {
    if (!mounted.current || !isCurrent()) return false;
    const ticket = navigation ? capture(navigation as Navigation, owner.current,
      () => mounted.current && isCurrent()) : null;
    const opened = open();
    if (opened) publish(ticket?.isCurrent() ? ticket : null);
    return opened;
  };
}
