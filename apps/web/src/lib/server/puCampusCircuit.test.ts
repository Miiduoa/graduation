// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import {
  assertCampusHostAllowed,
  CAMPUS_BLOCK_PAGE_TEXT,
  CAMPUS_BLOCKED_HTTP_STATUS,
  CAMPUS_CIRCUIT_TTL_MS,
  CAMPUS_HOST_BLOCKED_CODE,
  campusCircuitHost,
  CampusHostBlockedError,
  isCampusBlockResponse,
  isCampusHostBlocked,
  markCampusHostBlocked,
  noteCampusResponse,
  resetCampusCircuitForTests,
} from './puCampusCircuit';

afterEach(() => {
  resetCampusCircuitForTests();
  vi.restoreAllMocks();
});

it('only circuits alcat and mypu, not identity or TronClass', () => {
  expect(campusCircuitHost('https://alcat.pu.edu.tw/index_check.php')).toBe('alcat.pu.edu.tw');
  expect(campusCircuitHost('https://mypu.pu.edu.tw./Framework/')).toBe('mypu.pu.edu.tw');
  expect(campusCircuitHost('https://identity.pu.edu.tw/auth/realms/pu')).toBeNull();
  expect(campusCircuitHost('https://tronclass.pu.edu.tw/api/login')).toBeNull();
});

it('treats HTTP 555 and the school block page as the same trip condition', () => {
  expect(isCampusBlockResponse(CAMPUS_BLOCKED_HTTP_STATUS, 'plain')).toBe(true);
  expect(isCampusBlockResponse(200, `<html>${CAMPUS_BLOCK_PAGE_TEXT}</html>`)).toBe(true);
  expect(isCampusBlockResponse(200, '帳號或密碼錯誤')).toBe(false);
  expect(isCampusBlockResponse(403, 'Forbidden')).toBe(false);
});

it('opens the circuit for 30 minutes and skips that host until it expires', () => {
  const now = 1_700_000_000_000;
  markCampusHostBlocked('alcat.pu.edu.tw', 'http_555', now);
  expect(isCampusHostBlocked('alcat.pu.edu.tw', now + 1)).toBe(true);
  expect(isCampusHostBlocked('mypu.pu.edu.tw', now + 1)).toBe(false);
  expect(() => assertCampusHostAllowed('https://alcat.pu.edu.tw/', now + 60_000)).toThrow(
    CampusHostBlockedError,
  );
  expect(() => assertCampusHostAllowed('https://identity.pu.edu.tw/', now + 60_000)).not.toThrow();
  expect(isCampusHostBlocked('alcat.pu.edu.tw', now + CAMPUS_CIRCUIT_TTL_MS)).toBe(false);
  expect(() => assertCampusHostAllowed('https://alcat.pu.edu.tw/', now + CAMPUS_CIRCUIT_TTL_MS)).not.toThrow();
});

it('trips from a 555 or block page and does not log the request URL path as a secret', () => {
  const lines: string[] = [];
  vi.spyOn(console, 'info').mockImplementation((...args) => {
    lines.push(args.map((item) => String(item)).join(' '));
  });
  expect(() =>
    noteCampusResponse('https://alcat.pu.edu.tw/index_check.php', 555, 'blocked'),
  ).toThrow(CampusHostBlockedError);
  expect(isCampusHostBlocked('alcat.pu.edu.tw')).toBe(true);
  const log = JSON.parse(lines.at(-1) || '{}') as Record<string, unknown>;
  expect(log).toMatchObject({
    msg: 'pu_campus_host_circuit_open',
    host: 'alcat.pu.edu.tw',
    reason: 'http_555',
    ttlMs: CAMPUS_CIRCUIT_TTL_MS,
  });
  expect(JSON.stringify(log)).not.toContain('index_check');
  expect(() =>
    noteCampusResponse('https://mypu.pu.edu.tw/grades', 200, CAMPUS_BLOCK_PAGE_TEXT),
  ).toThrow(CampusHostBlockedError);
  expect(isCampusHostBlocked('mypu.pu.edu.tw')).toBe(true);
});

it('does not circuit identity hosts even if the body mentions the block phrase', () => {
  expect(() =>
    noteCampusResponse(
      'https://identity.pu.edu.tw/auth/realms/pu',
      200,
      CAMPUS_BLOCK_PAGE_TEXT,
    ),
  ).not.toThrow();
  expect(isCampusHostBlocked('identity.pu.edu.tw')).toBe(false);
});

it('exposes the stable blocked code on the error', () => {
  const error = new CampusHostBlockedError('alcat.pu.edu.tw');
  expect(error.code).toBe(CAMPUS_HOST_BLOCKED_CODE);
  expect(error.host).toBe('alcat.pu.edu.tw');
  expect(String(error)).not.toContain('password');
});
