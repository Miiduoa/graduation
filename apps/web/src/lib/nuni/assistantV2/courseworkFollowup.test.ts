// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { confirm, eventRecord, signCard } from './actions';
import { readCourseworkFollowup } from './courseworkFollowup';
import { prepareCourseworkStudyRequest } from './courseworkStudyRequest';
import { readCourseworkStudySource, readCourseworkStudyTask, studyGuardForTask } from './courseworkStudy';
import { fixtureAdapter, fixtureBinding as binding, FIXTURE_NOW as now, FIXTURE_SECRET as secret } from './fixtures';
import type { Card, Task } from './contracts';

const target = { workspaceId: 'course-a', taskId: 'task-urgent', kind: 'assignment' as const };
const fakes: ReturnType<typeof fixtureAdapter>[] = [];
beforeEach(() => { vi.spyOn(Date, 'now').mockReturnValue(now); });
afterEach(() => {
  for (const fixture of fakes) expect(fixture.adapter.write).not.toHaveBeenCalled();
  fakes.length = 0;
  vi.restoreAllMocks();
});
async function prepared() {
  const f = fixtureAdapter();
  const reply = await prepareCourseworkStudyRequest({ target, adapter: f.adapter, binding, secret, now,
    writes: true, signal: new AbortController().signal });
  const card = reply.cards[0];
  expect(card).toBeTruthy();
  await confirm(binding, { token: card.token, args: card.args }, secret, now, f.adapter, true, () => now);
  vi.spyOn(f.adapter, 'write');
  fakes.push(f);
  return { f, card };
}
const read = (f: ReturnType<typeof fixtureAdapter>, card: Card, at = now) => readCourseworkFollowup({
  binding, proof: { token: card.token, args: card.args }, secret, now: at, adapter: f.adapter,
});
async function sourceChange(f: ReturnType<typeof fixtureAdapter>, change: Partial<Task>) {
  const rows = await f.adapter.work(target.workspaceId);
  f.adapter.work = async () => rows.map(task => task.id === target.taskId ? { ...task, ...change } : task);
}

it('reads the exact stored action and its signed coursework target without colliding with itself', async () => {
  const { f, card } = await prepared();
  const result = await read(f, card);
  expect(result).toMatchObject({ version: 1, operation: 'coursework.followup', status: 'scheduled',
    calendar: 'matching', task: target, source: { title: '樹與圖作業', courseName: '資訊課程', submitted: false } });
  expect(result.event).toEqual(card.args);
  expect(result).not.toHaveProperty('token');
});

it.each([
  ['2026-11-04T10:34:59+08:00', 'scheduled'],
  ['2026-11-04T10:35:00+08:00', 'in_progress'],
  ['2026-11-04T11:04:59+08:00', 'in_progress'],
  ['2026-11-04T11:05:00+08:00', 'elapsed'],
  ['2026-11-06T09:00:00+08:00', 'elapsed'],
])('classifies elapsed preparation time at %s as %s without claiming submission', async (instant, status) => {
  const { f, card } = await prepared();
  expect(await read(f, card, Date.parse(instant))).toMatchObject({ status, source: { submitted: false } });
});

it.each([
  ['renamed', { title: '新的題目' }, 'source_changed'],
  ['deadline', { dueAt: '2026-11-04T10:50:00+08:00' }, 'source_changed'],
  ['no deadline', { dueAt: null }, 'source_changed'],
  ['submitted', { submitted: true }, 'submitted'],
  ['closed', { state: 'closed' }, 'closed'],
] as const)('uses fresh coursework when it is %s', async (_label, change, status) => {
  const { f, card } = await prepared();
  await sourceChange(f, change);
  expect(await read(f, card, now + 360000)).toMatchObject({ status, calendar: 'matching', event: card.args });
});

it('retains source completion separately when the original event was removed', async () => {
  const { f, card } = await prepared();
  await sourceChange(f, { submitted: true });
  const ledger = f.snapshot();
  f.adapter.ledger = async () => ({ ...ledger, records: ledger.records.filter(row => row.id !== card.mutationId) });
  expect(await read(f, card)).toMatchObject({ status: 'submitted', calendar: 'missing' });
});

it.each(['missing', 'changed'] as const)('reports an event that is %s without replacing or restoring it', async mode => {
  const { f, card } = await prepared();
  const ledger = f.snapshot();
  ledger.records = mode === 'missing' ? ledger.records.filter(row => row.id !== card.mutationId)
    : ledger.records.map(row => row.id === card.mutationId ? { ...row, startTime: '11:30', endTime: '12:00' } : row);
  f.adapter.ledger = async () => ledger;
  expect(await read(f, card)).toMatchObject({ status: 'event_' + mode, calendar: mode, event: card.args });
});

