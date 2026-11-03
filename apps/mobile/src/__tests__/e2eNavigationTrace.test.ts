import { traceNavigation } from '../utils/e2eNavigationTrace';

const scope = globalThis as typeof globalThis & { __e2eNavTrace?: unknown[]; __DEV__: boolean };
const originalDev = scope.__DEV__;
const originalFlag = process.env.EXPO_PUBLIC_E2E_NAV_TRACE;

beforeEach(() => {
  scope.__DEV__ = true;
  process.env.EXPO_PUBLIC_E2E_NAV_TRACE = '1';
  delete scope.__e2eNavTrace;
  jest.spyOn(console, 'info').mockImplementation(() => undefined);
});

afterEach(() => {
  scope.__DEV__ = originalDev;
  if (originalFlag === undefined) delete process.env.EXPO_PUBLIC_E2E_NAV_TRACE;
  else process.env.EXPO_PUBLIC_E2E_NAV_TRACE = originalFlag;
  delete scope.__e2eNavTrace;
  jest.restoreAllMocks();
});

test.each(['disabled flag', 'release build'])(
  '%s does not inspect or record navigation',
  (mode) => {
    if (mode === 'disabled flag') delete process.env.EXPO_PUBLIC_E2E_NAV_TRACE;
    else scope.__DEV__ = false;
    const readState = jest.fn();
    traceNavigation('press', 'NuniWorkspace', undefined, readState);
    expect(readState).not.toHaveBeenCalled();
    expect(scope.__e2eNavTrace).toBeUndefined();
    expect(console.info).not.toHaveBeenCalled();
  },
);

test('records only route names and index, excluding nested parameters and identity fields', () => {
  const privateValue = 'private fixture must be omitted';
  const readState = jest.fn(() => ({
    index: 1,
    routeNames: ['LoginLanding', 'NuniWorkspace'],
    account: privateValue,
    routes: [
      {
        name: 'NuniWorkspace',
        params: { context: privateValue },
        state: {
          index: 0,
          routes: [{ name: 'Account', params: { draft: privateValue } }],
        },
      },
    ],
  }));
  traceNavigation('dispatch-return', 'NuniWorkspace', true, readState);
  expect(readState).toHaveBeenCalledTimes(1);
  expect(scope.__e2eNavTrace).toEqual([
    expect.objectContaining({
      event: 'dispatch-return',
      route: 'NuniWorkspace',
      dispatched: true,
      state: expect.objectContaining({ index: 1, routeNames: ['LoginLanding', 'NuniWorkspace'] }),
    }),
  ]);
  expect(JSON.stringify(scope.__e2eNavTrace)).not.toContain(privateValue);
  expect(JSON.stringify((console.info as jest.Mock).mock.calls)).not.toContain(privateValue);
});

test('an unavailable diagnostic state reader does not throw into the real press handler', () => {
  expect(() =>
    traceNavigation('press', 'NuniWorkspace', undefined, () => {
      throw new Error('unavailable');
    }),
  ).not.toThrow();
  expect(scope.__e2eNavTrace).toEqual([
    expect.objectContaining({ event: 'press', state: undefined }),
  ]);
});

test('keeps a bounded recent event buffer with increasing sequence numbers', () => {
  for (let index = 0; index < 2001; index++) traceNavigation('focus', 'LoginLanding');
  expect(scope.__e2eNavTrace).toHaveLength(2000);
  const events = scope.__e2eNavTrace as { sequence: number }[];
  expect(events.at(-1)!.sequence - events[0].sequence).toBe(1999);
});
