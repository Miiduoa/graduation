import assert from 'node:assert/strict';
import { it } from 'vitest';
import {
  ACADEMIC_REFRESH_INTERVAL_MS as INTERVAL,
  ACADEMIC_REFRESH_MAX_BACKOFF_MS as MAX_BACKOFF,
  createAcademicRefreshController,
  type AcademicAutomaticStatus,
  type AcademicRefreshEnvironment,
  type AcademicRefreshOutcome,
} from './academicRefreshController';

function clock() {
  let now = 0;
  let nextId = 0;
  const timers = new Map<number, { at: number; run: () => void }>();
  const listeners = new Set<() => void>();
  const state = { visible: true, online: true };
  const environment: AcademicRefreshEnvironment = {
    now: () => now,
    visible: () => state.visible,
    online: () => state.online,
    schedule(run, delayMs) {
      const id = ++nextId;
      timers.set(id, { at: now + delayMs, run });
      return id;
    },
    cancel: (id) => { timers.delete(id); },
    subscribe(callback) {
      listeners.add(callback);
      return () => { listeners.delete(callback); };
    },
  };
  return {
    environment, state, timers, listeners,
    wake: () => { for (const listener of listeners) listener(); },
    advance(ms: number) {
      now += ms;
      for (const [id, timer] of [...timers]) {
        if (timer.at <= now && timers.delete(id)) timer.run();
      }
    },
    nextDelay: () => Math.min(...[...timers.values()].map((timer) => timer.at - now)),
  };
}

const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

it('reads on request, but schedules nothing until the user enables automatic updates', async () => {
  const time = clock();
  let reads = 0;
  const controller = createAcademicRefreshController({
    environment: time.environment,
    read: async () => { reads++; return 'ready'; },
  });
  await controller.refresh();
  time.advance(INTERVAL * 10);
  time.wake();
  await flush();
  assert.equal(reads, 1);
  assert.equal(time.timers.size, 0);
  controller.dispose();
});

it('waits five minutes after completion and coalesces repeated wake events', async () => {
  const time = clock();
  let reads = 0;
  const controller = createAcademicRefreshController({
    environment: time.environment,
    read: async () => { reads++; return 'ready'; },
  });
  await controller.refresh();
  controller.setAutomatic(true);
  time.advance(INTERVAL - 1);
  for (let i = 0; i < 20; i++) time.wake();
  await flush();
  assert.equal(reads, 1);
  assert.equal(time.timers.size, 1);
  time.advance(1);
  await flush();
  assert.equal(reads, 2);
  assert.equal(time.nextDelay(), INTERVAL);
  controller.dispose();
});

it('pauses when hidden or offline and refreshes stale data when both recover', async () => {
  const time = clock();
  let reads = 0;
  const statuses: AcademicAutomaticStatus[] = [];
  const controller = createAcademicRefreshController({
    environment: time.environment,
    read: async () => { reads++; return 'ready'; },
    onStatus: (status) => { statuses.push(status); },
  });
  await controller.refresh();
  controller.setAutomatic(true);
  time.state.visible = false;
  time.wake();
  time.advance(INTERVAL * 4);
  await flush();
  assert.equal(reads, 1);
  assert.equal(time.timers.size, 0);
  time.state.online = false;
  time.state.visible = true;
  time.wake();
  assert.equal(statuses.at(-1), 'offline');
  time.advance(INTERVAL);
  await flush();
  assert.equal(reads, 1);
  time.state.online = true;
  time.wake();
  time.advance(0);
  await flush();
  assert.equal(reads, 2);
  assert.ok(statuses.includes('hidden'));
  controller.dispose();
});

it('shares one in-flight request between manual clicks and automatic updates', async () => {
  const time = clock();
  let reads = 0;
  let complete!: (outcome: AcademicRefreshOutcome) => void;
  const controller = createAcademicRefreshController({
    environment: time.environment,
    read: () => { reads++; return new Promise((resolve) => { complete = resolve; }); },
  });
  const first = controller.refresh();
  const second = controller.refresh();
  assert.equal(first, second);
  controller.setAutomatic(true);
  await flush();
  time.advance(INTERVAL * 10);
  time.wake();
  assert.equal(reads, 1);
  assert.equal(time.timers.size, 0);
  complete('ready');
  await first;
  assert.equal(time.nextDelay(), INTERVAL);
  controller.dispose();
});

