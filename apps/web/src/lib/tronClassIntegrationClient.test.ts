import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createTronClassClient,
  parseTronClassResult,
  safeTronClassHref,
  TronClassRequestError,
} from './tronClassIntegrationClient';

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

  it('accepts independently typed read-only history without converting it into a receipt', () => {
    expect(parseTronClassResult('prepare', preparation, { courseId: 1, homeworkId: 2 })).toEqual(preparation);
    expect(preparation.receipt).toBeNull();
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