it.each(['event', 'class'] as const)('detects a fresh %s conflict against the original preparation time', async kind => {
  const { f, card } = await prepared();
  const ledger = f.snapshot();
  if (kind === 'event') ledger.records.push(eventRecord({ title: '新行程', date: '2026-11-04', allDay: false,
    startTime: '10:45', endTime: '11:15' }, binding.schoolId, 'other-calendar-001', now));
  else ledger.records = ledger.records.map(row => row.id === 'class-a' ? { ...row, endTime: '11:00' } : row);
  f.adapter.ledger = async () => ledger;
  expect(await read(f, card)).toMatchObject({ status: 'conflict', calendar: 'matching' });
});

it.each(['missing', 'unplaced'] as const)('does not infer a safe schedule from %s timetable data', async mode => {
  const { f, card } = await prepared();
  const ledger = f.snapshot();
  ledger.records = mode === 'missing' ? ledger.records.filter(row => row.kind !== 'timetable')
    : ledger.records.map(row => row.id === 'class-a' ? { ...row, startTime: undefined } : row);
  f.adapter.ledger = async () => ledger;
  expect(await read(f, card)).toMatchObject({ status: 'unavailable',
    calendar: mode === 'missing' ? 'matching' : 'unavailable' });
});

it('does not claim submitted when the calendar cannot be read', async () => {
  const { f, card } = await prepared();
  await sourceChange(f, { submitted: true });
  f.adapter.ledger = async () => { throw new Error('Store unavailable'); };
  expect(await read(f, card)).toMatchObject({ status: 'unavailable', calendar: 'unavailable', source: { submitted: true } });
});

it.each(['missing task', 'wrong kind', 'lost access', 'read failure'] as const)('keeps tracking unresolved after %s', async mode => {
  const { f, card } = await prepared();
  const rows = await f.adapter.work(target.workspaceId);
  if (mode === 'lost access') f.adapter.course = vi.fn().mockResolvedValueOnce({ id: 'course-a', title: '資訊課程' }).mockResolvedValueOnce(null);
  else f.adapter.work = async () => {
    if (mode === 'read failure') throw new Error('Source unavailable');
    return mode === 'missing task' ? rows.filter(task => task.id !== target.taskId)
      : rows.map(task => ({ ...task, kind: 'quiz' }));
  };
  expect(await read(f, card)).toMatchObject({ status: 'unavailable', calendar: 'matching', source: null });
});

it('keeps historical reads available with the write permission disabled', async () => {
  const { f, card } = await prepared();
  f.adapter.permissions = vi.fn(async () => ({ createPersonalEvent: false, prepareFoodOrder: false }));
  expect(await read(f, card, now + 360000)).toMatchObject({ status: 'in_progress' });
  expect(f.adapter.permissions).not.toHaveBeenCalled();
});

it('does not turn expired provenance into a new write authorization', async () => {
  const { f, card } = await prepared();
  expect(await read(f, card, now + 360000)).toMatchObject({ status: 'in_progress' });
  await expect(confirm(binding, { token: card.token, args: card.args }, secret, now + 360000, f.adapter, true))
    .rejects.toMatchObject({ code: 'CONFIRMATION_INVALID' });
});

it('rechecks current school membership before and after reading even submitted tasks', async () => {
  const f = fixtureAdapter();
  await sourceChange(f, { submitted: true });
  f.adapter.course = vi.fn(async () => ({ id: 'course-a', title: '資訊課程' }));
  expect(await readCourseworkStudySource(f.adapter, target)).toMatchObject({ task: { submitted: true } });
  expect(f.adapter.course).toHaveBeenCalledTimes(2);
  await expect(readCourseworkStudyTask(f.adapter, target)).rejects.toMatchObject({ code: 'COURSEWORK_CHANGED' });
});

it('preserves the generic study policy without requiring a between-class gap', async () => {
  const f = fixtureAdapter();
  const task = (await f.adapter.work(target.workspaceId))[0];
  const event = { title: '額外複習', date: '2026-11-04', allDay: false, startTime: '17:00', endTime: '17:30' };
  const card = signCard(binding, 'propose_personal_event', event, f.snapshot().revision, secret, now,
    undefined, undefined, studyGuardForTask(task, 'study'));
  await confirm(binding, { token: card.token, args: card.args }, secret, now, f.adapter, true, () => now);
  vi.spyOn(f.adapter, 'write');
  fakes.push(f);
  expect(await read(f, card)).toMatchObject({ status: 'scheduled', calendar: 'matching' });
});

it('marks an unrelated calendar card without reading arbitrary task or calendar data', async () => {
  const f = fixtureAdapter();
  const card = signCard(binding, 'propose_personal_event', { title: '普通行程', date: '2026-11-04',
    allDay: false, startTime: '17:00', endTime: '17:30' }, 1, secret, now);
  vi.spyOn(f.adapter, 'work');
  vi.spyOn(f.adapter, 'ledger');
  expect(await read(f, card)).toMatchObject({ status: 'not_coursework', task: null, source: null, calendar: 'unavailable' });
  expect(f.adapter.work).not.toHaveBeenCalled();
  expect(f.adapter.ledger).not.toHaveBeenCalled();
});
