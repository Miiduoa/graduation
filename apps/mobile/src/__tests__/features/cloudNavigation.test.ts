import { randomUUID } from 'expo-crypto';
import { httpsCallable } from 'firebase/functions';
import { getAuthInstance, getFunctionsInstance, isFirebaseMockMode } from '../../firebase';
import {
  getCloudNavigationPreview,
  runCloudNavigationTask,
  createCloudNavigationRequestId,
} from '../../features/cloudNavigation';

jest.mock('expo-crypto', () => ({ randomUUID: jest.fn() }));
jest.mock('firebase/functions', () => ({ httpsCallable: jest.fn() }));
jest.mock('../../firebase', () => ({
  getAuthInstance: jest.fn(),
  getFunctionsInstance: jest.fn(),
  isFirebaseMockMode: jest.fn(),
}));
const call = jest.fn();
let uid: string | null;
let current: boolean;
const input = () => ({
  scope: { uid: 'alice', schoolId: 'pu' },
  query: '從圖書館到活動中心',
  isCurrent: () => current,
});
const execute = () => ({
  ...input(),
  requestId: 'request-one',
  consent: {
    provider: 'groq' as const,
    version: 1 as const,
    schoolId: 'pu',
    query: input().query,
    fingerprint: 'a'.repeat(64),
  },
});
const common = {
  provider: 'groq',
  model: 'openai/gpt-oss-120b',
  schoolId: 'pu',
  checkedAt: '2026-11-01T15:00:00.000Z',
  sourceUpdatedAt: null,
};
const preview = {
  ...common,
  status: 'preview',
  query: input().query,
  fingerprint: 'a'.repeat(64),
  cloudReady: true,
  places: [
    { ref: 'p0', name: '圖書館', category: '圖書館', aliases: ['總圖'] },
    { ref: 'p1', name: '活動中心', category: '', aliases: [] },
  ],
};
const completed = {
  ...common,
  status: 'completed',
  route: {
    from: { id: 'library', schoolId: 'pu', name: '圖書館', lat: 24, lng: 120 },
    to: { id: 'hall', schoolId: 'pu', name: '活動中心', lat: 24.1, lng: 120.1 },
    navigationUrl:
      'https://www.google.com/maps/dir/?api=1&origin=24%2C120&destination=24.1%2C120.1&travelmode=walking',
  },
};
const failure = {
  status: 'unavailable',
  provider: 'groq',
  schoolId: 'pu',
  checkedAt: common.checkedAt,
  reason: 'rate_limited',
  retryAfterSeconds: 60,
};
const uuid = 'b1cb4a9f-bc21-4321-8dee-594a6c0ab032';
function deferred() {
  let resolve!: (value: { data: unknown }) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<{ data: unknown }>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
beforeEach(() => {
  jest.clearAllMocks();
  call.mockReset();
  uid = 'alice';
  current = true;
  jest
    .mocked(getAuthInstance)
    .mockImplementation(() => ({ currentUser: uid ? { uid } : null }) as never);
  jest.mocked(getFunctionsInstance).mockReturnValue('functions' as never);
  jest.mocked(isFirebaseMockMode).mockReturnValue(false);
  jest.mocked(httpsCallable).mockReturnValue(call);
  jest.mocked(randomUUID).mockReturnValue(uuid);
});
it('uses the existing callable and sends only public preview fields', async () => {
  call.mockResolvedValue({ data: { ...preview, privateProfile: 'discarded' } });
  await expect(
    getCloudNavigationPreview({
      ...input(),
      displayName: 'private',
      history: ['private'],
    } as never),
  ).resolves.toEqual(preview);
  expect(httpsCallable).toHaveBeenCalledWith('functions', 'askCampusAssistant');
  expect(call).toHaveBeenCalledTimes(1);
  expect(call).toHaveBeenCalledWith({
    task: 'public-campus-navigation',
    phase: 'preview',
    schoolId: 'pu',
    query: input().query,
  });
});
it('projects exact consent and accepts only the verified canonical walking receipt', async () => {
  call.mockResolvedValue({ data: completed });
  const request = execute();
  await expect(
    runCloudNavigationTask({
      ...request,
      consent: { ...request.consent, snapshot: 'private', uid: 'alice' },
    } as never),
  ).resolves.toEqual(completed);
  expect(call).toHaveBeenCalledWith({
    task: 'public-campus-navigation',
    phase: 'execute',
    schoolId: 'pu',
    query: request.query,
    requestId: request.requestId,
    consent: request.consent,
  });
});
it.each([
  undefined,
  null,
  {},
  { ...execute().consent, provider: 'ollama' },
  { ...execute().consent, version: 2 },
  { ...execute().consent, schoolId: 'other' },
  { ...execute().consent, query: '其他輸入' },
  { ...execute().consent, fingerprint: 'A'.repeat(64) },
  { ...execute().consent, fingerprint: 'not-a-digest' },
])('rejects missing or changed consent before dispatch %#', async (consent) => {
  await expect(runCloudNavigationTask({ ...execute(), consent } as never)).rejects.toMatchObject({
    code: 'invalid-response',
  });
  expect(call).not.toHaveBeenCalled();
});
it.each(['', 'short', '../request', 'a'.repeat(101)])(
  'rejects malformed request IDs %s',
  async (requestId) => {
    await expect(runCloudNavigationTask({ ...execute(), requestId })).rejects.toMatchObject({
      code: 'invalid-response',
    });
    expect(call).not.toHaveBeenCalled();
  },
);
it.each([
  { ...input(), query: '' },
  { ...input(), query: ' x ' },
  { ...input(), query: 'x'.repeat(241) },
  { ...input(), scope: { uid: 'alice', schoolId: '' } },
  { ...input(), scope: { uid: 'alice', schoolId: 'x'.repeat(41) } },
  { ...input(), scope: { uid: 'alice', schoolId: '../pu' } },
])('rejects malformed input without silently changing the disclosed data %#', async (request) => {
  await expect(getCloudNavigationPreview(request)).rejects.toMatchObject({
    code: 'invalid-response',
  });
  expect(call).not.toHaveBeenCalled();
});
it.each([
  { ...preview, provider: 'ollama' },
  { ...preview, model: 'paid-model' },
  { ...preview, schoolId: 'other' },
  { ...preview, query: '其他輸入' },
  { ...preview, checkedAt: 'today' },
  { ...preview, checkedAt: '2026-02-30T15:00:00.000Z' },
  { ...preview, sourceUpdatedAt: undefined },
  { ...preview, sourceUpdatedAt: 'unknown' },
  { ...preview, fingerprint: '' },
  { ...preview, cloudReady: 'true' },
  { ...preview, places: [] },
  { ...preview, places: [preview.places[0]] },
  {
    ...preview,
    places: Array.from({ length: 41 }, (_, index) => ({ ...preview.places[0], ref: `p${index}` })),
  },
  { ...preview, places: [preview.places[0], preview.places[0]] },
  { ...preview, places: [{ ...preview.places[0], ref: 'p00' }, preview.places[1]] },
  { ...preview, places: [{ ...preview.places[0], ref: 'p40' }, preview.places[1]] },
  ...['', 'x'.repeat(81)].map((name) => ({
    ...preview,
    places: [{ ...preview.places[0], name }, preview.places[1]],
  })),
  { ...preview, places: [{ ...preview.places[0], category: 'x'.repeat(41) }, preview.places[1]] },
  { ...preview, places: [{ ...preview.places[0], aliases: ['x'.repeat(61)] }, preview.places[1]] },
  {
    ...preview,
    places: [{ ...preview.places[0], aliases: Array(7).fill('x') }, preview.places[1]],
  },
  { ...preview, actions: [{ toolName: 'pay' }] },
  completed,
])('rejects an untrusted preview %#', async (data) => {
  call.mockResolvedValue({ data });
  await expect(getCloudNavigationPreview(input())).rejects.toMatchObject({
    code: 'invalid-response',
  });
});
it.each([
  'https://evil.test',
  'javascript:alert(1)',
  completed.route.navigationUrl + '#fragment',
  completed.route.navigationUrl + '&origin=25%2C121',
  completed.route.navigationUrl.replace('www.google.com', 'www.google.com:443'),
  completed.route.navigationUrl.replace('www.google.com', 'alice@www.google.com'),
  completed.route.navigationUrl.replace('https:', 'http:'),
  completed.route.navigationUrl.replace('%2C', ','),
  completed.route.navigationUrl.replace('api=1&origin=24%2C120', 'origin=24%2C120&api=1'),
  completed.route.navigationUrl.replace('walking', 'driving'),
])('rejects every noncanonical external navigation URL %#', async (navigationUrl) => {
  call.mockResolvedValue({ data: { ...completed, route: { ...completed.route, navigationUrl } } });
  await expect(runCloudNavigationTask(execute())).rejects.toMatchObject({
    code: 'invalid-response',
  });
});
it.each([
  { schoolId: 'other' },
  { id: 'hall' },
  { id: '' },
  { id: '../library' },
  { id: 'x'.repeat(129) },
  { name: '' },
  { name: 'x'.repeat(241) },
  { lat: NaN },
  { lat: Infinity },
  { lat: 91 },
  { lng: -181 },
  { lng: '120' },
])('rejects invalid or cross-campus route places %#', async (fields) => {
  call.mockResolvedValue({
    data: {
      ...completed,
      route: { ...completed.route, from: { ...completed.route.from, ...fields } },
    },
  });
  await expect(runCloudNavigationTask(execute())).rejects.toMatchObject({
    code: 'invalid-response',
  });
});
it('projects only receipt fields and does not depend on URL/URLSearchParams globals', async () => {
  call.mockResolvedValue({
    data: {
      ...completed,
      route: { ...completed.route, from: { ...completed.route.from, privateField: 'discarded' } },
    },
  });
  const oldUrl = global.URL;
  const oldParams = global.URLSearchParams;
  try {
    global.URL = undefined as unknown as typeof URL;
    global.URLSearchParams = undefined as unknown as typeof URLSearchParams;
    await expect(runCloudNavigationTask(execute())).resolves.toEqual(completed);
  } finally {
    global.URL = oldUrl;
    global.URLSearchParams = oldParams;
  }
});
it('keeps truthful quota failure without manufacturing a route or retrying', async () => {
  call.mockResolvedValue({ data: failure });
  await expect(runCloudNavigationTask(execute())).resolves.toEqual(failure);
  expect(call).toHaveBeenCalledTimes(1);
});
it.each([
  { ...failure, reason: 'paid_fallback' },
  { ...failure, provider: 'gemini' },
  { ...failure, model: 'paid-model' },
  { ...failure, schoolId: 'other' },
  { ...failure, checkedAt: 'today' },
  ...[0, -1, 1.5, 61, Infinity].map((retryAfterSeconds) => ({ ...failure, retryAfterSeconds })),
])('rejects malformed failure metadata %#', async (data) => {
  call.mockResolvedValue({ data });
  await expect(runCloudNavigationTask(execute())).rejects.toMatchObject({
    code: 'invalid-response',
  });
});
it('does not fall back when Firebase is in mock mode', async () => {
  jest.mocked(isFirebaseMockMode).mockReturnValue(true);
  await expect(getCloudNavigationPreview(input())).rejects.toMatchObject({ code: 'unconfigured' });
  expect(call).not.toHaveBeenCalled();
});
it.each(['bob', null])(
  'requires the current authenticated UID before dispatch %s',
  async (nextUid) => {
    uid = nextUid;
    await expect(getCloudNavigationPreview(input())).rejects.toMatchObject({
      code: 'session-changed',
    });
    expect(call).not.toHaveBeenCalled();
  },
);
it('invalidates A→B→A when the owning context generation has changed', async () => {
  const d = deferred();
  call.mockReturnValue(d.promise);
  const pending = runCloudNavigationTask(execute());
  await Promise.resolve();
  uid = 'bob';
  current = false;
  uid = 'alice';
  d.resolve({ data: completed });
  await expect(pending).rejects.toMatchObject({ code: 'session-changed' });
});
it('discards both success and failure after a campus/account scope change', async () => {
  for (const reject of [false, true]) {
    current = true;
    const d = deferred();
    call.mockReturnValue(d.promise);
    const pending = getCloudNavigationPreview(input());
    await Promise.resolve();
    current = false;
    if (reject) d.reject(new Error('server-error'));
    else d.resolve({ data: preview });
    await expect(pending).rejects.toMatchObject({ code: 'session-changed' });
  }
});
it('captures the original scope/query/consent instead of retaining mutable caller data', async () => {
  const d = deferred();
  call.mockReturnValue(d.promise);
  const request = execute();
  const pending = runCloudNavigationTask(request);
  request.scope.schoolId = 'other';
  request.query = 'new';
  request.consent.query = 'new';
  request.consent.fingerprint = 'b'.repeat(64);
  await Promise.resolve();
  expect(call.mock.calls[0][0]).toEqual({
    task: 'public-campus-navigation',
    phase: 'execute',
    schoolId: 'pu',
    query: input().query,
    requestId: 'request-one',
    consent: execute().consent,
  });
  d.resolve({ data: completed });
  await expect(pending).resolves.toEqual(completed);
});
it('rechecks invalidation immediately before the deferred dispatch', async () => {
  const pending = getCloudNavigationPreview(input());
  current = false;
  await expect(pending).rejects.toMatchObject({ code: 'session-changed' });
  expect(call).not.toHaveBeenCalled();
});
it('rechecks scope after parsing before returning the result', async () => {
  const data = { ...preview };
  Object.defineProperty(data, 'fingerprint', {
    get() {
      current = false;
      return preview.fingerprint;
    },
  });
  call.mockResolvedValue({ data });
  await expect(getCloudNavigationPreview(input())).rejects.toMatchObject({
    code: 'session-changed',
  });
});
it('stops waiting on cancel and ignores a late result without DOMException', async () => {
  const d = deferred();
  call.mockReturnValue(d.promise);
  const controller = new AbortController();
  const old = global.DOMException;
  try {
    global.DOMException = undefined as unknown as typeof DOMException;
    const pending = runCloudNavigationTask(execute(), controller.signal);
    await Promise.resolve();
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    d.resolve({ data: completed });
    await Promise.resolve();
  } finally {
    global.DOMException = old;
  }
});
it('does not dispatch when canceled before or during listener registration', async () => {
  const pre = new AbortController();
  pre.abort();
  await expect(getCloudNavigationPreview(input(), pre.signal)).rejects.toMatchObject({
    name: 'AbortError',
  });
  const during = new AbortController();
  const original = during.signal.addEventListener.bind(during.signal);
  jest.spyOn(during.signal, 'addEventListener').mockImplementation((type, listener, options) => {
    original(type, listener, options);
    during.abort();
  });
  await expect(getCloudNavigationPreview(input(), during.signal)).rejects.toMatchObject({
    name: 'AbortError',
  });
  expect(call).not.toHaveBeenCalled();
});
it('removes abort listeners after completion', async () => {
  call.mockResolvedValue({ data: preview });
  const controller = new AbortController();
  const remove = jest.spyOn(controller.signal, 'removeEventListener');
  await getCloudNavigationPreview(input(), controller.signal);
  expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
});
it('generates request IDs only with secure native randomness', () => {
  expect(createCloudNavigationRequestId()).toBe(uuid);
  expect(randomUUID).toHaveBeenCalledTimes(1);
});
it.each(['', 'weak-id', 'a'.repeat(36)])(
  'rejects invalid native UUID output without fallback %s',
  (id) => {
    jest.mocked(randomUUID).mockReturnValue(id);
    expect(createCloudNavigationRequestId).toThrow(
      expect.objectContaining({ code: 'invalid-response' }),
    );
  },
);
it('propagates unavailable secure randomness without trying Math.random', () => {
  jest.mocked(randomUUID).mockImplementation(() => {
    throw new Error('native-crypto-unavailable');
  });
  const weak = jest.spyOn(Math, 'random');
  expect(createCloudNavigationRequestId).toThrow('native-crypto-unavailable');
  expect(weak).not.toHaveBeenCalled();
  weak.mockRestore();
});
