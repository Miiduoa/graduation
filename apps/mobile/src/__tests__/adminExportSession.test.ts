import {
  AdminExportSession,
  assertExportStillCurrent,
} from '../services/adminExportSession';

function session(uid = 'admin', schoolId = 'school-a', allowed = true) {
  return new AdminExportSession({ uid, schoolId, allowed });
}

test('school change aborts in-flight export before deferred file/share success', async () => {
  const exportSession = session();
  const origin = exportSession.captureOrigin('A')!;
  const token = exportSession.begin('logs-full', origin)!;
  expect(token.captured.schoolId).toBe('school-a');

  let shared = false;
  let successAlert = false;
  const deferredShare = async () => {
    await Promise.resolve();
    assertExportStillCurrent(exportSession, token);
    shared = true;
    successAlert = true;
  };

  const pending = deferredShare().catch((error: unknown) => error);
  exportSession.setIdentity({ uid: 'admin', schoolId: 'school-b', allowed: true });
  const error = await pending;
  expect(error).toMatchObject({ name: 'AbortError' });
  expect(shared).toBe(false);
  expect(successAlert).toBe(false);
  expect(exportSession.isCurrent(token)).toBe(false);
});

test('stale origin cannot begin under a newer identity', () => {
  const exportSession = session();
  const stale = exportSession.captureOrigin('OLD')!;
  exportSession.setIdentity({ uid: 'admin', schoolId: 'school-b', allowed: true });
  expect(exportSession.begin('logs-loaded', stale)).toBeNull();
  const fresh = exportSession.captureOrigin('NEW')!;
  expect(exportSession.begin('logs-loaded', fresh)?.captured.schoolId).toBe('school-b');
});

test('role revocation and unmount invalidate exports without stale share', async () => {
  const exportSession = session();
  const origin = exportSession.captureOrigin('A')!;
  const token = exportSession.begin('logs-loaded', origin)!;
  const afterFile = async () => {
    await Promise.resolve();
    assertExportStillCurrent(exportSession, token);
    return 'shared';
  };

  exportSession.setIdentity({ uid: 'admin', schoolId: 'school-a', allowed: false });
  await expect(afterFile()).rejects.toMatchObject({ name: 'AbortError' });

  const again = session();
  const mountedOrigin = again.captureOrigin('A')!;
  const mountedToken = again.begin('announcements', mountedOrigin)!;
  again.unmount();
  expect(() => assertExportStillCurrent(again, mountedToken)).toThrow(
    expect.objectContaining({ name: 'AbortError' }),
  );
});

test('cancellation then retry does not let old finally clear the new controller', () => {
  const exportSession = session();
  const firstOrigin = exportSession.captureOrigin('A')!;
  const first = exportSession.begin('logs-full', firstOrigin)!;
  let firstBusy = true;
  const secondOrigin = exportSession.captureOrigin('A')!;
  const second = exportSession.begin('logs-full', secondOrigin)!;
  let secondBusy = true;

  expect(first.controller.signal.aborted).toBe(true);
  expect(exportSession.isCurrent(first)).toBe(false);
  expect(exportSession.isCurrent(second)).toBe(true);

  if (exportSession.end(first)) firstBusy = false;
  expect(firstBusy).toBe(true);
  expect(secondBusy).toBe(true);

  if (exportSession.end(second)) secondBusy = false;
  expect(secondBusy).toBe(false);
});

test('explicit cancel clears only that generation and blocks later share', async () => {
  const exportSession = session();
  const origin = exportSession.captureOrigin('A')!;
  const token = exportSession.begin('logs-full', origin)!;
  expect(exportSession.cancel('logs-full')).toBe(true);

  let shared = false;
  await expect(
    (async () => {
      await Promise.resolve();
      assertExportStillCurrent(exportSession, token);
      shared = true;
    })(),
  ).rejects.toMatchObject({ name: 'AbortError' });
  expect(shared).toBe(false);
  expect(exportSession.end(token)).toBe(false);
});

test('account switch after paged fetch prevents writing prior school actor rows', async () => {
  const exportSession = session('uid-1', 'school-old');
  const origin = exportSession.captureOrigin('OLD')!;
  const token = exportSession.begin('logs-full', origin)!;
  const rows = [
    {
      id: '1',
      action: 'update',
      actorEmail: 'old-actor@example.test',
      details: 'prior school secret',
    },
  ];

  let wroteCsv = false;
  let shared = false;
  const finish = async () => {
    await Promise.resolve(); // deferred final page
    assertExportStillCurrent(exportSession, token);
    wroteCsv = true;
    await Promise.resolve(); // file write
    assertExportStillCurrent(exportSession, token);
    await Promise.resolve(); // Sharing.isAvailableAsync
    assertExportStillCurrent(exportSession, token);
    shared = true;
    return rows;
  };

  const pending = finish().catch((error: unknown) => error);
  exportSession.setIdentity({ uid: 'uid-2', schoolId: 'school-new', allowed: true });
  const error = await pending;
  expect(error).toMatchObject({ name: 'AbortError' });
  expect(wroteCsv).toBe(false);
  expect(shared).toBe(false);
});
