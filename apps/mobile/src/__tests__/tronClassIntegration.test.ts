import { NuniError } from '@campus/shared/src/nuni';
import {
  createNativeTronClassClient,
  parseNativeTronClassConnection,
  parseNativeTronClassPreparation,
  parseNativeTronClassResult,
  parseNativeTronClassSnapshot,
  safeTronClassSourceHref,
} from '../services/tronClassIntegration';
import {
  acknowledged,
  connection,
  homework,
  operationId,
  preparation,
  revision,
  snapshot,
  stamp,
} from './fixtures/tronClassIntegration';

const scope = { courseId: homework.courseId, homeworkId: homework.id, operationId };
it('parses partial school observations without changing an unknown submission into false', () => {
  const parsed = parseNativeTronClassSnapshot({
    ...snapshot,
    partial: true,
    errors: [{ courseId: 10, area: 'materials', message: '暫時無法讀取教材。' }],
  });
  expect(parsed.partial).toBe(true);
  expect(parsed.homework[0].submitted).toBeNull();
});
it('refuses coursework outside the returned course set and duplicate assignments', () => {
  expect(() =>
    parseNativeTronClassSnapshot({ ...snapshot, homework: [{ ...homework, courseId: 99 }] }),
  ).toThrow('INVALID_RESPONSE');
  expect(() =>
    parseNativeTronClassSnapshot({ ...snapshot, homework: [homework, homework] }),
  ).toThrow('INVALID_RESPONSE');
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
