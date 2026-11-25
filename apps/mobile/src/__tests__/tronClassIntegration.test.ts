import { NuniError } from '@campus/shared/src/nuni';
import type { NativeTronClassDownloadedFile, NativeTronClassSubmissionDownloadInput } from '../services/tronClassNativeDownload';
import {
  createNativeTronClassClient,
  parseNativeTronClassConnection,
  parseNativeTronClassPreparation,
  parseNativeTronClassPreparationCancellation,
  parseNativeTronClassResult,
  parseNativeTronClassSnapshot,
  nativeTronClassSubmissionDownloadTarget,
  safeTronClassSourceHref,
} from '../services/tronClassIntegration';
import {
  acknowledged,
  availability,
  connection,
  homework,
  operationId,
  preparation,
  revision,
  snapshot,
  stamp,
  submissionHistory,
} from './fixtures/tronClassIntegration';

const scope = { courseId: homework.courseId, homeworkId: homework.id, operationId };
it('does not dispatch an already cancelled native connection', async () => {
  const request = jest.fn();
  const client = createNativeTronClassClient({ owner: 'platform:a', isCurrent: () => true, request, upload: jest.fn() });
  const controller = new AbortController();
  controller.abort();
  await expect(client.connect('student', 'synthetic-password', null, controller.signal))
    .rejects.toMatchObject({ code: 'REQUEST_CANCELLED' });
  expect(request).not.toHaveBeenCalled();
});

it('passes native connection cancellation to transport and rejects a late success', async () => {
  let finish!: (value: unknown) => void;
  const pending = new Promise(resolve => { finish = resolve; });
  const request = jest.fn(() => pending);
  const client = createNativeTronClassClient({ owner: 'platform:a', isCurrent: () => true, request, upload: jest.fn() });
  const controller = new AbortController();
  const result = client.connect('student', 'synthetic-password', null, controller.signal);
  const rejected = expect(result).rejects.toMatchObject({ code: 'REQUEST_CANCELLED' });
  expect(request).toHaveBeenCalledWith({ action: 'connect', schoolId: 'pu', account: 'student',
    password: 'synthetic-password', expectedRevision: null }, controller.signal);
  controller.abort();
  finish(connection);
  await rejected;
});

