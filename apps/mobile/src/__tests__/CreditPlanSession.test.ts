import { createCreditPlanSession } from '../features/academics/creditPlanSession';

test('returning to the same account never revives a previous confirmation', () => {
  const session = createCreditPlanSession();
  const before = session.restart();
  session.dispose();
  const after = session.restart();
  expect(session.isLive(before)).toBe(false);
  expect(session.acquire(before)).toBe(false);
  expect(session.acquire(after)).toBe(true);
});

test('tickets from another mounted workspace cannot be reused', () => {
  const a = createCreditPlanSession();
  const b = createCreditPlanSession();
  const ticket = a.restart();
  b.restart();
  expect(b.acquire(ticket)).toBe(false);
});

test('a successful save invalidates every confirmation based on the previous revision', () => {
  const session = createCreditPlanSession();
  const original = session.restart();
  expect(session.acquire(original)).toBe(true);
  const saved = session.finish(original, true)!;
  expect(session.isCurrent(original)).toBe(false);
  expect(session.isLive(original)).toBe(true);
  expect(session.acquire(original)).toBe(false);
  expect(session.acquire(saved)).toBe(true);
});

test('concurrent saves are refused and failures leave the current revision retryable', () => {
  const session = createCreditPlanSession();
  const ticket = session.restart();
  expect(session.acquire(ticket)).toBe(true);
  expect(session.acquire(ticket)).toBe(false);
  const retry = session.finish(ticket, false)!;
  expect(retry.revision).toBe(ticket.revision);
  expect(session.acquire(retry)).toBe(true);
});

test('a late completion cannot release the write lock created by a later session', () => {
  const session = createCreditPlanSession();
  const old = session.restart();
  session.acquire(old);
  const current = session.restart();
  session.acquire(current);
  expect(session.finish(old, true)).toBeNull();
  expect(session.acquire(current)).toBe(false);
  expect(session.finish(current, true)).not.toBeNull();
});

test('dispose invalidates both pending writes and reads', () => {
  const session = createCreditPlanSession();
  const ticket = session.restart();
  session.acquire(ticket);
  session.dispose();
  expect(session.isCurrent(ticket)).toBe(false);
  expect(session.finish(ticket, false)).toBeNull();
});

test('replaying the same completion cannot advance the revision twice', () => {
  const session = createCreditPlanSession();
  const ticket = session.restart();
  session.acquire(ticket);
  session.finish(ticket, true);
  expect(session.finish(ticket, true)).toBeNull();
  expect(session.snapshot().revision).toBe(1);
});
