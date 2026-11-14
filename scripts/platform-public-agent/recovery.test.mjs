import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import process from 'node:process';
import { admissionFixture, quotas, rejectsCode } from './fixtures.mjs';
const load = (name) =>
  import(pathToFileURL(join(process.env.PLATFORM_AGENT_COMPILED, `${name}.js`)).href);
const { PlatformPublicTaskService } = await load('service');
const { createPlatformPublicAgentHandler } = await load('http');
const { exactNavigation } = await load('navigation');
const schoolId = 'pu',
  task = 'public-campus-navigation';
function setup() {
  const f = admissionFixture();
  let executions = 0;
  const sourceControl = { beforeRead: null };
  const catalog = {
    schoolId,
    updatedAt: '2026-10-19',
    label: '合成來源',
    places: [
      {
        id: 'a',
        name: '甲樓',
        lat: 24,
        lng: 120,
        sourceUrl: 'https://www.openstreetmap.org/way/1',
      },
      {
        id: 'b',
        name: '乙館',
        lat: 24.1,
        lng: 120.1,
        sourceUrl: 'https://www.openstreetmap.org/way/2',
      },
    ],
  };
  const service = new PlatformPublicTaskService({
    accounts: f.options.accounts,
    ledger: f.ledger,
    clock: () => f.db.now,
    readPublicCatalog: async () => {
      await sourceControl.beforeRead?.();
      return globalThis.structuredClone(catalog);
    },
    execute: async (task, snapshot) => {
      executions++;
      return exactNavigation(task.data.query, snapshot);
    },
  });
  const preview = async (id) =>
    service.preview(f.authorization, { schoolId, query: '從甲樓到乙館', requestId: id });
  const confirm = async (request) => service.confirm(f.authorization, { approved: true, request });
  return { ...f, service, preview, confirm, sourceControl, executions: () => executions };
}
test('reloaded new session sees only scoped terminal state; explicit acknowledgement enables new task', async () => {
  const f = setup(),
    p = await f.preview('before_reload_1'),
    c = await f.confirm(p.request);
  const result = await f.service.execute(f.authorization, {
    confirmationId: c.confirmationId,
    request: p.request,
  });
  assert.equal(result.status, 'completed');
  const next = f.register(f.db.anotherSession(f.actor), 'b');
  const status = await f.service.status(next, { task, schoolId });
  assert.deepEqual(status, { status: 'completed', operationId: result.operationId });
  assert.equal(JSON.stringify(status).includes('甲樓'), false);
  const fresh = await f.service.preview(next, {
    schoolId,
    query: '從甲樓到乙館',
    requestId: 'after_reload_1',
  });
  await rejectsCode(
    f.service.confirm(next, { approved: true, request: fresh.request }),
    'PUBLIC_AGENT_OPEN_OPERATION',
  );
  await rejectsCode(
    f.service.ack(next, { task, schoolId, operationId: result.operationId, approved: false }),
    'PUBLIC_AGENT_INVALID_INPUT',
  );
  assert.deepEqual(
    await f.service.ack(next, { task, schoolId, operationId: result.operationId, approved: true }),
    { status: 'acknowledged', operationId: result.operationId },
  );
  assert.equal(await f.service.status(next, { task, schoolId }), null);
  await f.service.confirm(next, { approved: true, request: fresh.request });
  assert.equal(f.executions(), 1);
  assert.deepEqual(quotas(f.db), [1, 1]);
});
test('HTTP recovery enforces origin, scoped identity and explicit terminal acknowledgement', async () => {
  const f = setup(),
    origin = 'http://127.0.0.1:4319';
  const handler = createPlatformPublicAgentHandler({
    enabled: true,
    origin,
    service: f.service,
    resolveHttpSession: async () => ({ authorization: f.authorization, context: 'scope-a' }),
  });
  const call = (action, body, headers = {}) =>
    handler(
      new globalThis.Request(`${origin}/api/platform-public-agent/${action}`, {
        method: 'POST',
        headers: {
          origin,
          'content-type': 'application/json',
          'x-public-task': '1',
          'x-session-context': 'scope-a',
          ...headers,
        },
        body: JSON.stringify(body),
      }),
    );
  assert.equal(
    (await call('status', { task, schoolId }, { origin: 'https://evil.invalid' })).status,
    403,
  );
  assert.equal(
    (await call('status', { task, schoolId }, { 'x-session-context': 'wrong' })).status,
    409,
  );
  assert.equal(await (await call('status', { task, schoolId })).json(), null);
  assert.equal(
    (
      await call('ack', {
        task,
        schoolId,
        operationId: 'pago_00000000-0000-0000-0000-000000000000',
        approved: false,
      })
    ).status,
    422,
  );
  assert.equal(f.executions(), 0);
});

test('an old deterministic receipt is not delivered after another tab closes it and starts a new task', async () => {
  const f = setup(),
    p = await f.preview('old_read_1234'),
    c = await f.confirm(p.request);
  const old = await f.service.execute(f.authorization, {
    confirmationId: c.confirmationId,
    request: p.request,
  });
  const fresh = await f.preview('new_read_1234');
  let release, started;
  const waiting = new Promise((resolve) => {
    started = resolve;
  });
  const held = new Promise((resolve) => {
    release = resolve;
  });
  f.sourceControl.beforeRead = async () => {
    f.sourceControl.beforeRead = null;
    started();
    await held;
  };
  const late = f.service.read(f.authorization, p.request);
  await waiting;
  await f.service.ack(f.authorization, {
    task,
    schoolId,
    operationId: old.operationId,
    approved: true,
  });
  const next = await f.confirm(fresh.request);
  const nextClaim = await f.service.admission.claim(f.authorization, {
    confirmationId: next.confirmationId,
    request: fresh.request,
  });
  assert.equal(nextClaim.status, 'claimed');
  release();
  await rejectsCode(late, 'PUBLIC_AGENT_OPERATION_NOT_FOUND');
  assert.equal(
    (await f.service.status(f.authorization, { task, schoolId })).operationId,
    nextClaim.operationId,
  );
});
