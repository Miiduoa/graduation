// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { confirm, reconcile } from './actions';
import {
  courseworkStudyTarget,
  courseworkStudyWindows,
  selectCourseworkStudyEvent,
} from './courseworkStudy';
import {
  fixtureAdapter,
  fixtureBinding as binding,
  FIXTURE_NOW as now,
  FIXTURE_SECRET as secret,
} from './fixtures';
import { run } from './runner';
import { createTools } from './tools';
import type { CourseworkStudyTarget, Ledger, Task } from './contracts';

const target: CourseworkStudyTarget = {
  workspaceId: 'course-a',
  taskId: 'task-urgent',
  kind: 'assignment',
};
const signal = () => new AbortController().signal;
async function prepare(f = fixtureAdapter(), selected = target, at = now) {
  const model = vi.fn(async () => {
    throw new Error('A selected task must never reach a model');
  });
  const reply = await run({
    question: '幫這份作業安排 30 分鐘',
    studyTarget: selected,
    history: [{ role: 'assistant', content: '這裡的舊標題與截止時間不可當成來源' }],
    binding,
    adapter: f.adapter,
    secret,
    now: at,
    writes: true,
    signal: signal(),
    model,
    log: () => {},
  });
  expect(model).not.toHaveBeenCalled();
  return reply;
}

