import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import process from 'node:process';
import { admissionFixture, binding } from './fixtures.mjs';
const load = (name) =>
  import(pathToFileURL(join(process.env.PLATFORM_AGENT_COMPILED, `${name}.js`)).href);
const { PlatformPublicTaskService } = await load('service');
const { createPlatformPublicAgentHandler } = await load('http');
const origin = 'http://127.0.0.1:4319';
function setup() {
  const f = admissionFixture();
  const service = new PlatformPublicTaskService({
    accounts: f.options.accounts,
    ledger: f.ledger,
    clock: () => f.db.now,
    readPublicCatalog: async () => {
      throw Error('not required for reconciliation');
    },
  });
  const handler = createPlatformPublicAgentHandler({
    enabled: true,
    origin,
    service,
    resolveHttpSession: async () => ({
      authorization: f.authorization,
      context: 'synthetic-session',
    }),
  });
  const call = (action, body, headers = {}) =>
    handler(
      new globalThis.Request(`${origin}/api/platform-public-agent/${action}`, {
        method: 'POST',
        headers: {
          origin,
          'content-type': 'application/json',
          'x-public-task': '1',
          'x-session-context': 'synthetic-session',
          ...headers,
        },
        body: JSON.stringify(body),
      }),
    );
  return { ...f, call };
}
test('HTTP reconciliation accepts no client evidence; verified no-dispatch still needs explicit acknowledgement', async () => {
  const f = setup(),
    b = binding(),
    c = await f.ledger.confirm(f.actor, b),
    op = await f.ledger.claim(f.actor, b, c.confirmationId);
  await f.ledger.markUnknown(f.actor, b, op.operationId, op.executionToken);
  const scope = { task: b.task, schoolId: b.schoolId, operationId: op.operationId };
  assert.equal((await f.call('reconcile', { ...scope, notDispatched: true })).status, 422);
  assert.equal(
    (await f.call('reconcile', scope, { origin: 'https://attacker.invalid' })).status,
    403,
  );
  const recovered = await f.call('reconcile', scope);
  assert.equal(recovered.status, 200);
  assert.deepEqual(await recovered.json(), { status: 'failed', operationId: op.operationId });
  await assert.rejects(f.ledger.beginDispatch(f.actor, b, op.operationId, op.executionToken));
  assert.deepEqual(await (await f.call('status', { task: b.task, schoolId: b.schoolId })).json(), {
    status: 'failed',
    operationId: op.operationId,
  });
  assert.equal((await f.call('ack', { ...scope, approved: false })).status, 422);
  assert.equal((await f.call('ack', { ...scope, approved: true })).status, 200);
});
test('HTTP reconciliation keeps a dispatched unknown operation unknown', async () => {
  const f = setup(),
    b = binding(),
    c = await f.ledger.confirm(f.actor, b),
    op = await f.ledger.claim(f.actor, b, c.confirmationId);
  await f.ledger.beginDispatch(f.actor, b, op.operationId, op.executionToken);
  await f.ledger.markUnknown(f.actor, b, op.operationId, op.executionToken);
  const r = await f.call('reconcile', {
    task: b.task,
    schoolId: b.schoolId,
    operationId: op.operationId,
  });
  assert.equal(r.status, 409);
  assert.deepEqual(await r.json(), { code: 'PUBLIC_AGENT_OUTCOME_UNKNOWN' });
});