it('keeps availability separate from nuni write permission and accepts older preparations without it', () => {
  expect(parseNativeTronClassPreparation({ ...preparation, availability }, scope))
    .toMatchObject({ availability, canSubmit: false });
  expect(parseNativeTronClassPreparation(preparation, scope)).not.toHaveProperty('availability');
});
it.each([
  { ...availability, courseId: 999 }, { ...availability, homeworkId: 999 },
  { ...availability, revision: 'b'.repeat(32) }, { ...availability, state: ['available'] },
  { ...availability, ordinary: { state: 'open', kind: 'first', remainingAttempts: 0 } },
  { ...availability, draft: { state: 'available', submissionId: '32', count: 2 } },
  { ...availability, upload_url: 'private-source-value' },
])('rejects malformed or crossed availability at the native preparation boundary', value => {
  expect(() => parseNativeTronClassPreparation({ ...preparation, availability: value }, scope)).toThrow('INVALID_RESPONSE');
});
it('loads an independently typed course picker using the same verified native identity', async () => {
  const index = { kind: 'course-index', revision, fetchedAt: stamp,
    courses: snapshot.courses.map(course => ({ ...course, href: `https://tronclass.pu.edu.tw/course/${course.id}/content` })),
    errors: [], partial: false };
  const request = jest.fn(async () => index);
  const client = createNativeTronClassClient({ owner: 'platform:a', isCurrent: () => true, request, upload: jest.fn() });
  expect(await client.courses(revision)).toEqual(index);
  expect(request).toHaveBeenCalledWith({ action: 'courses' });
  await expect(client.courses('b'.repeat(32))).rejects.toMatchObject({ code: 'TRONCLASS_BINDING_CHANGED' });
  request.mockResolvedValueOnce({ ...index, kind: 'snapshot' });
  await expect(client.courses(revision)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
});

it('does not return course choices after the native owner changes during the read', async () => {
  let current = true;
  const client = createNativeTronClassClient({ owner: 'platform:a', isCurrent: () => current,
    request: async () => { current = false; return { kind: 'course-index', revision, fetchedAt: stamp, courses: [], errors: [], partial: false }; },
    upload: jest.fn() });
  await expect(client.courses(revision)).rejects.toMatchObject({ code: 'SESSION_CHANGED' });
});

it('parses partial school observations without changing an unknown submission into false', () => {
  const parsed = parseNativeTronClassSnapshot({
    ...snapshot,
    partial: true,
    errors: [{ courseId: 10, area: 'materials', message: '暫時無法讀取教材。' }],
  });
  expect(parsed.partial).toBe(true);
  expect(parsed.homework[0].submitted).toBeNull();
});
it('rejects a JSON array error area instead of assigning it a partial-result category', () => {
  expect(() => parseNativeTronClassSnapshot({ ...snapshot, partial: true,
    errors: [{ courseId: 10, area: ['homework'], message: '暫時無法讀取作業。' }],
  })).toThrow('INVALID_RESPONSE');
});
it.each([
  ['submissionType', ['individual']],
  ['mode', ['normal']],
])('rejects a JSON array details %s at the preparation boundary', (field, value) => {
  const details = { status: 'available', fetchedAt: stamp, submissionType: 'individual', mode: 'normal',
    opensAt: null, deadline: stamp, isInProgress: true, isClosed: false,
    attempts: { unlimited: false, limit: 1, used: 0, remaining: 1 }, resubmissionOpen: false, retractAllowed: false };
  expect(() => parseNativeTronClassPreparation({ ...preparation, details: { ...details, [String(field)]: value } }, scope))
    .toThrow('INVALID_RESPONSE');
});
it('refuses coursework outside the returned course set and duplicate assignments', () => {
  expect(() =>
    parseNativeTronClassSnapshot({ ...snapshot, homework: [{ ...homework, courseId: 99 }] }),
  ).toThrow('INVALID_RESPONSE');
  expect(() =>
    parseNativeTronClassSnapshot({ ...snapshot, homework: [homework, homework] }),
  ).toThrow('INVALID_RESPONSE');
});
it.each(['announcements', 'materials'] as const)(
  'rejects %s from a course absent from the native snapshot course set',
  (area) => {
    const foreignAnnouncement = {
      id: 'notice-99', courseId: 99, courseName: '其他課程', title: '私人公告',
      content: 'private fixture', publishedAt: stamp, href: 'https://tronclass.pu.edu.tw',
      source: 'course',
    };
    const foreignMaterial = {
      id: 'material-99', courseId: 99, courseName: '其他課程', title: '私人教材',
      type: 'file', href: 'https://tronclass.pu.edu.tw', files: [],
    };
    const item = area === 'announcements' ? foreignAnnouncement : foreignMaterial;
    expect(() => parseNativeTronClassSnapshot({ ...snapshot, [area]: [item] }))
      .toThrow('INVALID_RESPONSE');
  },
);
it('accepts only in-scope or explicitly school-wide supplemental items in a partial snapshot', () => {
  const announcement = {
    id: 'notice-10', courseId: 10, courseName: '程式設計', title: '課堂公告',
    content: 'fixture content', publishedAt: stamp, href: 'https://tronclass.pu.edu.tw',
    source: 'course',
  };
  const material = {
    id: 'campus-file', courseId: null, courseName: '', title: '校園共用資料',
    type: 'file', href: 'https://tronclass.pu.edu.tw', files: [],
  };
  const partial = { ...snapshot, partial: true,
    announcements: [announcement], materials: [material],
    errors: [{ courseId: 99, area: 'materials' as const, message: '其他課程無法同步。' }],
  };
  expect(parseNativeTronClassSnapshot(partial)).toEqual(partial);
});

it.each(['raw-school-id', 'A'.repeat(64), true])(
  'rejects an invalid verified identity fingerprint: %s',
  (studentKey) => {
    expect(() => parseNativeTronClassConnection({ ...connection, studentKey })).toThrow(
      'INVALID_RESPONSE',
    );
  },
);
it('accepts legacy responses without a recovery fingerprint but never an expired fingerprint', () => {
  expect(
    parseNativeTronClassConnection({ ...connection, studentKey: undefined }).studentKey,
  ).toBeUndefined();
  expect(() => parseNativeTronClassConnection({ ...connection, connected: false })).toThrow(
    'INVALID_RESPONSE',
  );
});
it('enforces target IDs, known rules and trustworthy receipt times at the response boundary', () => {
  expect(() => parseNativeTronClassPreparation({ ...preparation, homeworkId: 99 }, scope)).toThrow(
    'INVALID_RESPONSE',
  );
  expect(() =>
    parseNativeTronClassPreparation(
      { ...preparation, canSubmit: true, rules: { status: 'unknown' } },
      scope,
    ),
  ).toThrow('INVALID_RESPONSE');
  expect(() =>
    parseNativeTronClassPreparation(
      {
        ...preparation,
        receipt: {
          id: '1',
          courseId: 10,
          homeworkId: 20,
          status: 'submitted',
          createdAt: stamp,
          content: '',
          attachments: [],
          source: 'tronclass',
        },
      },
      scope,
    ),
  ).toThrow('INVALID_RESPONSE');
});
it('accepts acknowledged readback without inventing a submittedAt', () => {
  const result = parseNativeTronClassResult(acknowledged(), scope);
  expect(result.status).toBe('confirmed');
  expect(JSON.stringify(result)).not.toContain('submittedAt');
});
it('preserves a legitimate unknown result for read-only reconciliation', () => {
  const result = { status: 'unknown', operationId, receipt: null };
  expect(parseNativeTronClassResult(result, scope)).toEqual(result);
});
it.each([
  ['unknown JSON array', ['unknown']],
  ['submitted JSON array', ['submitted']],
  ['nested JSON array', [['unknown']]],
  ['boxed status string', Object('unknown')],
  ['null', null],
  ['boolean', true],
  ['number', 0],
])('rejects %s instead of coercing it into a completed result', (_label, status) => {
  expect(() => parseNativeTronClassResult({ status, operationId, receipt: null }, scope)).toThrow(
    'INVALID_RESPONSE',
  );
});
it('does not invoke a status object string converter', () => {
  const toString = jest.fn(() => 'unknown');
  expect(() =>
    parseNativeTronClassResult({ status: { toString }, operationId, receipt: null }, scope),
  ).toThrow('INVALID_RESPONSE');
  expect(toString).not.toHaveBeenCalled();
});
it.each(['unknown', 'submitted'])('rejects a JSON array %s response before submit or reconcile reaches the UI', async status => {
  const client = createNativeTronClassClient({
    owner: 'platform:fixture',
    isCurrent: () => true,
    request: jest.fn(async () => ({ status: [status], operationId, receipt: null })),
    upload: jest.fn(),
  });
  await expect(client.submit({ ...scope, revision, content: 'fixture text', attachments: [], confirmed: true }))
    .rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  await expect(client.reconcile({ ...scope, revision })).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
});
it('rejects a different operation or homework and never accepts a history entry as a new receipt', () => {
  expect(() =>
    parseNativeTronClassResult(acknowledged('22222222-2222-4222-8222-222222222222'), scope),
  ).toThrow('INVALID_RESPONSE');
  expect(() =>
    parseNativeTronClassResult(
      { ...acknowledged(), confirmation: { ...acknowledged().confirmation, homeworkId: 21 } },
      scope,
    ),
  ).toThrow('INVALID_RESPONSE');
  expect(() =>
    parseNativeTronClassResult(
      {
        status: 'submitted',
        operationId,
        receipt: { id: '30', state: 'submitted', createdAt: stamp },
      },
      scope,
    ),
  ).toThrow('INVALID_RESPONSE');
  expect(() =>
    parseNativeTronClassResult(
      { status: 'unknown', operationId, receipt: { source: 'tronclass' } },
      scope,
    ),
  ).toThrow('INVALID_RESPONSE');
});
it('accepts a scoped legacy verified timestamp receipt', () => {
  const receipt = {
    id: '40',
    courseId: 10,
    homeworkId: 20,
    status: 'submitted',
    submittedAt: stamp,
    content: '',
    attachments: [],
    source: 'tronclass',
  };
  expect(
    parseNativeTronClassResult({ status: 'submitted', operationId, receipt }, scope).status,
  ).toBe('submitted');
});
it('refuses stale owner results both before and after transport', async () => {
  let current = false;
  const request = jest.fn(async () => {
    current = false;
    return connection;
  });
  const client = createNativeTronClassClient({
    owner: 'platform:a',
    isCurrent: () => current,
    request,
    upload: jest.fn(),
  });
  await expect(client.status()).rejects.toMatchObject({ code: 'SESSION_CHANGED' });
  expect(request).not.toHaveBeenCalled();
  current = true;
  await expect(client.status()).rejects.toMatchObject({ code: 'SESSION_CHANGED' });
  expect(request).toHaveBeenCalledTimes(1);
});
it('checks the binding revision on both sync and fresh preparation', async () => {
  const client = createNativeTronClassClient({
    owner: 'platform:a',
    isCurrent: () => true,
    request: jest.fn(async (input) => (input.action === 'sync' ? snapshot : preparation)),
    upload: jest.fn(),
  });
  await expect(client.sync('b'.repeat(32))).rejects.toMatchObject({
    code: 'TRONCLASS_BINDING_CHANGED',
  });
  await expect(client.prepare(10, 20, 'b'.repeat(32))).rejects.toMatchObject({
    code: 'TRONCLASS_BINDING_CHANGED',
  });
  await expect(client.prepare(10, 20, revision)).resolves.toEqual(preparation);
});
it('sends the selected binding revision before native preparation and scoped sync', async () => {
  let activeRevision = revision;
  const readSchool = jest.fn((action: string) => action === 'prepare' ? preparation : snapshot);
  const request = jest.fn(async (input: Record<string, unknown>) => {
    if (input.revision !== activeRevision) throw new NuniError(409, 'TRONCLASS_BINDING_CHANGED');
    return readSchool(String(input.action));
  });
  const client = createNativeTronClassClient({
    owner: 'platform:a', isCurrent: () => true, request, upload: jest.fn(),
  });
  await expect(client.prepare(10, 20, revision)).resolves.toEqual(preparation);
  await expect(client.sync(revision, 10)).resolves.toEqual(snapshot);
  expect(request.mock.calls.map(([input]) => input)).toEqual([
    { action: 'prepare', courseId: 10, homeworkId: 20, revision },
    { action: 'sync', courseId: 10, revision },
  ]);

  readSchool.mockClear();
  activeRevision = 'b'.repeat(32);
  await expect(client.prepare(10, 20, revision)).rejects.toMatchObject({ code: 'TRONCLASS_BINDING_CHANGED' });
  await expect(client.sync(revision, 10)).rejects.toMatchObject({ code: 'TRONCLASS_BINDING_CHANGED' });
  expect(readSchool).not.toHaveBeenCalled();
});
it('checks uploaded file ID, exact bytes metadata and SHA256 before submit can reference it', async () => {
  const upload = jest.fn(async () => ({
    status: 'uploaded',
    fileId: operationId,
    name: 'a.pdf',
    size: 3,
    contentType: 'application/pdf',
    sha256: 'd'.repeat(64),
  }));
  const client = createNativeTronClassClient({
    owner: 'platform:a',
    isCurrent: () => true,
    request: jest.fn(),
    upload,
  });
  const target = { ...scope, revision, fileId: operationId, name: 'a.pdf' };
  await expect(
    client.upload(target, new Uint8Array([1, 2, 3]), 'application/pdf', 'e'.repeat(64)),
  ).rejects.toBeInstanceOf(NuniError);
  await expect(
    client.upload(target, new Uint8Array([1, 2, 3]), 'application/pdf', 'd'.repeat(64)),
  ).resolves.toMatchObject({ fileId: operationId });
});
it.each([
  'http://tronclass.pu.edu.tw/course/10',
  'https://tronclass.pu.edu.tw.evil.test',
  'https://user:password@tronclass.pu.edu.tw',
  'javascript:alert(1)',
  '//evil.test',
])('never opens unsafe source URL %s', (url) => {
  expect(safeTronClassSourceHref(url)).toBeNull();
});

it('selects a download only from the current personal history, never a caller-provided resource URL', () => {
  const prepared = parseNativeTronClassPreparation({ ...preparation, history: submissionHistory }, scope);
  const entry = prepared.history!.entries[0];
  const file = entry.attachments[0];
  expect(nativeTronClassSubmissionDownloadTarget(prepared, entry, file, revision)).toEqual({
    courseId: 10, homeworkId: 20, submissionId: '30', uploadId: 50, revision,
  });
  expect(nativeTronClassSubmissionDownloadTarget(prepared, entry, file, 'b'.repeat(32))).toBeNull();
  expect(nativeTronClassSubmissionDownloadTarget(prepared, { ...entry }, file, revision)).toBeNull();
  expect(nativeTronClassSubmissionDownloadTarget(prepared, entry, { ...file }, revision)).toBeNull();
  expect(nativeTronClassSubmissionDownloadTarget({ ...prepared, history: undefined }, entry, file, revision)).toBeNull();
  const withoutDownload = { ...file, download: undefined };
  const withoutEntry = { ...entry, attachments: [withoutDownload] };
  const withoutPrepared = { ...prepared, history: { ...submissionHistory, entries: [withoutEntry] } };
  expect(nativeTronClassSubmissionDownloadTarget(withoutPrepared, withoutEntry, withoutDownload, revision)).toBeNull();
  expect(() => parseNativeTronClassPreparation({ ...prepared, history: {
    ...submissionHistory, entries: [{ ...entry, attachments: [{ ...file, download: { uploadId: 50, url: 'https://example.test/private' } }] }],
  } }, scope)).toThrow('INVALID_RESPONSE');
});

it('exposes no history download capability when the native transport is unavailable', () => {
  const client = createNativeTronClassClient({ owner: 'platform:a', isCurrent: () => true,
    request: jest.fn(), upload: jest.fn() });
  expect(client.downloadSubmissionAttachment).toBeUndefined();
});

it('freezes the history selector and rejects cancellation, extra routing fields, and a late previous-owner result', async () => {
  let current = true;
  let finish: (value: NativeTronClassDownloadedFile) => void = () => undefined;
  const download = jest.fn((_input: NativeTronClassSubmissionDownloadInput, _signal?: AbortSignal) =>
    new Promise<NativeTronClassDownloadedFile>((resolve) => { finish = resolve; }));
  const client = createNativeTronClassClient({ owner: 'platform:a', isCurrent: () => current,
    request: jest.fn(), upload: jest.fn(), downloadSubmissionAttachment: download });
  const target = { courseId: 10, homeworkId: 20, submissionId: '30', uploadId: 50, revision };
  const controller = new AbortController();
  controller.abort();
  await expect(client.downloadSubmissionAttachment!(target, controller.signal)).rejects.toMatchObject({ code: 'SESSION_CHANGED' });
  await expect(client.downloadSubmissionAttachment!({ ...target, url: 'https://example.test' } as typeof target))
    .rejects.toMatchObject({ code: 'TRONCLASS_INVALID_INPUT' });
  expect(download).not.toHaveBeenCalled();
  const pending = client.downloadSubmissionAttachment!(target);
  target.uploadId = 99;
  expect(download.mock.calls[0][0]).toEqual({ ...target, uploadId: 50 });
  current = false;
  finish({ bytes: new Uint8Array([1]), filename: '先前答案.pdf', contentType: 'application/pdf' });
  await expect(pending).rejects.toMatchObject({ code: 'SESSION_CHANGED' });
});

describe('preparation cancellation', () => {
  const cancelled = { status: 'cancelled', ...scope };

  it.each(['cancelled', 'unknown'])('accepts only the scoped %s cancellation outcome', (status) => {
    expect(parseNativeTronClassPreparationCancellation({ ...cancelled, status }, scope))
      .toEqual({ ...cancelled, status });
  });

  it.each([
    { status: ['cancelled'] },
    { status: 'submitted' },
    { operationId: '22222222-2222-4222-8222-222222222222' },
    { courseId: 11 },
    { homeworkId: 21 },
    { homeworkId: undefined },
    { receipt: null },
    { revision },
  ])('rejects a mismatched or non-cancellation reply: %j', (change) => {
    expect(() => parseNativeTronClassPreparationCancellation({ ...cancelled, ...change }, scope))
      .toThrow('INVALID_RESPONSE');
  });

  it('freezes the exact target before waiting and never submits while cancelling', async () => {
    let finish: (value: unknown) => void = () => undefined;
    const request = jest.fn((_input: Record<string, unknown>) => new Promise(resolve => { finish = resolve; }));
    const client = createNativeTronClassClient({ owner: 'platform:a', isCurrent: () => true,
      request, upload: jest.fn() });
    const target = { ...scope, revision };
    const pending = client.cancelPreparation(target);
    target.operationId = '22222222-2222-4222-8222-222222222222';
    target.courseId = 99;
    target.revision = 'b'.repeat(32);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith({ action: 'cancel-preparation', ...scope, revision });
    finish(cancelled);
    await expect(pending).resolves.toEqual(cancelled);
  });

  it.each([
    { url: 'https://example.test' },
    { confirmed: true },
    { courseId: 0 },
    { homeworkId: '20' },
    { revision: 'wrong' },
    { operationId: 'short' },
  ])('rejects invalid cancellation input before transport: %j', async (change) => {
    const request = jest.fn();
    const client = createNativeTronClassClient({ owner: 'platform:a', isCurrent: () => true,
      request, upload: jest.fn() });
    await expect(client.cancelPreparation({ ...scope, revision, ...change } as Parameters<typeof client.cancelPreparation>[0]))
      .rejects.toMatchObject({ code: 'TRONCLASS_INVALID_INPUT' });
    expect(request).not.toHaveBeenCalled();
  });

  it('rejects stale owners before dispatch and after a cancellation response', async () => {
    let current = false;
    const request = jest.fn(async () => {
      current = false;
      return cancelled;
    });
    const client = createNativeTronClassClient({ owner: 'platform:a', isCurrent: () => current,
      request, upload: jest.fn() });
    await expect(client.cancelPreparation({ ...scope, revision })).rejects.toMatchObject({ code: 'SESSION_CHANGED' });
    expect(request).not.toHaveBeenCalled();
    current = true;
    await expect(client.cancelPreparation({ ...scope, revision })).rejects.toMatchObject({ code: 'SESSION_CHANGED' });
    expect(request).toHaveBeenCalledTimes(1);
  });
});
