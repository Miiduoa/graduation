// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { NuniError } from '@campus/shared/src/nuni';
import { V2Error } from './contracts';
import { readPublicSocial, type PublicSocialTransport } from './publicSocialAdapter';

const schoolId = 'pu', now = Date.parse('2026-11-17T08:00:00.000Z');
const post = { id: 'post-a', tenantId: schoolId, tenantName: '靜宜大學', communityId: 'public-a',
  communityName: '公開交流', text: '歡迎一起討論課程。', author: { displayName: '同學', isSelf: false },
  publishedAt: '2026-11-17T07:00:00.000000Z', version: 1 };

describe('public-social original platform reader', () => {
  it('uses one existing GET, with fixed school and bounded limit, without private reads or mutations', async () => {
    const transport = vi.fn<PublicSocialTransport>().mockResolvedValue({ items: [post], nextCursor: 'next-page' });
    const result = await readPublicSocial(schoolId, { limit: 3 }, transport, now);
    expect(transport).toHaveBeenCalledExactlyOnceWith('social/feed', undefined, { tenantId: schoolId, limit: '3' });
    expect(result).toMatchObject({ version: 1, source: 'platform-public-social', sourcePath: 'social/feed', schoolId,
      query: { limit: 3 }, status: 'ready', partial: true, checkedAt: new Date(now).toISOString(),
      nextCursor: 'next-page', href: '/social?schoolId=pu',
      items: [{ ...post, publishedAt: '2026-11-17T07:00:00.000Z' }] });
    expect(JSON.stringify(transport.mock.calls)).not.toMatch(/members|private|messages|Firebase|\/posts/);
  });

  it('does not widen an empty selected-school feed to all schools', async () => {
    const transport = vi.fn<PublicSocialTransport>().mockResolvedValue({ items: [], nextCursor: null });
    await expect(readPublicSocial(schoolId, {}, transport, now)).resolves.toMatchObject({ status: 'ready', items: [], partial: false });
    expect(transport).toHaveBeenCalledExactlyOnceWith('social/feed', undefined, { tenantId: schoolId, limit: '5' });
  });

  it('rejects invalid scope and arguments before calling the source', async () => {
    const transport = vi.fn<PublicSocialTransport>();
    for (const args of [{ limit: 6 }, { tenantId: 'foreign' }, { cursor: 'previous' }, { board: 'private' }])
      await expect(readPublicSocial(schoolId, args, transport, now)).rejects.toMatchObject({ code: 'PUBLIC_SOCIAL_INVALID_INPUT' });
    for (const school of ['all', 'personal', 'pu/foreign'])
      await expect(readPublicSocial(school, {}, transport, now)).rejects.toMatchObject({ code: 'PUBLIC_SOCIAL_INVALID_INPUT' });
    expect(transport).not.toHaveBeenCalled();
  });

  it.each([
    { items: [{ ...post, tenantId: 'foreign' }], nextCursor: null },
    { items: [post, post], nextCursor: null },
    { items: [post], nextCursor: undefined },
    { items: [{ ...post, author: { ...post.author, uid: 'private-user' } }], nextCursor: null },
  ])('does not filter corrupted or cross-school data into an apparent successful list', async raw => {
    const transport = vi.fn<PublicSocialTransport>().mockResolvedValue(raw);
    await expect(readPublicSocial(schoolId, {}, transport, now)).rejects.toMatchObject({ code: 'INVALID_PUBLIC_SOCIAL_RESULT' });
    expect(transport).toHaveBeenCalledOnce();
  });

  it.each([
    [new NuniError(404, 'NOT_FOUND'), 'NOT_CONNECTED'],
    [new V2Error(503, 'UPSTREAM_UNAVAILABLE'), 'SOURCE_UNAVAILABLE'],
  ] as const)('reports source unavailability separately from zero posts', async (error, unavailable) => {
    const transport = vi.fn<PublicSocialTransport>().mockRejectedValue(error);
    await expect(readPublicSocial(schoolId, {}, transport, now)).resolves.toMatchObject({
      status: 'unavailable', unavailable, items: [], nextCursor: null, partial: false,
    });
    expect(transport).toHaveBeenCalledOnce();
  });

  it.each([
    new V2Error(401, 'UNAUTHENTICATED'), new V2Error(403, 'FORBIDDEN_SCOPE'),
    new V2Error(429, 'API_BUDGET_EXCEEDED'), new V2Error(503, 'TOOL_TIMEOUT'),
    new V2Error(503, 'CONFIGURATION_REQUIRED'), new V2Error(502, 'INVALID_RESPONSE'),
    new V2Error(502, 'INVALID_PUBLIC_SOCIAL_RESULT'), new DOMException('Stopped', 'AbortError'),
  ])('preserves authentication, permission, cancellation, budget and integrity failures without retry', async error => {
    const transport = vi.fn<PublicSocialTransport>().mockRejectedValue(error);
    await expect(readPublicSocial(schoolId, {}, transport, now)).rejects.toBe(error);
    expect(transport).toHaveBeenCalledOnce();
  });
});
