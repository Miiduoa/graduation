// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { parseAssistantCalendarReceipt } from '@campus/shared/src/assistantExecution';
import { confirm, eventRecord, reconcile, revoke, signCard } from './actions';
import { canonical, type Adapter, type Card } from './contracts';
import { withOperationSignal } from './operation';
import { fixtureAdapter, fixtureBinding as binding, FIXTURE_NOW as now, FIXTURE_SECRET as secret } from './fixtures';

const event = { title: '今晚完成作業', date: '2026-11-04', allDay: false, startTime: '20:00', endTime: '21:00' };
const raw = (card: Card) => ({ token: card.token, args: card.args });
const sign = () => signCard(binding, 'propose_personal_event', event, 1, secret, now);
const verify = (value: unknown, card: Card) => parseAssistantCalendarReceipt(value, {
  schoolId: binding.schoolId, mutationId: card.mutationId, event: card.args, storage: 'synced',
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

it('returns a strictly scoped receipt only after a fresh post-write read and replays without another write', async () => {
  const f = fixtureAdapter(), card = sign();
  const read = vi.spyOn(f.adapter, 'ledger');
  const first = verify(await confirm(binding, raw(card), secret, now, f.adapter, true), card);
  expect(read).toHaveBeenCalledTimes(2);
  expect(first).toMatchObject({ status: 'verified', replay: false, revision: 2, storage: 'synced', record: event });
  expect(first.record).toEqual(eventRecord(event, binding.schoolId, card.mutationId, now));
  expect(first).not.toHaveProperty('confirmed');
  expect(JSON.stringify(first)).not.toContain('class-a');
  expect(verify(await confirm(binding, raw(card), secret, now, f.adapter, true), card).replay).toBe(true);
  expect(f.writes).toHaveLength(1);
});

it('does not treat an OK write response as completion when the new row is absent', async () => {
  const f = fixtureAdapter(), card = sign();
  vi.spyOn(f.adapter, 'write').mockImplementation(async () => f.adapter.ledger());
  await expect(confirm(binding, raw(card), secret, now, f.adapter, true)).rejects.toMatchObject({ code: 'EXECUTION_UNKNOWN' });
  expect(await reconcile(binding, raw(card), secret, now, f.adapter, true)).toMatchObject({
    status: 'absent', authorizationValid: true, retryable: false,
  });
});

it('does not return a mismatching row or disclose its fields as an execution receipt', async () => {
  const f = fixtureAdapter(), card = sign(), write = f.adapter.write;
  vi.spyOn(f.adapter, 'write').mockImplementation(async (input) => write({ ...input,
    records: input.records.map((row) => row.id === card.mutationId ? { ...row, title: 'PRIVATE_CONFLICT_TITLE' } : row),
  }));
  await expect(confirm(binding, raw(card), secret, now, f.adapter, true)).rejects.toMatchObject({ code: 'CONFIRMATION_CONFLICT' });
  const check = await reconcile(binding, raw(card), secret, now, f.adapter, true);
  expect(check).toMatchObject({ status: 'conflict', retryable: false });
  expect(check).not.toHaveProperty('record');
  expect(JSON.stringify(check)).not.toContain('PRIVATE_CONFLICT_TITLE');
});

it('recovers a committed write after a failed verification read through read-only reconciliation', async () => {
  const f = fixtureAdapter(), card = sign(), read = f.adapter.ledger;
  vi.spyOn(f.adapter, 'ledger').mockImplementationOnce(read).mockRejectedValueOnce(new Error('read disconnected')).mockImplementation(read);
  await expect(confirm(binding, raw(card), secret, now, f.adapter, true)).rejects.toThrow('read disconnected');
  expect(verify(await reconcile(binding, raw(card), secret, now, f.adapter, true), card).replay).toBe(true);
  expect(f.writes).toHaveLength(1);
});

it('reconciles expired and superseded cards without granting write authority', async () => {
  const f = fixtureAdapter(), card = sign();
  await confirm(binding, raw(card), secret, now, f.adapter, true);
  expect(verify(await reconcile(binding, raw(card), secret, now + 300001, f.adapter, true), card).status).toBe('verified');
  sign();
  expect(verify(await reconcile(binding, raw(card), secret, now, f.adapter, true), card).status).toBe('verified');
  await expect(confirm(binding, raw(card), secret, now, f.adapter, true)).rejects.toMatchObject({ code: 'CONFIRMATION_REVOKED' });
  expect(f.writes).toHaveLength(1);
});

it('reconciles after an issuer or process epoch changed while refusing another write', async () => {
  vi.stubEnv('FLY_MACHINE_ID', 'issuer-a');
  const f = fixtureAdapter(), card = sign();
  await confirm(binding, raw(card), secret, now, f.adapter, true);
  vi.stubEnv('FLY_MACHINE_ID', 'issuer-b');
  vi.resetModules();
  const restarted = await import('./actions');
  expect(verify(await restarted.reconcile(binding, raw(card), secret, now, f.adapter, true), card).status).toBe('verified');
  await expect(restarted.confirm(binding, raw(card), secret, now, f.adapter, true)).rejects.toThrow();
  expect(f.writes).toHaveLength(1);
});

it('reports absence with original authorization and CAS eligibility, never a new authorization', async () => {
  const f = fixtureAdapter(), card = sign();
  expect(await reconcile(binding, raw(card), secret, now, f.adapter, true)).toMatchObject({
    status: 'absent', mutationId: card.mutationId, authorizationValid: true, retryable: true, revision: 1,
  });
  expect(await reconcile(binding, raw(card), secret, now, f.adapter, false)).toMatchObject({
    status: 'absent', authorizationValid: true, retryable: false,
  });
  expect(await reconcile(binding, raw(card), secret, now + 300001, f.adapter, true)).toMatchObject({
    status: 'absent', authorizationValid: false, retryable: false,
  });
  const before = await f.adapter.ledger();
  await f.adapter.write({ schoolId: binding.schoolId, expectedRevision: 1, records: before.records, mutationId: 'independent-edit' });
  expect(await reconcile(binding, raw(card), secret, now, f.adapter, true)).toMatchObject({
    status: 'absent', authorizationValid: true, retryable: false, revision: 2,
  });
  expect(f.writes).toHaveLength(1);
});

it('rejects forged or differently scoped read-back requests before reading the ledger', async () => {
  const f = fixtureAdapter(), card = sign(), read = vi.spyOn(f.adapter, 'ledger');
  for (const key of ['account', 'session', 'conversationId', 'schoolId'] as const)
    await expect(reconcile({ ...binding, [key]: 'wrong-scope' }, raw(card), secret, now, f.adapter, true)).rejects.toThrow();
  await expect(reconcile(binding, { ...raw(card), args: { ...card.args, title: 'changed' } }, secret, now, f.adapter, true)).rejects.toThrow();
  await expect(reconcile(binding, { ...raw(card), token: card.token + 'x' }, secret, now, f.adapter, true)).rejects.toThrow();
  await expect(reconcile(binding, raw(card), secret, now - 1, f.adapter, true)).rejects.toThrow();
  const page = signCard(binding, 'propose_open_page', { page: 'calendar' }, 1, secret, now);
  await expect(reconcile(binding, raw(page), secret, now, f.adapter, true)).rejects.toThrow();
  expect(read).not.toHaveBeenCalled();
});

it('still validates signed metadata, args hash and token lifetime shape during old-token reads', async () => {
  const f = fixtureAdapter(), card = sign(), read = vi.spyOn(f.adapter, 'ledger');
  const payload = JSON.parse(Buffer.from(card.token.split('.')[0], 'base64url').toString());
  for (const change of [{ binding: 'wrong' }, { iat: now + 1 }, { exp: now + 1 }, { argsHash: 'wrong' }, { mutationId: 'bad' }, { stage: 'preview' }, { revision: -1 }]) {
    const body = Buffer.from(canonical({ ...payload, ...change })).toString('base64url');
    const token = body + '.' + createHmac('sha256', secret).update('nuni-assistant-v2-confirm\0' + body).digest('base64url');
    await expect(reconcile(binding, { token, args: card.args }, secret, now, f.adapter, true)).rejects.toThrow();
  }
  expect(read).not.toHaveBeenCalled();
});

it('cancels an absent live proposal idempotently and reconciles its revoked state', async () => {
  const f = fixtureAdapter(), card = sign();
  expect(await revoke(binding, raw(card), secret, now, f.adapter)).toMatchObject({ status: 'revoked', alreadyRevoked: false, retryable: false });
  expect(await revoke(binding, raw(card), secret, now, f.adapter)).toMatchObject({ status: 'revoked', alreadyRevoked: true });
  expect(await reconcile(binding, raw(card), secret, now, f.adapter, true)).toMatchObject({ status: 'revoked', alreadyRevoked: true });
  await expect(confirm(binding, raw(card), secret, now, f.adapter, true)).rejects.toMatchObject({ code: 'CONFIRMATION_REVOKED' });
  expect(f.writes).toHaveLength(0);
});

it('cancellation reports a previously created exact event and never deletes it', async () => {
  const f = fixtureAdapter(), card = sign();
  await confirm(binding, raw(card), secret, now, f.adapter, true);
  const result = verify(await revoke(binding, raw(card), secret, now + 300001, f.adapter), card);
  expect(result.replay).toBe(true);
  expect((await f.adapter.ledger()).records.filter((row) => row.id === card.mutationId)).toHaveLength(1);
  expect(f.writes).toHaveLength(1);
});

it('never claims revocation for a lost-registry, superseded or unreadable absent execution', async () => {
  const f = fixtureAdapter(), card = sign();
  // Starting a later proposal purges expired issuance evidence. An absent
  // ledger cannot replace that lost evidence, even if this card was not sent.
  signCard({ ...binding, conversationId: 'other-conversation' },
    'propose_personal_event', event, 1, secret, now + 300001);
  await expect(revoke(binding, raw(card), secret, now + 300001, f.adapter)).rejects.toThrow();
  const replaced = sign();
  sign();
  await expect(revoke(binding, raw(replaced), secret, now, f.adapter)).rejects.toThrow();
  const fresh = sign();
  vi.spyOn(f.adapter, 'ledger').mockRejectedValueOnce(new Error('read disconnected'));
  await expect(revoke(binding, raw(fresh), secret, now, f.adapter)).rejects.toThrow('read disconnected');
  expect(await reconcile(binding, raw(fresh), secret, now, f.adapter, true)).toMatchObject({ status: 'absent', authorizationValid: true });
});

it('serializes cancellation behind a dispatched write and reports the late completion', async () => {
  const f = fixtureAdapter(), card = sign(), originalWrite = f.adapter.write;
  const entered = deferred<void>(), release = deferred<void>();
  vi.spyOn(f.adapter, 'write').mockImplementation(async (input) => { entered.resolve(); await release.promise; return originalWrite(input); });
  const confirming = confirm(binding, raw(card), secret, now, f.adapter, true);
  await entered.promise;
  let cancelSettled = false;
  const cancelling = revoke(binding, raw(card), secret, now, f.adapter).finally(() => { cancelSettled = true; });
  await Promise.resolve(); await Promise.resolve();
  expect(cancelSettled).toBe(false);
  release.resolve();
  expect(verify(await confirming, card).status).toBe('verified');
  expect(verify(await cancelling, card).status).toBe('verified');
  expect(f.writes).toHaveLength(1);
});

it('an ambiguous write error cannot become a false revoked result while the remote commit may arrive', async () => {
  const f = fixtureAdapter(), card = sign(), originalWrite = f.adapter.write;
  let pending!: Parameters<Adapter['write']>[0];
  vi.spyOn(f.adapter, 'write').mockImplementation(async (input) => { pending = input; throw new Error('connection lost'); });
  await expect(confirm(binding, raw(card), secret, now, f.adapter, true)).rejects.toThrow('connection lost');
  await expect(revoke(binding, raw(card), secret, now, f.adapter)).rejects.toMatchObject({ code: 'EXECUTION_UNKNOWN' });
  await expect(reconcile(binding, raw(card), secret, now, f.adapter, true)).rejects.toMatchObject({ code: 'EXECUTION_UNKNOWN' });
  await originalWrite(pending);
  expect(verify(await reconcile(binding, raw(card), secret, now, f.adapter, true), card).status).toBe('verified');
  expect(verify(await revoke(binding, raw(card), secret, now, f.adapter), card).status).toBe('verified');
  expect(f.writes).toHaveLength(1);
});

it('keeps the operation lock until dispatched work settles even when its request is aborted', async () => {
  const f = fixtureAdapter(), card = sign(), originalWrite = f.adapter.write;
  const entered = deferred<void>(), release = deferred<void>(), controller = new AbortController();
  vi.spyOn(f.adapter, 'write').mockImplementation(async (input) => { entered.resolve(); await release.promise; return originalWrite(input); });
  const confirming = withOperationSignal(controller.signal, () => confirm(binding, raw(card), secret, now, f.adapter, true));
  const failure = expect(confirming).rejects.toThrow();
  await entered.promise;
  controller.abort(new Error('request closed'));
  let settled = false;
  const cancelling = revoke(binding, raw(card), secret, now, f.adapter).finally(() => { settled = true; });
  await Promise.resolve(); await Promise.resolve();
  expect(settled).toBe(false);
  release.resolve();
  await failure;
  expect(verify(await cancelling, card).status).toBe('verified');
  expect(f.writes).toHaveLength(1);
});

it('refuses a cross-school ledger and does not emit a verified result after an aborted read', async () => {
  const f = fixtureAdapter(), card = sign(), read = f.adapter.ledger;
  vi.spyOn(f.adapter, 'ledger').mockImplementationOnce(async () => ({ ...await read(), schoolId: 'other-school' }));
  await expect(reconcile(binding, raw(card), secret, now, f.adapter, true)).rejects.toMatchObject({ code: 'FORBIDDEN_SCOPE' });
  const controller = new AbortController();
  vi.mocked(f.adapter.ledger).mockImplementationOnce(async () => { controller.abort(new Error('closed')); return read(); });
  await expect(withOperationSignal(controller.signal, () => reconcile(binding, raw(card), secret, now, f.adapter, true))).rejects.toThrow();
  expect(f.writes).toHaveLength(0);
});
