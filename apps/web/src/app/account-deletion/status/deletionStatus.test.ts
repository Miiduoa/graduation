import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  CAPABILITY_TOKEN,
  COOKIE_ABSENT_COPY,
  DELETION_STATUS_ACCESS_PATH,
  INVALID_TOKEN_COPY,
  NOT_FOUND_COPY,
  NUNI_API_ORIGIN,
  PUBLIC_REVOKE_PATH,
  PUBLIC_STATUS_PATH,
  QUERY_UNAVAILABLE_COPY,
  REVOKE_CONFIRMATION,
  formatCounts,
  parseCapabilityToken,
  parseProjection,
  queryCookieStatus,
  queryPublicStatus,
  revokeCookieStatus,
  revokePublicStatus,
  stageLabel,
} from './deletionStatus';

const TOKEN = `pd1_${'A'.repeat(42)}A`;
const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const projection = {
  stage: 'working',
  counts: { pending: 2, deleted: 1, anonymized: 0, retainedWithBasis: 0, failed: 0 },
  updatedAt: '2026-10-25T12:00:00+08:00',
};

it('accepts the existing pd1 query-code shape and rejects shorter values', () => {
  expect(CAPABILITY_TOKEN.test(TOKEN)).toBe(true);
  expect(parseCapabilityToken(`  ${TOKEN}  `)).toBe(TOKEN);
  expect(parseCapabilityToken('pd1_short')).toBeNull();
  expect(parseCapabilityToken('')).toBeNull();
});

it('only reads public progress fields from a status payload', () => {
  expect(
    parseProjection({
      ...projection,
      personId: 'secret-person',
      email: 'hidden@example.com',
    }),
  ).toEqual(projection);
  expect(parseProjection({ ...projection, stage: 'unknown' })).toBeNull();
  expect(
    parseProjection({
      stage: 'completed',
      counts: projection.counts,
      updatedAt: projection.updatedAt,
    }),
  ).toBeNull();
});

it('keeps the old stage and count copy', () => {
  expect(stageLabel('awaiting-review')).toBe('審核中，還沒有開始處理');
  expect(formatCounts(projection.counts)).toBe('待處理 2 類、已刪除 1 類');
  expect(
    formatCounts({ pending: 0, deleted: 0, anonymized: 0, retainedWithBasis: 0, failed: 0 }),
  ).toBe('尚未開始逐類處理');
});

it('queries the existing public status endpoint without a session', async () => {
  fetchMock.mockResolvedValueOnce(jsonResponse(200, projection));
  await expect(queryPublicStatus(TOKEN)).resolves.toEqual(projection);
  expect(fetchMock).toHaveBeenCalledWith(`${NUNI_API_ORIGIN}${PUBLIC_STATUS_PATH}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ capabilityToken: TOKEN }),
    cache: 'no-store',
  });
});

it('maps a missing public query to the existing not-found copy', async () => {
  fetchMock.mockResolvedValueOnce(
    jsonResponse(404, { error: { code: 'NOT_FOUND', message: '找不到這筆查詢。' } }),
  );
  await expect(queryPublicStatus(TOKEN)).rejects.toThrow(NOT_FOUND_COPY);
});

it('revokes through the existing public revoke endpoint', async () => {
  fetchMock.mockResolvedValueOnce(jsonResponse(200, {}));
  await revokePublicStatus(TOKEN);
  expect(fetchMock).toHaveBeenCalledWith(`${NUNI_API_ORIGIN}${PUBLIC_REVOKE_PATH}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ capabilityToken: TOKEN, confirmation: REVOKE_CONFIRMATION }),
    cache: 'no-store',
  });
});

it('reads and revokes the browser-saved query code through the retained access endpoint', async () => {
  fetchMock.mockResolvedValueOnce(jsonResponse(200, projection));
  await expect(queryCookieStatus()).resolves.toEqual({ kind: 'ok', projection });
  expect(fetchMock).toHaveBeenCalledWith(DELETION_STATUS_ACCESS_PATH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'query' }),
    cache: 'no-store',
  });

  fetchMock.mockResolvedValueOnce(jsonResponse(404, {}));
  await expect(queryCookieStatus()).resolves.toEqual({ kind: 'absent' });

  fetchMock.mockResolvedValueOnce(jsonResponse(200, {}));
  await expect(revokeCookieStatus()).resolves.toBe(true);
  expect(fetchMock).toHaveBeenCalledWith(DELETION_STATUS_ACCESS_PATH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'revoke' }),
    cache: 'no-store',
  });
});

it('keeps cookie lookup failures as a public message without inventing a login', async () => {
  fetchMock.mockResolvedValueOnce(jsonResponse(500, { error: { message: QUERY_UNAVAILABLE_COPY } }));
  await expect(queryCookieStatus()).resolves.toEqual({
    kind: 'error',
    message: QUERY_UNAVAILABLE_COPY,
  });
  expect(COOKIE_ABSENT_COPY).toContain('這個瀏覽器沒有保存查詢碼');
  expect(INVALID_TOKEN_COPY).toContain('pd1_');
});