describe('selected coursework preview and verified execution', () => {
  it.each(['denied', 'unavailable', 'revoked'] as const)(
    'blocks selected-task cards when permission is %s', async (state) => {
      const f = fixtureAdapter();
      f.adapter.permissions = vi.fn(async () => {
        if (state === 'unavailable') throw new Error('store unavailable');
        return { createPersonalEvent: state === 'revoked', prepareFoodOrder: true };
      });
      if (state === 'revoked') {
        const readWork = f.adapter.work;
        f.adapter.work = async (courseId) => {
          const tasks = await readWork(courseId);
          f.adapter.permissions = async () => ({ createPersonalEvent: false, prepareFoodOrder: true });
          return tasks;
        };
      }
      const reply = await prepare(f);
      expect(reply.cards).toEqual([]);
      expect(reply.stopReason).toBe(state === 'unavailable'
        ? 'ASSISTANT_PERMISSION_STORE_UNAVAILABLE' : 'ASSISTANT_PERMISSION_DENIED');
      expect(reply.answer).toContain('助理');
      expect(f.writes).toHaveLength(0);
    },
  );

  it('rechecks permission after the confirmation source guard reads coursework', async () => {
    const f = fixtureAdapter();
    const { cards: [card] } = await prepare(f);
    f.adapter.permissions = async () => ({ createPersonalEvent: true, prepareFoodOrder: true });
    const readWork = f.adapter.work;
    f.adapter.work = async (courseId) => {
      const tasks = await readWork(courseId);
      f.adapter.permissions = async () => ({ createPersonalEvent: false, prepareFoodOrder: true });
      return tasks;
    };
    await expect(confirm(binding, { token: card.token, args: card.args }, secret, now,
      f.adapter, true, () => now)).rejects.toMatchObject({ code: 'ASSISTANT_PERMISSION_DENIED' });
    expect(f.writes).toHaveLength(0);
  });

  it('freshly reads the exact selected task, proposes 30 minutes and writes only after confirmation', async () => {
    const f = fixtureAdapter();
    const readTask = vi.spyOn(f.adapter, 'work');
    const reply = await prepare(f);
    expect(reply).toMatchObject({ dataRead: true, modelCalls: 0, stopReason: '' });
    expect(reply.cards).toHaveLength(1);
    expect(reply.cards[0].args).toEqual({
      title: '準備作業：樹與圖作業',
      date: '2026-11-04',
      startTime: '10:35',
      endTime: '11:05',
      allDay: false,
    });
    expect(reply.answer).toContain('目前尚未保存');
    expect(readTask).toHaveBeenCalledWith('course-a');
    expect(f.writes).toHaveLength(0);
    const card = reply.cards[0];
    const receipt = await confirm(
      binding,
      { token: card.token, args: card.args },
      secret,
      now,
      f.adapter,
      true,
      () => now,
    );
    expect(receipt).toMatchObject({
      status: 'verified',
      storage: 'synced',
      mutationId: card.mutationId,
      replay: false,
    });
    expect(readTask).toHaveBeenCalledTimes(2);
    expect(f.writes).toHaveLength(1);
    expect(f.snapshot().records.at(-1)).toMatchObject(card.args);
    // Receipt recovery continues even after the task is submitted later.
    f.adapter.work = async () => [];
    expect(
      await confirm(binding, { token: card.token, args: card.args }, secret, now, f.adapter, true),
    ).toMatchObject({ status: 'verified', replay: true });
    expect(
      await reconcile(
        binding,
        { token: card.token, args: card.args },
        secret,
        now + 400000,
        f.adapter,
      ),
    ).toMatchObject({ status: 'verified', replay: true });
    expect(f.writes).toHaveLength(1);
  });

  it.each([
    ['submitted', { submitted: true }],
    ['closed', { state: 'closed' }],
    ['renamed', { title: '老師更改過的題目' }],
    ['deadline', { dueAt: '2026-11-04T10:50:00+08:00' }],
  ])('rejects the old preview when the original task is %s', async (_name, change) => {
    const f = fixtureAdapter();
    const taskRows = await f.adapter.work('course-a');
    const {
      cards: [card],
    } = await prepare(f);
    f.adapter.work = async () =>
      taskRows.map((task) => (task.id === target.taskId ? { ...task, ...change } : task));
    await expect(
      confirm(binding, { token: card.token, args: card.args }, secret, now, f.adapter, true),
    ).rejects.toMatchObject({ code: 'COURSEWORK_CHANGED' });
    expect(f.writes).toHaveLength(0);
  });

  it('does not replace an unavailable ID with a same-title assignment or another task kind', async () => {
    const f = fixtureAdapter();
    const rows = await f.adapter.work('course-a');
    f.adapter.work = async () =>
      rows.map((task) => (task.id === target.taskId ? { ...task, kind: 'quiz' } : task));
    const reply = await prepare(f);
    expect(reply.cards).toHaveLength(0);
    expect(reply.stopReason).toBe('COURSEWORK_UNAVAILABLE');
    expect(f.writes).toHaveLength(0);
  });

  it('rechecks school-scoped course access after work is read and before confirmation', async () => {
    const f = fixtureAdapter();
    const access = vi.fn(
      async () => ({ id: 'course-a', title: '資訊課程' }) as { id: string; title: string } | null,
    );
    f.adapter.course = access;
    const {
      cards: [card],
    } = await prepare(f);
    expect(access).toHaveBeenCalledTimes(2);
    access.mockResolvedValue(null);
    await expect(
      confirm(binding, { token: card.token, args: card.args }, secret, now, f.adapter, true),
    ).rejects.toMatchObject({ code: 'COURSEWORK_UNAVAILABLE' });
    expect(f.writes).toHaveLength(0);
    access.mockResolvedValueOnce({ id: 'course-a', title: '資訊課程' }).mockResolvedValueOnce(null);
    expect((await prepare(f)).cards).toHaveLength(0);
  });

  it('binds source guard to the signed card and keeps the original account and school scope', async () => {
    const f = fixtureAdapter();
    const {
      cards: [card],
    } = await prepare(f);
    const [body, signature] = card.token.split('.');
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    expect(payload.studyGuard).toMatchObject({
      workspaceId: target.workspaceId,
      taskId: target.taskId,
      kind: 'assignment',
      policy: 'coursework-gap',
    });
    delete payload.studyGuard;
    const forged = Buffer.from(JSON.stringify(payload)).toString('base64url') + '.' + signature;
    await expect(
      confirm(binding, { token: forged, args: card.args }, secret, now, f.adapter, true),
    ).rejects.toMatchObject({ code: 'CONFIRMATION_INVALID' });
    await expect(
      confirm(
        { ...binding, account: 'another-account' },
        { token: card.token, args: card.args },
        secret,
        now,
        f.adapter,
        true,
      ),
    ).rejects.toMatchObject({ code: 'CONFIRMATION_INVALID' });
    await expect(
      confirm(
        { ...binding, schoolId: 'another-school' },
        { token: card.token, args: card.args },
        secret,
        now,
        f.adapter,
        true,
      ),
    ).rejects.toMatchObject({ code: 'CONFIRMATION_INVALID' });
    expect(f.writes).toHaveLength(0);
  });

  it('retains the existing write switch and never substitutes a model when storage is unavailable', async () => {
    const f = fixtureAdapter();
    const reply = await run({
      question: '安排 30 分鐘',
      studyTarget: target,
      history: [],
      binding,
      adapter: f.adapter,
      secret,
      now,
      writes: false,
      signal: signal(),
      model: async () => {
        throw new Error('model must not run');
      },
      log: () => {},
    });
    expect(reply).toMatchObject({ dataRead: true, cards: [], stopReason: 'WRITES_DISABLED' });
    const {
      cards: [card],
    } = await prepare(f);
    await expect(
      confirm(binding, { token: card.token, args: card.args }, secret, now, f.adapter, false),
    ).rejects.toMatchObject({ code: 'ASSISTANT_WRITE_UNAVAILABLE' });
    expect(f.writes).toHaveLength(0);
  });

  it('rechecks the clock after a slow source read instead of writing an already-started slot', async () => {
    const f = fixtureAdapter();
    const {
      cards: [card],
    } = await prepare(f, target, now - 1000);
    let clock = Date.parse('2026-11-04T10:29:59.500+08:00');
    const original = f.adapter.work;
    f.adapter.work = async (courseId) => {
      const tasks = await original(courseId);
      clock = Date.parse('2026-11-04T10:30:01+08:00');
      return tasks;
    };
    await expect(
      confirm(
        binding,
        { token: card.token, args: card.args },
        secret,
        Date.parse('2026-11-04T10:29:59.500+08:00'),
        f.adapter,
        true,
        () => clock,
      ),
    ).rejects.toMatchObject({ code: 'STUDY_SLOT_CHANGED' });
    expect(f.writes).toHaveLength(0);
  });

  it('freshly revalidates the assignment behind the existing generic study planner too', async () => {
    const f = fixtureAdapter(),
      tasks = await f.adapter.work('course-a');
    const tools = createTools(f.adapter, binding, secret, now, true);
    await tools.call('propose_study_plan', {
      date: '2026-11-04',
      from: '17:00',
      taskIds: [target.taskId],
    });
    const card = tools.cards[0];
    expect(card.args.startTime).toBe('17:00');
    f.adapter.work = async () => tasks.map((task) => ({ ...task, submitted: true }));
    await expect(
      confirm(binding, { token: card.token, args: card.args }, secret, now, f.adapter, true),
    ).rejects.toMatchObject({ code: 'COURSEWORK_CHANGED' });
    expect(f.writes).toHaveLength(0);
  });
});