it('backs off transient failures and resets the delay after a successful read', async () => {
  const time = clock();
  let outcome: AcademicRefreshOutcome = 'unavailable';
  const controller = createAcademicRefreshController({
    environment: time.environment,
    read: async () => outcome,
  });
  await controller.refresh();
  controller.setAutomatic(true);
  for (const delay of [INTERVAL, INTERVAL * 2, INTERVAL * 4, MAX_BACKOFF, MAX_BACKOFF]) {
    assert.equal(time.nextDelay(), delay);
    time.advance(delay);
    await flush();
  }
  outcome = 'ready';
  await controller.refresh();
  assert.equal(time.nextDelay(), INTERVAL);
  controller.dispose();
});

for (const reason of ['reconnect', 'permission', 'unconfigured'] as const) {
  it(`stops automatic retries after ${reason} until a deliberate successful retry`, async () => {
    const time = clock();
    let reads = 0;
    let outcome: AcademicRefreshOutcome = reason;
    const controller = createAcademicRefreshController({
      environment: time.environment,
      read: async () => { reads++; return outcome; },
    });
    await controller.refresh();
    controller.setAutomatic(true);
    time.advance(INTERVAL * 10);
    time.wake();
    controller.setAutomatic(false);
    controller.setAutomatic(true);
    time.advance(0);
    await flush();
    assert.equal(reads, 1);
    assert.equal(time.timers.size, 0);
    outcome = 'ready';
    await controller.refresh();
    assert.equal(time.nextDelay(), INTERVAL);
    controller.dispose();
  });
}

it('disabling updates clears timers without misreporting an in-flight read as cancelled', async () => {
  const time = clock();
  let reads = 0;
  let complete!: (value: AcademicRefreshOutcome) => void;
  const statuses: AcademicAutomaticStatus[] = [];
  const controller = createAcademicRefreshController({
    environment: time.environment,
    read: () => { reads++; return new Promise((resolve) => { complete = resolve; }); },
    onStatus: (status) => { statuses.push(status); },
  });
  controller.setAutomatic(true);
  time.advance(0);
  await flush();
  controller.setAutomatic(false);
  complete('ready');
  await flush();
  assert.equal(statuses.at(-1), 'off');
  assert.equal(time.timers.size, 0);
  time.advance(INTERVAL * 10);
  assert.equal(reads, 1);
  controller.dispose();
});

it('disposal removes every listener and a late result cannot schedule or publish again', async () => {
  const time = clock();
  let complete!: (value: AcademicRefreshOutcome) => void;
  const statuses: AcademicAutomaticStatus[] = [];
  const controller = createAcademicRefreshController({
    environment: time.environment,
    read: () => new Promise((resolve) => { complete = resolve; }),
    onStatus: (status) => { statuses.push(status); },
  });
  controller.setAutomatic(true);
  const pending = controller.refresh();
  await flush();
  controller.dispose();
  const before = statuses.length;
  complete('ready');
  await pending;
  time.wake();
  time.advance(INTERVAL * 10);
  assert.equal(statuses.length, before);
  assert.equal(time.listeners.size, 0);
  assert.equal(time.timers.size, 0);
  await controller.refresh();
  controller.dispose();
});

it('handles a synchronous read error as a bounded retry, not an unhandled rejection', async () => {
  const time = clock();
  const controller = createAcademicRefreshController({
    environment: time.environment,
    read: () => { throw new Error('network unavailable'); },
  });
  await controller.refresh();
  controller.setAutomatic(true);
  assert.equal(time.nextDelay(), INTERVAL);
  controller.dispose();
});

it('does not begin a queued read after the owning account has been disposed', async () => {
  const time = clock();
  let reads = 0;
  const controller = createAcademicRefreshController({
    environment: time.environment,
    read: async () => { reads++; return 'ready'; },
  });
  const request = controller.refresh();
  controller.dispose();
  await request;
  assert.equal(reads, 0);
});
