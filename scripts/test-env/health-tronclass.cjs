'use strict';

// Read-only checks from the managed daemon's own network context. This script
// never authenticates, sends cookies, or calls the TronClass integration API.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const origin = process.env.WEB_PUBLIC_ORIGIN;
assert.match(origin || '', /^http:\/\/127\.0\.0\.1:[1-9]\d{0,4}$/);
assert.equal(process.env.NODE_ENV, 'development');
assert.equal(process.env.TEST_PROJECT_ID, 'demo-campus-one');

async function get(route) {
  const response = await fetch(`${origin}${route}`, {
    method: 'GET', redirect: 'error', signal: AbortSignal.timeout(20_000),
  });
  const body = await response.arrayBuffer();
  return { status: response.status, type: response.headers.get('content-type') || '', size: body.byteLength };
}

async function main() {
  const deadline = Date.now() + 120_000;
  let healthy = false;
  while (Date.now() < deadline) {
    try {
      healthy = (await get('/health/live')).status === 200;
      if (healthy) break;
    } catch { /* Next may still be starting. */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert.equal(healthy, true, 'Local Next server did not become ready.');
  const login = await get('/login?returnUrl=%2Ftronclass&schoolId=pu&reconnect=school');
  assert.equal(login.status, 200);
  assert.match(login.type, /text\/html/);
  assert.ok(login.size > 0);
  const report = { checkedAt: new Date().toISOString(), projectId: process.env.TEST_PROJECT_ID,
    requests: [{ method: 'GET', path: '/health/live', status: 200 },
      { method: 'GET', path: '/login', status: 200 }],
    authenticated: false, bindingApiCalled: false };
  if (process.env.TRONCLASS_RUNTIME_DIR) {
    fs.writeFileSync(path.join(process.env.TRONCLASS_RUNTIME_DIR, 'health.json'), JSON.stringify(report, null, 2));
  }
  console.log(JSON.stringify(report));
}

main().catch((error) => {
  console.error(`Local read-only health check failed: ${error.code || error.name || 'error'}`);
  process.exitCode = 1;
});
