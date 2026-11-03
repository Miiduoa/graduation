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
  scroll?: Record<string, number>;
  target?: { name: string; trigger: string } & Record<string, string | number>;
};

export type ScrollTraceEvent =
  | 'scroll-begin'
  | 'scroll-end'
  | 'momentum-begin'
  | 'momentum-end'
  | 'scroll-offset';
export type TargetTraceTrigger = Exclude<ScrollTraceEvent, 'scroll-offset'> | 'layout';

export function isE2eNavigationTraceEnabled() {
  return __DEV__ && process.env.EXPO_PUBLIC_E2E_NAV_TRACE === '1';
}

function numericFields(value: object, limits: Record<string, [number, number]>) {
  const input = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(limits).flatMap(([key, [min, max]]) => {
      const number = input[key];
      return typeof number === 'number' && Number.isFinite(number) && number >= min && number <= max
        ? [[key, number]]
        : [];
    }),
  );
}

function observation(event: string, route: string, value: unknown) {
  if (route !== 'LoginLanding' || !value || typeof value !== 'object') return {};
  const input = value as { scroll?: unknown; target?: unknown };
  if (
    ['scroll-begin', 'scroll-end', 'momentum-begin', 'momentum-end', 'scroll-offset'].includes(
      event,
    ) &&
    input.scroll &&
    typeof input.scroll === 'object'
  ) {
    return {
      scroll: numericFields(input.scroll, {
        offsetY: [-100_000, 100_000],
        viewportHeight: [0, 100_000],
        contentHeight: [0, 100_000],
        nativeTimestamp: [0, Number.MAX_SAFE_INTEGER],
      }),
    };
  }
  if (event === 'target-measure' && input.target && typeof input.target === 'object') {
    const target = input.target as { name?: unknown; trigger?: unknown; requestedAt?: unknown };
    if (
      typeof target.name === 'string' &&
      ['google-heading', 'login-start'].includes(target.name) &&
      typeof target.trigger === 'string' &&
      ['layout', 'scroll-begin', 'scroll-end', 'momentum-begin', 'momentum-end'].includes(
        target.trigger,
      )
    ) {
      return {
        target: {
          name: target.name,
          trigger: target.trigger,
          ...numericFields(target, {
            x: [-100_000, 100_000],
            y: [-100_000, 100_000],
            width: [0, 100_000],
            height: [0, 100_000],
          }),
          ...(typeof target.requestedAt === 'number' &&
          Number.isSafeInteger(target.requestedAt) &&
          target.requestedAt >= 0
            ? { requestedAt: target.requestedAt }
            : {}),
        },
      };
    }
  }
  return {};
}

// Temporary test-build recorder: deliberately excludes route params and account data.
export function traceNavigation(
  event: string,
  route: string,
  dispatched?: boolean,
  state?: unknown,
  geometry?: unknown,
) {
  if (!isE2eNavigationTraceEnabled()) return;
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
    ...observation(event, route, geometry),
  };
  const scope = globalThis as typeof globalThis & { __e2eNavTrace?: Entry[] };
  scope.__e2eNavTrace ??= [];
  scope.__e2eNavTrace.push(entry);
  if (scope.__e2eNavTrace.length > 2000) scope.__e2eNavTrace.shift();
  console.info('[e2e-nav]', JSON.stringify(entry));
}
