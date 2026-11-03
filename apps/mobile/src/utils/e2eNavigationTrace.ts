type Snapshot = {
  index?: number;
  routeNames?: string[];
  routes?: { name: string; state?: Snapshot }[];
};

function snapshot(value: unknown, depth = 0): Snapshot | undefined {
  if (!value || typeof value !== 'object' || depth > 3) return undefined;
  const state = value as { index?: unknown; routeNames?: unknown; routes?: unknown };
  return {
    index: typeof state.index === 'number' ? state.index : undefined,
    routeNames: Array.isArray(state.routeNames)
      ? state.routeNames.filter((name): name is string => typeof name === 'string').slice(0, 40)
      : undefined,
    routes: Array.isArray(state.routes)
      ? state.routes.slice(0, 40).flatMap((route: unknown) => {
          if (!route || typeof route !== 'object') return [];
          const item = route as { name?: unknown; state?: unknown };
          return typeof item.name === 'string'
            ? [{ name: item.name, state: snapshot(item.state, depth + 1) }]
            : [];
        })
      : undefined,
  };
}

let sequence = 0;
type Entry = {
  sequence: number;
  event: string;
  route: string;
  dispatched?: boolean;
  at: number;
  state?: Snapshot;
};

// Temporary test-build recorder: deliberately excludes route params and account data.
export function traceNavigation(
  event: string,
  route: string,
  dispatched?: boolean,
  state?: unknown,
) {
  if (!__DEV__ || process.env.EXPO_PUBLIC_E2E_NAV_TRACE !== '1') return;
  let observedState: unknown;
  try {
    observedState = typeof state === 'function' ? state() : state;
  } catch {
    observedState = undefined;
  }
  const entry: Entry = {
    sequence: ++sequence,
    event,
    route,
    dispatched,
    at: Date.now(),
    state: snapshot(observedState),
  };
  const scope = globalThis as typeof globalThis & { __e2eNavTrace?: Entry[] };
  scope.__e2eNavTrace ??= [];
  scope.__e2eNavTrace.push(entry);
  if (scope.__e2eNavTrace.length > 2000) scope.__e2eNavTrace.shift();
  console.info('[e2e-nav]', JSON.stringify(entry));
}