describe('PDF coursework availability rules', () => {
  async function source() {
    const f = fixtureAdapter();
    return { f, ledger: f.snapshot(), task: (await f.adapter.work('course-a'))[0] };
  }
  it('uses only known between-class gaps and honors an explicitly selected day', async () => {
    const { f, ledger, task } = await source();
    expect(courseworkStudyWindows(ledger, binding, '2026-11-04')).toEqual([
      {
        start: Date.parse('2026-11-04T10:10:00+08:00'),
        end: Date.parse('2026-11-04T12:50:00+08:00'),
      },
    ]);
    expect(selectCourseworkStudyEvent(ledger, binding, task, now, '2026-11-05')).toBeNull();
    const reply = await prepare(f, { ...target, date: '2026-11-05' });
    expect(reply).toMatchObject({ cards: [], stopReason: 'NO_STUDY_SLOT' });
    expect(reply.answer).toContain('2026-11-05 當天');
  });
  it('subtracts personal events with ten-minute margins and rounds the start up to a five-minute grid', async () => {
    const { ledger, task } = await source();
    ledger.records.push({
      ...ledger.records.find((row) => row.kind === 'events')!,
      id: 'personal-lunch',
      startTime: '10:50',
      endTime: '11:20',
    });
    expect(selectCourseworkStudyEvent(ledger, binding, task, now)).toMatchObject({
      startTime: '11:30',
      endTime: '12:00',
    });
    expect(
      selectCourseworkStudyEvent(
        ledger,
        binding,
        { ...task, dueAt: '2026-11-04T11:59:59+08:00' },
        now,
      ),
    ).toBeNull();
  });
  it('merges nested and adjacent classes without inventing gaps and rejects missing schedule times', async () => {
    const { ledger, task } = await source();
    const base = ledger.records.find((row) => row.kind === 'timetable')!;
    ledger.records.push({ ...base, id: 'class-cover', startTime: '09:30', endTime: '13:30' });
    expect(selectCourseworkStudyEvent(ledger, binding, task, now)).toBeNull();
    ledger.records.push({ ...base, id: 'class-unknown', startTime: undefined });
    expect(() => selectCourseworkStudyEvent(ledger, binding, task, now)).toThrow();
  });
  it('does not infer availability from a blank timetable or a single class', async () => {
    const { ledger, task } = await source();
    ledger.records = ledger.records.filter((row) => row.kind !== 'timetable');
    expect(() => selectCourseworkStudyEvent(ledger, binding, task, now)).toThrow();
    const single = fixtureAdapter().snapshot();
    single.records = single.records.filter((row) => row.id !== 'class-b');
    expect(selectCourseworkStudyEvent(single, binding, task, now)).toBeNull();
  });
  it('cannot accept past or excessive dates, timezone-free deadlines, or scope overrides', async () => {
    const { ledger, task } = await source();
    for (const invalid of ['2026-11-03', '2026-11-11'])
      expect(() => selectCourseworkStudyEvent(ledger, binding, task, now, invalid)).toThrow();
    for (const dueAt of [null, '2026-11-05T12:00:00', '2026-02-30T12:00:00Z'])
      expect(() => selectCourseworkStudyEvent(ledger, binding, { ...task, dueAt }, now)).toThrow();
    expect(() => courseworkStudyTarget({ ...target, schoolId: 'another-school' })).toThrow();
    expect(() => courseworkStudyTarget({ ...target, date: '2026-02-30' })).toThrow();
    expect(() =>
      selectCourseworkStudyEvent(
        { ...ledger, schoolId: 'another-school' } as Ledger,
        binding,
        task as Task,
        now,
      ),
    ).toThrow();
  });
});
