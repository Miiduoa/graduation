// @vitest-environment node
import { expect, it } from 'vitest';
import { parseAssistantCalendarExecutionResult } from '@campus/shared/src/assistantExecution';
import { beginProposal, confirm, eventRecord, reconcile, revoke, signCard } from './actions';
import type { Card } from './contracts';
import { fixtureAdapter, fixtureBinding as binding, FIXTURE_NOW as now, FIXTURE_SECRET as secret } from './fixtures';

const raw = (card: Card) => ({ token: card.token, args: card.args });
const clock = () => now;
const checked = (card: Card, result: unknown) => parseAssistantCalendarExecutionResult(result, {
  schoolId: binding.schoolId, mutationId: card.mutationId, event: card.args, storage: 'synced',
});

it('retires an unconfirmed plan before previewing revised times and requires fresh confirmations for its new cards', async () => {
  const f = fixtureAdapter();
  const originalEvents = [
    { title: '完成第一份作業', date: '2026-11-04', allDay: false, startTime: '18:00', endTime: '19:00' },
    { title: '完成第二份作業', date: '2026-11-04', allDay: false, startTime: '19:00', endTime: '20:00' },
  ];
  const originalSequence = beginProposal(binding, now);
  const first = signCard(binding, 'propose_personal_event', originalEvents[0], 1, secret, now, originalSequence);
  const second = signCard(binding, 'propose_personal_event', originalEvents[1], 2, secret, now, originalSequence, first);
  const original = [first, second];
  const originalArgs = original.map((card) => structuredClone(card.args));
  const before = f.snapshot();

  for (const card of original) {
    expect(checked(card, await revoke(binding, raw(card), secret, now, f.adapter, clock))).toMatchObject({
      status: 'revoked', mutationId: card.mutationId, authorizationValid: false, retryable: false,
    });
    expect(checked(card, await reconcile(binding, raw(card), secret, now, f.adapter, true, clock))).toMatchObject({
      status: 'revoked', alreadyRevoked: true, authorizationValid: false, retryable: false,
    });
    await expect(confirm(binding, raw(card), secret, now, f.adapter, true, clock))
      .rejects.toMatchObject({ code: 'CONFIRMATION_REVOKED' });
  }
  expect(f.writes).toHaveLength(0);
  expect(f.snapshot()).toEqual(before);

  // A new preview signs a new plan; it never edits the args bound to old tokens.
  const revisedEvents = [originalEvents[0], { ...originalEvents[1], startTime: '20:00', endTime: '21:00' }];
  const revisedSequence = beginProposal(binding, now);
  const revisedFirst = signCard(binding, 'propose_personal_event', revisedEvents[0], 1, secret, now, revisedSequence);
  const revisedSecond = signCard(binding, 'propose_personal_event', revisedEvents[1], 2, secret, now, revisedSequence, revisedFirst);
  const revised = [revisedFirst, revisedSecond];
  expect(revisedSequence).not.toBe(originalSequence);
  for (const [index, card] of revised.entries()) {
    expect(card.token).not.toBe(original[index].token);
    expect(card.mutationId).not.toBe(original[index].mutationId);
    expect(card.args).toEqual(revisedEvents[index]);
  }
  expect(original.map((card) => card.args)).toEqual(originalArgs);
  expect(f.writes).toHaveLength(0);
  expect(f.snapshot()).toEqual(before);

  for (const [index, card] of revised.entries()) {
    expect(f.snapshot().records.some((row) => row.id === card.mutationId)).toBe(false);
    expect(checked(card, await confirm(binding, raw(card), secret, now, f.adapter, true, clock))).toMatchObject({
      status: 'verified', mutationId: card.mutationId, replay: false,
      record: eventRecord(revisedEvents[index], binding.schoolId, card.mutationId, now),
    });
    expect(f.writes).toHaveLength(index + 1);
  }
  expect(f.writes.map((write) => write.mutationId)).toEqual(revised.map((card) => card.mutationId));
  expect(f.snapshot().records).toEqual([
    ...before.records,
    ...revised.map((card, index) => eventRecord(revisedEvents[index], binding.schoolId, card.mutationId, now)),
  ]);
  for (const card of original) {
    await expect(confirm(binding, raw(card), secret, now, f.adapter, true, clock))
      .rejects.toMatchObject({ code: 'CONFIRMATION_REVOKED' });
  }
  expect(f.writes).toHaveLength(2);
  expect(original.map((card) => card.args)).toEqual(originalArgs);
});
