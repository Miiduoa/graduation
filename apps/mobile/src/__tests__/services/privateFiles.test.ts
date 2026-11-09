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

test('does not call the network when R2 is not enabled', async () => {
  delete process.env.EXPO_PUBLIC_FILE_STORAGE_BACKEND;
  const fetchMock = jest.fn();
  global.fetch = fetchMock as typeof fetch;
  const { downloadPrivateFile, uploadPrivateFile, isR2FileStorageEnabled, PrivateFileStorageUnconfiguredError } =
    load();
  expect(isR2FileStorageEnabled()).toBe(false);
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

test('uploads through a presigned nuni.tw ticket when R2 is enabled', async () => {
  process.env.EXPO_PUBLIC_FILE_STORAGE_BACKEND = 'r2';
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
