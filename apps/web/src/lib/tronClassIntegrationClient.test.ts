import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createTronClassClient,
  parseTronClassResult,
  safeTronClassHref,
  TronClassRequestError,
} from './tronClassIntegrationClient';
import type { TronClassAcknowledgedReadbackResult } from '@campus/shared/src/tronClassSubmissionConfirmation';

afterEach(() => vi.unstubAllGlobals());

describe('TronClass client response boundary', () => {
  const history = {
    source: 'tronclass', courseId: 1, homeworkId: 2, fetchedAt: '2026-11-16T08:00:00.000Z',
    state: 'available', latestId: '7', entries: [{ id: '7', state: 'returned', isLatest: true,
      createdAt: '2026-11-15T08:00:00.000Z', content: '原本的作業', contentTruncated: false,
      attachments: [{ name: '報告.pdf', size: 1234 }], hasOtherResources: false }],
  };
  const preparation = { source: 'tronclass', schoolId: 'pu', courseId: 1, homeworkId: 2,
    revision: 'a'.repeat(32), title: '作業', description: '', deadline: null, canSubmit: false,
    blockedReason: '尚未開放', maxFiles: 0, maxFileBytes: 0, allowedContentTypes: [], receipt: null, history };
  const details = { status: 'available', fetchedAt: '2026-11-16T08:00:00.000Z',
    submissionType: 'individual', mode: 'normal', opensAt: null, deadline: null,
    isInProgress: true, isClosed: false,
    attempts: { unlimited: false, limit: 2, used: 2, remaining: 0 },
    resubmissionOpen: false, retractAllowed: false };
  const readback: TronClassAcknowledgedReadbackResult = {
    status: 'confirmed', operationId: 'operation_123456789', receipt: null,
    confirmation: { kind: 'acknowledged-readback', source: 'tronclass', schoolId: 'pu',
      operationId: 'operation_123456789', submissionId: 7, courseId: 1, homeworkId: 2,
      confirmedAt: '2026-11-18T08:00:00.700Z', sourceRecordedAt: '2026-11-17T08:00:00.000Z' },
  };

  it('accepts an operation-matched version confirmation independently of the legacy submitted-at receipt', () => {
    for (const action of ['submit', 'reconcile']) {
      const result = parseTronClassResult(action, readback,
        { operationId: readback.operationId, courseId: 1, homeworkId: 2 });
      expect(result).toEqual(readback);
      expect(result).not.toBe(readback);
      expect(result).toHaveProperty('receipt', null);
      expect(result).not.toHaveProperty('confirmation.submittedAt');
    }
    expect(() => parseTronClassResult('prepare', { ...preparation, receipt: readback.confirmation },
      { courseId: 1, homeworkId: 2 })).toThrowError('尚未收到可確認的回覆');
  });

  it.each([
    { ...readback, operationId: 'another_operation_1234' },
    { ...readback, confirmation: { ...readback.confirmation, operationId: 'another_operation_1234' } },
    { ...readback, receipt: { status: 'submitted' } },
    { ...readback, status: ['confirmed'] },
    { ...readback, canSubmit: true },
    { ...readback, confirmation: { ...readback.confirmation, submittedAt: readback.confirmation.confirmedAt } },
  ])('rejects mixed or mismatched version confirmation responses: %j', value => {
    for (const action of ['submit', 'reconcile']) {
      expect(() => parseTronClassResult(action, value,
        { operationId: readback.operationId, courseId: 1, homeworkId: 2 })).toThrowError('尚未收到可確認的回覆');
    }
  });

  it.each([{ courseId: 999 }, { homeworkId: 999 }])('checks new submission confirmations against the requested scope: %j', change => {
    expect(() => parseTronClassResult('submit', { ...readback,
      confirmation: { ...readback.confirmation, ...change } },
    { operationId: readback.operationId, courseId: 1, homeworkId: 2 })).toThrowError('尚未收到可確認的回覆');
  });

  it('preserves the v1 timestamp requirement and rejects confirmations inside old statuses', () => {
    const receipt = { id: '7', source: 'tronclass', status: 'submitted', courseId: 1, homeworkId: 2,
      submittedAt: '2026-11-18T08:00:00.000Z', content: '作業', attachments: [] };
    const submitted = { status: 'submitted', operationId: readback.operationId, receipt };
    const input = { operationId: readback.operationId, courseId: 1, homeworkId: 2 };
    expect(parseTronClassResult('submit', submitted, input)).toEqual(submitted);
    expect(parseTronClassResult('reconcile', { status: 'unknown', operationId: readback.operationId, receipt: null }, input))
      .toMatchObject({ status: 'unknown', receipt: null });
    for (const submittedAt of [undefined, null, 'bad-time']) {
      expect(() => parseTronClassResult('reconcile', { ...submitted, receipt: { ...receipt, submittedAt } }, input))
        .toThrowError('尚未收到可確認的回覆');
    }
    for (const status of ['unknown', 'submitted', ['unknown'], ['submitted']]) {
      expect(() => parseTronClassResult('reconcile', { ...readback, status }, input))
        .toThrowError('尚未收到可確認的回覆');
    }
  });

  it('returns the strict readback variant through the existing authenticated reconcile request', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify(readback), { headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetch);
    const client = createTronClassClient({ kind: 'platform', context: 'context' });
    expect(await client.reconcile(readback.operationId, 'a'.repeat(32))).toEqual(readback);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/tronclass');
    expect(JSON.parse(String(init.body))).toEqual({ action: 'reconcile', operationId: readback.operationId, revision: 'a'.repeat(32) });
    expect(new Headers(init.headers).get('X-Campus-Session')).toBe('context');
    expect(init.cache).toBe('no-store');
  });

  it('accepts school settings as observations without changing submission authority or an old response', () => {
    const value = { ...preparation, details };
    expect(parseTronClassResult('prepare', value, { courseId: 1, homeworkId: 2 })).toEqual(value);
    expect(value.canSubmit).toBe(false);
    expect(value.receipt).toBeNull();
    expect(parseTronClassResult('prepare', preparation, { courseId: 1, homeworkId: 2 })).not.toHaveProperty('details');
    expect(parseTronClassResult('prepare', { ...preparation, details: { status: 'unavailable' } },
      { courseId: 1, homeworkId: 2 })).toHaveProperty('details.status', 'unavailable');
  });

  it.each([
    null, { status: 'unavailable', attempts: details.attempts },
    { ...details, mode: ['normal'] }, { ...details, submissionType: ['individual'] },
    { ...details, isInProgress: 'true' }, { ...details, fetchedAt: 'bad-time' },
    { ...details, attempts: { ...details.attempts, remaining: 1 } },
    { ...details, attempts: { ...details.attempts, used: -1 } },
    { ...details, attempts: { ...details.attempts, unlimited: true } },
    { ...details, teacher_answers: ['private answer'] },
  ])('rejects malformed, contradictory or unprojected assignment settings: %j', value => {
    expect(() => parseTronClassResult('prepare', { ...preparation, details: value }, { courseId: 1, homeworkId: 2 }))
      .toThrowError('尚未收到可確認的回覆');
  });

  it('accepts an optional server student key only for a connected school account', () => {
    const connection = { schoolId: 'pu', connected: true, revision: 'a'.repeat(32),
      account: 'test-account', userName: null, expiresAt: '2026-11-16T23:00:00.000Z' };
    expect(parseTronClassResult('status', connection, {})).not.toHaveProperty('studentKey');
    expect(parseTronClassResult('connect', { ...connection, studentKey: 'b'.repeat(64) }, {}))
      .toHaveProperty('studentKey', 'b'.repeat(64));
    expect(parseTronClassResult('disconnect', { ...connection, connected: false, studentKey: null }, {}))
      .toHaveProperty('studentKey', null);
    for (const studentKey of ['12345', 'b'.repeat(63), ['b'.repeat(64)], { id: 12345 }]) {
      expect(() => parseTronClassResult('status', { ...connection, studentKey }, {}))
        .toThrowError('尚未收到可確認的回覆');
    }
    expect(() => parseTronClassResult('status', { ...connection, connected: false, studentKey: 'b'.repeat(64) }, {}))
      .toThrowError('尚未收到可確認的回覆');
  });

  it('accepts independently typed read-only history without converting it into a receipt', () => {
    expect(parseTronClassResult('prepare', preparation, { courseId: 1, homeworkId: 2 })).toEqual(preparation);
    expect(preparation.receipt).toBeNull();
  });

  it('accepts a projected history download selector without accepting raw source fields', () => {
    const value = { ...preparation, history: { ...history, entries: [{ ...history.entries[0],
      attachments: [{ name: '報告.pdf', size: 1234, download: { uploadId: 11 } }],
    }] } };
    expect(parseTronClassResult('prepare', value, { courseId: 1, homeworkId: 2 })).toEqual(value);
    for (const download of [{ uploadId: '11' }, { uploadId: 0 }, { uploadId: 11, url: 'https://other.example' },
      { uploadId: 11, studentId: 33 }, null]) {
      const invalid = { ...value, history: { ...value.history, entries: [{ ...value.history.entries[0],
        attachments: [{ name: '報告.pdf', size: 1234, download }],
      }] } };
      expect(() => parseTronClassResult('prepare', invalid, { courseId: 1, homeworkId: 2 })).toThrow();
    }
    expect(() => parseTronClassResult('prepare', { ...value, history: { ...value.history,
      entries: [{ ...value.history.entries[0], state: 'unknown' }],
    } }, { courseId: 1, homeworkId: 2 })).toThrow();
  });

  it('accepts confirmed zero limits and keeps old responses readable without inventing confirmed rules', () => {
    const value = { ...preparation, canSubmit: true, blockedReason: null,
      rules: { status: 'confirmed', allowsText: true, allowsAttachments: false, maxTotalBytes: 0 } };
    expect(parseTronClassResult('prepare', value, { courseId: 1, homeworkId: 2 })).toEqual(value);
    const legacy = parseTronClassResult('prepare', preparation, { courseId: 1, homeworkId: 2 });
    expect(legacy).not.toHaveProperty('rules');
  });

  it('accepts an explicit unknown-rules response only as unavailable for submission', () => {
    const value = { ...preparation, rules: { status: 'unknown' } };
    expect(parseTronClassResult('prepare', value, { courseId: 1, homeworkId: 2 })).toEqual(value);
    expect(() => parseTronClassResult('prepare', { ...value, canSubmit: true }, { courseId: 1, homeworkId: 2 }))
      .toThrowError('尚未收到可確認的回覆');
  });

  it.each([
    null,
    { status: ['confirmed'], allowsText: true, allowsAttachments: true, maxTotalBytes: 20 },
    { status: 'confirmed', allowsText: 'true', allowsAttachments: true, maxTotalBytes: 20 },
    { status: 'confirmed', allowsText: true, allowsAttachments: true, maxTotalBytes: -1 },
    { status: 'confirmed', allowsText: true, allowsAttachments: true, maxTotalBytes: 1.5 },
    { status: 'unknown', allowsText: true },
  ])('rejects malformed or contradictory rule metadata: %j', rules => {
    expect(() => parseTronClassResult('prepare', { ...preparation, rules }, { courseId: 1, homeworkId: 2 }))
      .toThrowError('尚未收到可確認的回覆');
  });

  it('rejects MIME patterns that the confirmed school contract cannot compare as exact file types', () => {
    const rules = { status: 'confirmed', allowsText: true, allowsAttachments: true, maxTotalBytes: 20 };
    expect(() => parseTronClassResult('prepare', { ...preparation, rules, allowedContentTypes: ['image/*'] }, { courseId: 1, homeworkId: 2 }))
      .toThrowError('尚未收到可確認的回覆');
  });

  it.each([
    { ...history, courseId: 999 }, { ...history, homeworkId: 999 },
    { ...history, state: ['available'] },
    { ...history, entries: [{ ...history.entries[0], state: ['submitted'] }] },
    { ...history, latestId: '999' },
    { ...history, entries: [{ ...history.entries[0], isLatest: false }] },
    { ...history, entries: [{ ...history.entries[0], submission_correct: { instructor_score: 90 } }] },
    { ...history, entries: [{ ...history.entries[0], attachments: [{ name: '報告.pdf', size: 1, key: 'private-key' }] }] },
    { ...history, entries: [{ ...history.entries[0], state: 'teacher-marked' }] },
  ])('rejects wrong-scope, malformed, conflicting or unprojected school history: %j', value => {
    expect(() => parseTronClassResult('prepare', { ...preparation, history: value }, { courseId: 1, homeworkId: 2 }))
      .toThrowError('尚未收到可確認的回覆');
  });

  it.each(['status', 'sync', 'prepare'] as const)(
    'rejects an empty successful response for %s',
    async (action) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response('{}')),
      );
      const client = createTronClassClient({ kind: 'platform', context: 'context' });
      const result = action === 'prepare' ? client.prepare(1, 2) : client[action]();
      await expect(result).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    },
  );

  it('preserves a server error without reducing it to a successful empty record', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: 'TRONCLASS_RECONNECT_REQUIRED',
              message: '請重新連接學校帳號。',
            }),
            { status: 401 },
          ),
      ),
    );
    const client = createTronClassClient({ kind: 'platform', context: 'context' });
    await expect(client.status()).rejects.toEqual(
      new TronClassRequestError('TRONCLASS_RECONNECT_REQUIRED', '請重新連接學校帳號。', 401),
    );
  });

  it('allows only the school TronClass origin in source links', () => {
    expect(safeTronClassHref('https://tronclass.pu.edu.tw/course/123')).toBe(
      'https://tronclass.pu.edu.tw/course/123',
    );
    for (const href of [
      'javascript:alert(1)',
      'https://tronclass.pu.edu.tw.evil.test/course/123',
      'https://user:pass@tronclass.pu.edu.tw/course/123',
      'http://tronclass.pu.edu.tw/course/123',
    ])
      expect(safeTronClassHref(href)).toBeNull();
  });
});
