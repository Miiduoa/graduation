// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { parseAssistantCampusEventTargets } from '../../assistantCampusEvent';
import { fixtureAdapter, fixtureBinding as binding, FIXTURE_NOW as now, FIXTURE_SECRET as secret } from './fixtures';
import { run, type RunInput } from './runner';
import { retryTaskReads } from './taskRetry';
import { issueRoute, signCard, verifyCard } from './actions';
import type { PublicCampusRead } from './publicCampus';

function eventRead(partial = false): PublicCampusRead {
  return { version: 1, kind: 'events', schoolId: binding.schoolId, source: 'school-club-events',
    sourcePath: `schools/${binding.schoolId}/clubEvents`, checkedAt: new Date(now).toISOString(),
    status: 'ready', partial, href: `/events?schoolId=${binding.schoolId}`,
    items: ['one', 'two'].map((id, index) => ({ id, schoolId: binding.schoolId, title: `活動 ${index + 1}`, summary: '公開活動摘要',
      startsAt: `2026-11-05T${index ? '12' : '08'}:00:00.000Z`,
      ...(index ? {} : { endsAt: '2026-11-05T09:00:00.000Z' }),
      href: `/events/${id}?schoolId=${binding.schoolId}&source=school-club-events` })) };
}
function setup(question = '查近期活動，查今天課表，查公車') {
  const fixture = fixtureAdapter();
  fixture.adapter.publicCampus = vi.fn(async () => eventRead());
  fixture.adapter.publicEvent = vi.fn(async () => { throw new Error('A list query must never select an event'); });
  const model = vi.fn<RunInput['model']>().mockRejectedValue(new Error('No model for selected reader tasks'));
  return { fixture, input: { question, history: [], binding, adapter: fixture.adapter, secret, now, writes: true,
    signal: new AbortController().signal, model, log: () => {} } satisfies RunInput };
}

it('connects verified event choices to a compound task without auto-selecting or preparing a calendar card', async () => {
  const { fixture, input } = setup();
  const result = await run(input);
  expect(result).toMatchObject({ cards: [], modelCalls: 0, dataRead: true,
    eventTargets: [{ id: 'one', source: 'school-club-events', schoolId: binding.schoolId }, { id: 'two' }] });
  expect(parseAssistantCampusEventTargets('eventTargets' in result ? result.eventTargets : null, binding.schoolId)).toHaveLength(2);
  expect(input.model).not.toHaveBeenCalled();
  expect(fixture.adapter.publicEvent).not.toHaveBeenCalled();
  expect(fixture.writes).toHaveLength(0);
  expect(result.answer).toContain('合成301');
});

it('retains explicit event choices from a partial list, including source-only entries with missing end time', async () => {
  const { fixture, input } = setup();
  fixture.adapter.publicCampus = vi.fn(async () => eventRead(true));
  const result = await run(input);
  expect(result).toMatchObject({ cards: [], stopReason: 'TASKS_INCOMPLETE',
    taskPlan: { steps: [
      expect.objectContaining({ serviceId: 'events', status: 'partial' }),
      expect.objectContaining({ serviceId: 'timetable', status: 'completed' }),
      expect.objectContaining({ serviceId: 'bus', status: 'completed' }),
    ] },
    eventTargets: [{ id: 'one', endsAt: '2026-11-05T09:00:00.000Z' }, { id: 'two' }] });
  const choices = parseAssistantCampusEventTargets('eventTargets' in result ? result.eventTargets : null, binding.schoolId);
  expect(choices[1]).not.toHaveProperty('endsAt');
});

it('does not expose event choices from wrong-school or invalid-provenance results', async () => {
  const { fixture, input } = setup();
  fixture.adapter.publicCampus = vi.fn(async () => ({ ...eventRead(), schoolId: 'foreign' }));
  const result = await run(input);
  expect(result).toMatchObject({ cards: [], eventTargets: [], taskPlan: { steps: [
    expect.objectContaining({ serviceId: 'events', status: 'blocked' }),
    expect.objectContaining({ serviceId: 'timetable', status: 'completed' }),
    expect.objectContaining({ serviceId: 'bus', status: 'completed' }),
  ] } });
  expect(fixture.writes).toHaveLength(0);
});

it('a read retry can recover selectable events without selecting one or revoking a pending plan', async () => {
  const { fixture, input } = setup();
  vi.mocked(fixture.adapter.publicCampus!).mockRejectedValueOnce(new Error('Source offline'));
  const initial = await run(input);
  expect(initial).toMatchObject({ eventTargets: [], cards: [] });
  if (!('taskRetry' in initial) || !initial.taskRetry) throw new Error('Missing scoped retry');
  // A different completed clause may have produced a later pending card. A
  // recovered public selection remains a read and cannot invalidate it.
  issueRoute(binding, secret);
  const old = signCard(binding, 'propose_personal_event',
    { title: '原讀書卡', date: '2026-11-04', allDay: false, startTime: '18:00', endTime: '19:00' }, 1, secret, now);
  const result = await retryTaskReads({ token: initial.taskRetry.token, stepIds: initial.taskRetry.stepIds,
    binding, secret, now: now + 1000, adapter: fixture.adapter, signal: input.signal });
  expect(result).toMatchObject({ modelCalls: 0, cards: [], eventTargets: [{ id: 'one' }, { id: 'two' }] });
  expect(verifyCard(binding, { token: old.token, args: old.args }, secret, now + 1000).mutationId).toBe(old.mutationId);
  expect(fixture.adapter.publicEvent).not.toHaveBeenCalled();
  expect(fixture.writes).toHaveLength(0);
});
