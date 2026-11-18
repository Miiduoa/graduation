// @vitest-environment node
import { createHmac } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { beginProposal, confirm, reconcile, revoke, signCard } from './actions';
import { canonical, type Adapter, type Card, type Obj } from './contracts';
import { prepareCourseworkStudyRequest } from './courseworkStudyRequest';
import { fixtureAdapter, fixtureBinding as binding, FIXTURE_NOW as now, FIXTURE_SECRET as secret } from './fixtures';

const event = { title: '準備作業', date: '2026-11-04', allDay: false, startTime: '20:00', endTime: '20:30' };
const expired = now + 300001;
const raw = (card: Card) => ({ token: card.token, args: card.args });
const sign = () => signCard(binding, 'propose_personal_event', event, 1, secret, now);

function changedPayload(card: Card, change: Obj) {
  const payload = JSON.parse(Buffer.from(card.token.split('.')[0], 'base64url').toString());
  const body = Buffer.from(canonical({ ...payload, ...change })).toString('base64url');
  return { token: body + '.' + createHmac('sha256', secret)
    .update('nuni-assistant-v2-confirm\0' + body).digest('base64url'), args: card.args };
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

it('retires an expired preview only after reading its absent record, without restoring confirmation authority', async () => {
  const f = fixtureAdapter(), card = sign();
  const read = vi.spyOn(f.adapter, 'ledger');
  await expect(confirm(binding, raw(card), secret, expired, f.adapter, true, () => expired))
    .rejects.toMatchObject({ code: 'CONFIRMATION_INVALID' });
  expect(read).not.toHaveBeenCalled();
  expect(await reconcile(binding, raw(card), secret, expired, f.adapter, true, () => expired))
    .toMatchObject({ status: 'absent', authorizationValid: false, retryable: false });
  const readsBeforeCancel = read.mock.calls.length;
  expect(await revoke(binding, raw(card), secret, expired, f.adapter, () => expired))
    .toMatchObject({ status: 'revoked', mutationId: card.mutationId, alreadyRevoked: false, retryable: false });
  expect(read).toHaveBeenCalledTimes(readsBeforeCancel + 1);
  expect(await revoke(binding, raw(card), secret, expired, f.adapter, () => expired))
    .toMatchObject({ status: 'revoked', alreadyRevoked: true });
  expect(await reconcile(binding, raw(card), secret, expired, f.adapter, true, () => expired))
    .toMatchObject({ status: 'revoked', alreadyRevoked: true });
  await expect(confirm(binding, raw(card), secret, expired, f.adapter, true, () => expired))
    .rejects.toMatchObject({ code: 'CONFIRMATION_REVOKED' });
  expect(f.writes).toHaveLength(0);
});

it('does not cancel an expired dispatched write whose remote result is still uncertain', async () => {
  const f = fixtureAdapter(), card = sign(), originalWrite = f.adapter.write;
  let dispatched!: Parameters<Adapter['write']>[0];
  const write = vi.spyOn(f.adapter, 'write').mockImplementation(async (input) => {
    dispatched = input;
    throw new Error('connection lost after dispatch');
  });
  await expect(confirm(binding, raw(card), secret, now, f.adapter, true, () => now))
    .rejects.toThrow('connection lost after dispatch');
  expect(write).toHaveBeenCalledOnce();
  await expect(revoke(binding, raw(card), secret, expired, f.adapter, () => expired))
    .rejects.toMatchObject({ code: 'EXECUTION_UNKNOWN' });
  expect(await reconcile(binding, raw(card), secret, expired, f.adapter, true, () => expired))
    .toMatchObject({ status: 'absent', retryable: false });
  await originalWrite(dispatched);
  expect(await revoke(binding, raw(card), secret, expired, f.adapter, () => expired))
    .toMatchObject({ status: 'verified', mutationId: card.mutationId });
  expect(write).toHaveBeenCalledOnce();
});

it('refuses a previously dispatched action even after reconciliation cleared its uncertainty', async () => {
  const f = fixtureAdapter(), card = sign();
  await confirm(binding, raw(card), secret, now, f.adapter, true, () => now);
  const stored = f.snapshot();
  f.adapter.ledger = async () => ({ ...stored, revision: stored.revision + 1,
    records: stored.records.filter((row) => row.id !== card.mutationId) });
  await expect(revoke(binding, raw(card), secret, expired, f.adapter, () => expired))
    .rejects.toMatchObject({ code: 'EXECUTION_UNKNOWN' });
  expect(f.writes).toHaveLength(1);
});

it('rejects expired cancellation on another issuer or an old process epoch', async () => {
  vi.stubEnv('FLY_MACHINE_ID', 'issuer-a');
  const f = fixtureAdapter(), card = sign();
  vi.stubEnv('FLY_MACHINE_ID', 'issuer-b');
  await expect(revoke(binding, raw(card), secret, expired, f.adapter, () => expired))
    .rejects.toMatchObject({ code: 'CONFIRMATION_REVOKED' });
  vi.stubEnv('FLY_MACHINE_ID', 'issuer-a');
  await expect(revoke(binding, changedPayload(card, { epoch: 'another-process-epoch' }),
    secret, expired, f.adapter, () => expired))
    .rejects.toMatchObject({ code: 'CONFIRMATION_REVOKED' });
  expect(f.writes).toHaveLength(0);
});

it('requires the original mutation ID in the current issuance registry', async () => {
  const f = fixtureAdapter(), card = sign();
  await expect(revoke(binding, changedPayload(card, { mutationId: 'av2_' + '1'.repeat(32) }),
    secret, expired, f.adapter, () => expired))
    .rejects.toMatchObject({ code: 'CONFIRMATION_REVOKED' });
  beginProposal({ ...binding, conversationId: 'later-conversation' }, expired);
  await expect(revoke(binding, raw(card), secret, expired, f.adapter, () => expired))
    .rejects.toMatchObject({ code: 'CONFIRMATION_REVOKED' });
  expect(f.writes).toHaveLength(0);
});

it('reports a committed record as verified after expiration and never deletes it', async () => {
  const f = fixtureAdapter(), card = sign();
  await confirm(binding, raw(card), secret, now, f.adapter, true, () => now);
  const before = f.snapshot();
  expect(await revoke(binding, raw(card), secret, expired, f.adapter, () => expired))
    .toMatchObject({ status: 'verified', record: { id: card.mutationId, ...event } });
  expect(f.snapshot()).toEqual(before);
  expect(f.writes).toHaveLength(1);
});

it('keeps a conflicting record intact instead of retiring an expired preview', async () => {
  const f = fixtureAdapter(), card = sign();
  const stored = f.snapshot();
  f.adapter.ledger = async () => ({ ...stored, records: [...stored.records,
    { ...stored.records[0], id: card.mutationId, title: 'private changed record' }] });
  const result = await revoke(binding, raw(card), secret, expired, f.adapter, () => expired);
  expect(result).toMatchObject({ status: 'conflict', retryable: false });
  expect(JSON.stringify(result)).not.toContain('private changed record');
  expect(f.writes).toHaveLength(0);
});

it('allows cancellation after source revalidation rejected the action before any write', async () => {
  const f = fixtureAdapter();
  const prepared = await prepareCourseworkStudyRequest({
    target: { workspaceId: 'course-a', taskId: 'task-urgent', kind: 'assignment' },
    adapter: f.adapter, binding, secret, writes: true, now,
    signal: new AbortController().signal,
  });
  expect(prepared.cards).toHaveLength(1);
  const card = prepared.cards[0], tasks = await f.adapter.work('course-a');
  f.adapter.work = async () => tasks.map((task) => task.id === 'task-urgent'
    ? { ...task, title: '老師已更新題目' } : task);
  await expect(confirm(binding, raw(card), secret, now + 1000, f.adapter, true, () => now + 1000))
    .rejects.toMatchObject({ code: 'COURSEWORK_CHANGED' });
  expect(f.writes).toHaveLength(0);
  expect(await reconcile(binding, raw(card), secret, expired, f.adapter, true, () => expired))
    .toMatchObject({ status: 'absent', retryable: false });
  expect(await revoke(binding, raw(card), secret, expired, f.adapter, () => expired))
    .toMatchObject({ status: 'revoked', alreadyRevoked: false });
  expect(f.writes).toHaveLength(0);
});
