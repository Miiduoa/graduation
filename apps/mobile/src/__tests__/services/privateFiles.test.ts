const mockCurrentUser = { uid: 'alice', getIdToken: jest.fn(async () => 'alice-token') };
let mockFirebaseConfigured = true;

jest.mock('../../firebase', () => ({
  getAuthInstance: () => ({ currentUser: mockCurrentUser }),
  hasUsableFirebaseConfig: () => mockFirebaseConfigured,
}));

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  mockFirebaseConfigured = true;
  jest.restoreAllMocks();
});

function load() {
  let mod: typeof import('../../services/privateFiles');
  jest.isolateModules(() => {
    mod = require('../../services/privateFiles');
  });
  return mod!;
}

test('does not call the network when Supabase is not enabled', async () => {
  delete process.env.EXPO_PUBLIC_FILE_STORAGE_BACKEND;
  const fetchMock = jest.fn();
  global.fetch = fetchMock as typeof fetch;
  const { downloadPrivateFile, uploadPrivateFile, isSupabaseFileStorageEnabled, PrivateFileStorageUnconfiguredError } =
    load();
  expect(isSupabaseFileStorageEnabled()).toBe(false);
  await expect(downloadPrivateFile('groups/course/posts/one/notes.pdf')).rejects.toBeInstanceOf(
    PrivateFileStorageUnconfiguredError,
  );
  await expect(
    uploadPrivateFile({
      path: 'assignments/work/submissions/alice/answer.pdf',
      body: new Uint8Array([1, 2, 3]),
      contentType: 'application/pdf',
    }),
  ).rejects.toBeInstanceOf(PrivateFileStorageUnconfiguredError);
  expect(fetchMock).not.toHaveBeenCalled();
});

test('uploads through a presigned nuni.tw ticket when Supabase is enabled', async () => {
  process.env.EXPO_PUBLIC_FILE_STORAGE_BACKEND = 'supabase';
  const fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === 'https://nuni.tw/api/files/private') {
      expect(init?.headers).toMatchObject({ Authorization: 'Bearer alice-token' });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          path: 'assignments/work/submissions/alice/answer.pdf',
          url: 'http://127.0.0.1/object',
          method: 'PUT',
          headers: { 'content-type': 'application/pdf' },
          expiresAt: '2026-11-09T00:00:00.000Z',
          maxBytes: 50 * 1024 * 1024,
        }),
      };
    }
    expect(url).toBe('http://127.0.0.1/object');
    return { ok: true, status: 200, json: async () => ({}) };
  });
  global.fetch = fetchMock as typeof fetch;
  const { uploadPrivateFile } = load();
  await expect(
    uploadPrivateFile({
      path: 'assignments/work/submissions/alice/answer.pdf',
      body: new Uint8Array([1, 2, 3, 4]),
      contentType: 'application/pdf',
    }),
  ).resolves.toEqual({ path: 'assignments/work/submissions/alice/answer.pdf' });
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

test('surfaces 429 with a Chinese message without automatic retries', async () => {
  process.env.EXPO_PUBLIC_FILE_STORAGE_BACKEND = 'supabase';
  const fetchMock = jest.fn(async () => ({ ok: false, status: 429, json: async () => ({ error: 'Too many uploads' }) }));
  global.fetch = fetchMock as unknown as typeof fetch;
  await expect(load().uploadPrivateFile({ path: 'groups/course/assignments/work/submissions/alice/answer.pdf', body: new Uint8Array([1]), contentType: 'application/pdf' })).rejects.toMatchObject({ statusCode: 429, message: '上傳太頻繁，請稍後再試' });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it.each(['r2', '', 'firebase'])('rejects unsupported backend %s', (backend) => {
  expect(load().isSupabaseFileStorageEnabled(backend)).toBe(false);
});

it.each([200, 400, 413, 429, 503, 'invalid', 'network'])('waits for finalize and handles result %s', async (result) => {
  process.env.EXPO_PUBLIC_FILE_STORAGE_BACKEND = 'supabase';
  const path = 'groups/course/cover.12345678-1234-1234-1234-123456789abc.png';
  const body = new Uint8Array([1]);
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => { finish = resolve; });
  const fetchMock = jest.fn()
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ path, url: 'https://storage.example/upload', method: 'POST', headers: { 'content-type': 'image/png', 'x-upsert': 'false' }, expiresAt: 'later', requiresFinalize: true }) })
    .mockResolvedValueOnce({ ok: true, status: 200 })
    .mockImplementationOnce(async () => {
      await pending;
      if (result === 'network') throw new TypeError('offline');
      return { ok: result === 200 || result === 'invalid', status: typeof result === 'number' ? result : 200, json: async () => result === 'invalid' ? { path, finalized: false } : { path, finalized: true, error: 'rejected' } };
    });
  global.fetch = fetchMock as typeof fetch;
  let settled = false;
  const upload = load().uploadPrivateFile({ path: 'groups/course/cover.png', body, contentType: 'image/png' });
  void upload.then(() => { settled = true; }, () => { settled = true; });
  for (let i = 0; i < 20 && fetchMock.mock.calls.length < 3; i++) await Promise.resolve();
  expect(fetchMock).toHaveBeenNthCalledWith(2, 'https://storage.example/upload', { method: 'POST', headers: { 'content-type': 'image/png', 'x-upsert': 'false' }, body });
  expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({ action: 'finalize', path });
  expect(settled).toBe(false);
  finish();
  if (result === 200) await expect(upload).resolves.toEqual({ path });
  else if (typeof result === 'number') await expect(upload).rejects.toMatchObject({ statusCode: result, source: 'api', ...(result === 429 ? { message: '上傳太頻繁，請稍後再試' } : {}) });
  else await expect(upload).rejects.toThrow();
  expect(fetchMock).toHaveBeenCalledTimes(3);
});

it.each([412, 429])('does not finalize a failed object upload %s', async (status) => {
  process.env.EXPO_PUBLIC_FILE_STORAGE_BACKEND = 'supabase';
  const fetchMock = jest.fn()
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ path: 'groups/g/cover.png', url: 'https://storage.example/upload', method: 'PUT', headers: {}, expiresAt: 'later', requiresFinalize: true }) })
    .mockResolvedValueOnce({ ok: false, status });
  global.fetch = fetchMock as typeof fetch;
  await expect(load().uploadPrivateFile({ path: 'groups/g/cover.png', body: new Uint8Array([1]), contentType: 'image/png' })).rejects.toThrow(status === 412 ? 'File already exists or changed' : '上傳太頻繁，請稍後再試');
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
