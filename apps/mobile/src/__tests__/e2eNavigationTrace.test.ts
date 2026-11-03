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

test('scroll and target observations retain only bounded numbers and fixed target labels', () => {
  traceNavigation('scroll-end', 'LoginLanding', undefined, undefined, {
    scroll: {
      offsetY: -12.5,
      viewportHeight: 874,
      contentHeight: 2000,
      nativeTimestamp: 1234.25,
      token: 'private fixture',
    },
  });
  traceNavigation('target-measure', 'LoginLanding', undefined, undefined, {
    target: {
      name: 'google-heading',
      trigger: 'scroll-end',
      requestedAt: 100,
      x: 47,
      y: 347,
      width: 308,
      height: 26,
      text: 'private fixture',
    },
  });
  expect(scope.__e2eNavTrace).toEqual([
    expect.objectContaining({
      scroll: {
        offsetY: -12.5,
        viewportHeight: 874,
        contentHeight: 2000,
        nativeTimestamp: 1234.25,
      },
    }),
    expect.objectContaining({
      target: {
        name: 'google-heading',
        trigger: 'scroll-end',
        requestedAt: 100,
        x: 47,
        y: 347,
        width: 308,
        height: 26,
      },
    }),
  ]);
  expect(JSON.stringify((console.info as jest.Mock).mock.calls)).not.toContain('private fixture');
});

test('invalid geometry and event or route mismatches never expose arbitrary values', () => {
  const privateValue = 'private fixture';
  traceNavigation('scroll-offset', 'LoginLanding', undefined, undefined, {
    scroll: {
      offsetY: Infinity,
      viewportHeight: -1,
      contentHeight: privateValue,
      nativeTimestamp: NaN,
    },
    target: { name: privateValue, trigger: privateValue },
  });
  traceNavigation('target-measure', 'LoginLanding', undefined, undefined, {
    target: {
      name: 'login-start',
      trigger: 'layout',
      requestedAt: 1.5,
      x: 100001,
      y: privateValue,
    },
  });
  traceNavigation('target-measure', 'LoginLanding', undefined, undefined, {
    target: { name: privateValue, trigger: 'layout' },
  });
  traceNavigation('press', 'LoginLanding', undefined, undefined, { scroll: { offsetY: 10 } });
  traceNavigation('scroll-end', 'NuniWorkspace', undefined, undefined, { scroll: { offsetY: 10 } });
  expect(scope.__e2eNavTrace).toEqual([
    expect.objectContaining({ scroll: {} }),
    expect.objectContaining({ target: { name: 'login-start', trigger: 'layout' } }),
    expect.not.objectContaining({ target: expect.anything() }),
    expect.not.objectContaining({ scroll: expect.anything() }),
    expect.not.objectContaining({ scroll: expect.anything() }),
  ]);
  expect(JSON.stringify((console.info as jest.Mock).mock.calls)).not.toContain(privateValue);
});
