// @vitest-environment node
import * as planShift from '@/lib/assistantPlanShift';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { beginProposal, confirm, revoke, signCard } from './actions';
import { studyGuardForTask } from './courseworkStudy';
import { directPlanRevision, selectPlanRevision, shiftPlanRevision } from './directPlanRevision';
import { fixtureAdapter, fixtureBinding, FIXTURE_NOW, FIXTURE_SECRET as secret } from './fixtures';
import type { Card, EventArgs } from './contracts';

let serial = 0;
beforeEach(() => vi.spyOn(Date, 'now').mockReturnValue(FIXTURE_NOW));
afterEach(() => vi.restoreAllMocks());
const raw = (card: Card) => ({ token: card.token, args: card.args });

const paths = ['precise', 'subset', 'shift'] as const;
const failures = ['access', 'deadline', 'submitted', 'duration', 'gap', 'none'] as const;
it.each(paths.flatMap(path => failures.map(failure => ({ path, failure }))))(
  '$path rechecks $failure with the exact signed study source', async ({ path, failure }) => {
    const f = fixtureAdapter();
    const work = f.adapter.work;
    f.adapter.work = async id => (await work(id)).map(task => ({ ...task, dueAt: '2026-11-04T23:59:00+08:00' }));
    const binding = { ...fixtureBinding, conversationId: 'revision-study-' + ++serial };
    const task = (await f.adapter.work('course-a')).find(task => task.id === 'task-urgent')!;
    const guard = studyGuardForTask(task, 'coursework-gap');
    // Same titles deliberately prevent title-based mapping. The retained item
    // is second, so a subset must not inherit the first item's absent guard.
    const event: EventArgs = {
      title: '準備作業', date: '2026-11-04', allDay: false, startTime: '11:00', endTime: '11:30',
    };
    const sequence = beginProposal(binding, FIXTURE_NOW);
    let old = [signCard(binding, 'propose_personal_event', {
      ...event, startTime: '18:00', endTime: '18:30',
    }, f.snapshot().revision, secret, FIXTURE_NOW, sequence)];
    old.push(signCard(binding, 'propose_personal_event', event,
      f.snapshot().revision + 1, secret, FIXTURE_NOW, sequence, old[0], guard));
    for (const card of old) await revoke(binding, raw(card), secret, FIXTURE_NOW, f.adapter);

    if (failure === 'access') f.adapter.course = async () => null;

    // A subset can retain a previously revised time. Exercise that real chain
    // to ensure selecting an invalid deadline/slot cannot shed its guard.
    const change = failure === 'deadline'
      ? { date: '2026-11-05', startTime: '11:00', endTime: '11:30' }
      : failure === 'duration'
        ? { date: event.date, startTime: '11:00', endTime: '11:45' }
        : failure === 'gap'
          ? { date: event.date, startTime: '19:00', endTime: '19:30' }
          : { date: event.date, startTime: '11:30', endTime: '12:00' };
    if (path === 'subset') {
      const revised = await directPlanRevision(binding, old.map(raw), {
        mutationId: old[1].mutationId, ...change,
      }, secret, f.adapter);
      old = revised.cards;
      for (const card of old) await revoke(binding, raw(card), secret, FIXTURE_NOW, f.adapter);
    }
    const reply = path === 'precise'
      ? await directPlanRevision(binding, old.map(raw), {
        mutationId: old[1].mutationId, ...change,
      }, secret, f.adapter)
      : path === 'subset'
        ? await selectPlanRevision(binding, old.map(raw), [old[1].mutationId], secret, f.adapter)
        : await shiftPlanRevision(binding, old.map(raw), {
          mutationIds: [old[1].mutationId], protectedMutationIds: [old[0].mutationId],
          offsetMinutes: failure === 'deadline' ? 1440 : failure === 'gap' ? 480 : 30,
        }, secret, f.adapter);
    const card = reply.cards.at(-1)!;
    const payload = JSON.parse(Buffer.from(card.token.split('.')[0], 'base64url').toString());
    expect(payload.studyGuard).toEqual(guard);
    if (reply.cards.length === 2) {
      const firstPayload = JSON.parse(Buffer.from(reply.cards[0].token.split('.')[0], 'base64url').toString());
      expect(firstPayload.studyGuard).toBeUndefined();
      await confirm(binding, raw(reply.cards[0]), secret, FIXTURE_NOW, f.adapter, true);
    }
    if (failure === 'submitted') {
      const read = f.adapter.work;
      f.adapter.work = async id => (await read(id)).map(row => ({ ...row, submitted: true }));
    }
    // A group shift preserves duration; make its fresh timetable remove the
    // 30-minute free slot to exercise the same confirmation policy.
    if (failure === 'duration' && path === 'shift') {
      const read = f.adapter.ledger;
      f.adapter.ledger = async () => {
        const ledger = await read();
        ledger.records.push({ ...ledger.records.find(row => row.kind === 'timetable')!,
          id: 'new-class', startTime: '11:20', endTime: '12:00' });
        return ledger;
      };
    }
    const before = f.writes.length;
    const confirmation = confirm(binding, raw(card), secret, FIXTURE_NOW, f.adapter, true);
    if (failure === 'none') {
      await expect(confirmation).resolves.toMatchObject({ status: 'verified' });
      expect(f.writes).toHaveLength(before + 1);
    } else {
      await expect(confirmation).rejects.toMatchObject({ code: failure === 'access'
        ? 'COURSEWORK_UNAVAILABLE' : failure === 'deadline' || failure === 'submitted'
          ? 'COURSEWORK_CHANGED' : 'STUDY_SLOT_CHANGED' });
      expect(f.writes).toHaveLength(before);
    }
  },
);

it.each(['missing-item', 'changed-identity'] as const)(
  'rejects an unsafe shift mapping (%s) without consuming the source', async failure => {
    const f = fixtureAdapter();
    const binding = { ...fixtureBinding, conversationId: 'revision-study-' + ++serial };
    const task = (await f.adapter.work('course-a'))[0];
    const card = signCard(binding, 'propose_personal_event', {
      title: '準備作業', date: '2026-11-04', allDay: false, startTime: '11:00', endTime: '11:30',
    }, f.snapshot().revision, secret, FIXTURE_NOW, beginProposal(binding, FIXTURE_NOW),
    undefined, studyGuardForTask(task, 'coursework-gap'));
    await revoke(binding, raw(card), secret, FIXTURE_NOW, f.adapter);
    const shift = { mutationIds: [card.mutationId], protectedMutationIds: [], offsetMinutes: 30 };
    const build = planShift.buildPlanShift;
    const mock = vi.spyOn(planShift, 'buildPlanShift').mockImplementationOnce((...args) => {
      const result = build(...args);
      result.after = failure === 'missing-item' ? [] : [{ ...result.after[0], title: '另一份作業' }];
      return result;
    });
    await expect(shiftPlanRevision(binding, [raw(card)], shift, secret, f.adapter))
      .rejects.toMatchObject({ code: failure === 'missing-item' ? 'INVALID_PLAN_SHIFT' : 'INVALID_PLAN_REVISION' });
    expect(f.writes).toHaveLength(0);
    mock.mockRestore();
    const reply = await shiftPlanRevision(binding, [raw(card)], shift, secret, f.adapter);
    await expect(confirm(binding, raw(reply.cards[0]), secret, FIXTURE_NOW, f.adapter, true))
      .resolves.toMatchObject({ status: 'verified' });
  },
);
