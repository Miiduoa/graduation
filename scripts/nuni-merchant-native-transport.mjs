import assert from 'node:assert/strict';

const platformOrigin = 'https://api.nuni.tw';
const platformPrefix = '/v1/auth/platform/';

/** Acceptance-process-only adapter; forwards real requests and never fabricates a response. */
export function nativeLoopbackFetch(origin, fetch, expectedRequest, record) {
  const target = new URL(origin);
  assert(target.protocol === 'http:' && target.hostname === '127.0.0.1' && target.port);
  assert(
    target.pathname === '/' &&
      !target.search &&
      !target.hash &&
      !target.username &&
      !target.password,
  );
  return async (input, init) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    );
    if (url.origin === platformOrigin && url.pathname.startsWith(platformPrefix)) {
      const expected = expectedRequest();
      assert(expected, 'Unexpected production API request in native acceptance');
      assert.equal(url.pathname + url.search, expected.path, 'Native request path/query mismatch');
      assert.equal(init?.method, expected.method, 'Native request method mismatch');
      // Do not put the handle in assertion output or the acceptance report.
      assert(headers.get('authorization') === expected.authorization, 'Native actor mismatch');
      assert.equal(init?.redirect, 'error', 'Native requests must reject redirects');
      const response = await fetch(`${target.origin}${url.pathname}${url.search}`, init);
      record({ method: expected.method, path: url.pathname, status: response.status });
      assert.equal(response.status, expected.status, 'Native HTTP status mismatch');
      return response;
    }
    assert(
      url.origin === target.origin || (!headers.has('authorization') && !headers.has('cookie')),
      'Acceptance credentials cannot leave the owned loopback API',
    );
    return fetch(input, init);
  };
}
