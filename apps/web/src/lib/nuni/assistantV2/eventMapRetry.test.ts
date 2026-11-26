// @vitest-environment node
import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { parseAssistantTaskPlan } from '@campus/shared/src/assistantTaskPlan';
import { parseAssistantTaskRetry, type AssistantTaskRetry } from '@campus/shared/src/assistantTaskRetry';
import { campusMapHref, type CampusMapArguments, type CampusMapRead } from './campusMap';
import { canonical, hash, V2Error } from './contracts';
import { crossServiceRequest } from './crossServiceRequest';
import { fixtureAdapter, fixtureBinding as binding, FIXTURE_NOW as now, FIXTURE_SECRET as secret } from './fixtures';
import { publicCampusSourcePath, type PublicCampusRead, type PublicCampusSource } from './publicCampus';
import { run } from './runner';
import { retryTaskReads } from './taskRetry';

const question = '查近期活動，查第二個活動位置';
const originalTarget = { schoolId: binding.schoolId, source: 'school-club-events', id: 'b' };

function eventRead(ids = ['a', 'b'], source: PublicCampusSource = 'school-club-events'): PublicCampusRead {
  const starts = { x: '06', a: '08', b: '12' };
  return { version: 1, kind: 'events', schoolId: binding.schoolId, source,
    sourcePath: publicCampusSourcePath(binding.schoolId, source), checkedAt: new Date(now).toISOString(),
    status: 'ready', partial: false, href: `/events?schoolId=${binding.schoolId}`,
    items: ids.map(id => ({ id, schoolId: binding.schoolId, title: `活動 ${id}`, summary: '',
      startsAt: `2026-11-05T${starts[id as keyof typeof starts]}:00:00.000Z`, location: `活動${id}大樓`,
      href: `/events/${id}?schoolId=${binding.schoolId}&source=${source}` })) };
}

function mapRead(args: CampusMapArguments): CampusMapRead {
  const source = 'school-pois', sourcePath = `schools/${binding.schoolId}/pois`;
  return { version: 1, kind: 'map', schoolId: binding.schoolId, query: args.query, limit: args.limit,
    source, sourcePath, checkedAt: new Date(now).toISOString(), status: 'ready', partial: false,
    resolution: 'matched', href: campusMapHref(binding.schoolId, args.query), items: [{
      id: 'published-place', schoolId: binding.schoolId, name: args.query, category: '教學', description: '',
      lat: 24.2, lng: 120.58, facilities: [], source, sourcePath,
      href: campusMapHref(binding.schoolId, args.query, 'published-place'), match: 'place', verification: 'published',
    }] };
}

async function prepare(read = eventRead()) {
  const fixture = fixtureAdapter();
  fixture.adapter.publicCampus = vi.fn(async () => read);
  fixture.adapter.campusMap = vi.fn(async () => { throw new V2Error(503, 'CAMPUS_MAP_UNAVAILABLE'); });
  const model = vi.fn().mockRejectedValue(new Error('Activity map tasks must not call a model'));
  const reply = await run({ question, history: [], binding, adapter: fixture.adapter, model, secret, now,
    writes: true, signal: new AbortController().signal, log: () => {} });
  expect(model).not.toHaveBeenCalled();
  expect(reply).toMatchObject({ version: 2, modelCalls: 0, dataRead: true, cards: [] });
  const plan = parseAssistantTaskPlan('taskPlan' in reply ? reply.taskPlan : undefined);
  expect(plan).not.toBeNull();
  const taskRetry = parseAssistantTaskRetry('taskRetry' in reply ? reply.taskRetry : undefined, plan!);
  return { fixture, taskRetry, plan: plan! };
}

function freshReaders(fixture: ReturnType<typeof fixtureAdapter>, read: PublicCampusRead) {
  fixture.adapter.publicCampus = vi.fn(async () => read);
  fixture.adapter.campusMap = vi.fn(async args => mapRead(args));
}

async function retry(fixture: ReturnType<typeof fixtureAdapter>, taskRetry: AssistantTaskRetry, at = now + 1000) {
  const reply = await retryTaskReads({ token: taskRetry.token, stepIds: ['task-2'], binding, secret, now: at,
    adapter: fixture.adapter, signal: new AbortController().signal });
  expect(reply).toMatchObject({ version: 2, modelCalls: 0, dataRead: true, cards: [] });
  expect(fixture.writes).toEqual([]);
  expect(fixture.orderCalls).toEqual([]);
  return reply;
}

function payload(taskRetry: AssistantTaskRetry) {
  return JSON.parse(Buffer.from(taskRetry.token.split('.')[0], 'base64url').toString()) as Record<string, unknown>;
}

function signed(value: Record<string, unknown>): string {
  const body = Buffer.from(canonical(value)).toString('base64url');
  return body + '.' + createHmac('sha256', secret).update('nuni-assistant-task-read-retry\0' + body).digest('base64url');
}

describe('event map retries preserve the originally selected identity', () => {
  it('binds only identity and reads updated details for the same event after a new first item', async () => {
    const { fixture, taskRetry } = await prepare();
    expect(taskRetry?.stepIds).toEqual(['task-2']);
    expect(payload(taskRetry!)).toMatchObject({ version: 4, taskProfile: 'student', eventMapSelections: { 'task-2': originalTarget } });
    expect(payload(taskRetry!).eventMapSelections).toEqual({ 'task-2': originalTarget });
    expect(fixture.adapter.campusMap).toHaveBeenCalledExactlyOnceWith({ query: '活動b大樓', limit: 5 });
    const read = eventRead(['x', 'a', 'b']);
    read.items[2].location = '更新的主顧樓';
    read.items[2].title = '原活動的新名稱';
    freshReaders(fixture, read);
    const reply = await retry(fixture, taskRetry!);
    expect(fixture.adapter.publicCampus).toHaveBeenCalledExactlyOnceWith('events', 5);
    expect(fixture.adapter.campusMap).toHaveBeenCalledExactlyOnceWith({ query: '更新的主顧樓', limit: 5 });
    expect(reply.taskPlan.steps[1]).toMatchObject({ status: 'completed', label: '查原選定活動的位置' });
    expect(reply.answer).toContain('原活動的新名稱｜活動地點：更新的主顧樓');
    expect(reply.taskRetry).toBeUndefined();
  });

  it('keeps the original identity when an event disappears and can later read its new location', async () => {
    const { fixture, taskRetry } = await prepare();
    freshReaders(fixture, eventRead(['x', 'a']));
    const missing = await retry(fixture, taskRetry!);
    expect(fixture.adapter.campusMap).not.toHaveBeenCalled();
    expect(missing.taskPlan.steps[1]).toMatchObject({ status: 'blocked', summary: expect.stringContaining('已找不到原選定活動') });
    expect(payload(missing.taskRetry!).eventMapSelections).toEqual({ 'task-2': originalTarget });
    const read = eventRead(['x', 'a', 'b']);
    read.items[2].location = '重新公告大樓';
    freshReaders(fixture, read);
    const recovered = await retry(fixture, missing.taskRetry!, now + 2000);
    expect(fixture.adapter.campusMap).toHaveBeenCalledExactlyOnceWith({ query: '重新公告大樓', limit: 5 });
    expect(recovered.taskPlan.steps[1].status).toBe('completed');
  });

  it.each(['partial', 'unordered', 'source-changed', 'location-missing', 'unavailable'] as const)(
    'blocks %s source evidence without replacing the signed identity', async mode => {
      const { fixture, taskRetry } = await prepare();
      const read = eventRead(['x', 'a', 'b'], mode === 'source-changed' ? 'school-events' : 'school-club-events');
      if (mode === 'partial') read.partial = true;
      if (mode === 'unordered') read.items.reverse();
      if (mode === 'location-missing') delete read.items[2].location;
      if (mode === 'unavailable') {
        read.status = 'unavailable';
        read.items = [];
        read.unavailable = 'SOURCE_UNAVAILABLE';
      }
      freshReaders(fixture, read);
      const reply = await retry(fixture, taskRetry!);
      expect(fixture.adapter.campusMap).not.toHaveBeenCalled();
      expect(reply.taskPlan.steps[1].status).toBe('blocked');
      expect(reply.taskRetry?.stepIds).toContain('task-2');
      expect(payload(reply.taskRetry!).eventMapSelections).toEqual({ 'task-2': originalTarget });
      if (mode === 'source-changed') expect(reply.taskPlan.steps[1].summary).toContain('資料來源已變更');
    });

  it('captures an initial selection with no location before allowing a later retry', async () => {
    const read = eventRead();
    delete read.items[1].location;
    const { fixture, taskRetry, plan } = await prepare(read);
    expect(fixture.adapter.campusMap).not.toHaveBeenCalled();
    expect(plan.steps[1].status).toBe('blocked');
    expect(payload(taskRetry!).eventMapSelections).toEqual({ 'task-2': originalTarget });
    const fresh = eventRead(['x', 'a', 'b']);
    fresh.items[2].location = '補齊的地點';
    freshReaders(fixture, fresh);
    const reply = await retry(fixture, taskRetry!);
    expect(fixture.adapter.campusMap).toHaveBeenCalledExactlyOnceWith({ query: '補齊的地點', limit: 5 });
    expect(reply.taskPlan.steps[1].status).toBe('completed');
  });

  it.each(['partial', 'unordered', 'ordinal-missing'] as const)(
    'does not issue a map continuation when the initial %s list cannot identify the selection', async mode => {
      const read = eventRead(mode === 'ordinal-missing' ? ['a'] : ['a', 'b']);
      if (mode === 'partial') read.partial = true;
      if (mode === 'unordered') read.items.reverse();
      const { fixture, taskRetry, plan } = await prepare(read);
      expect(fixture.adapter.campusMap).not.toHaveBeenCalled();
      expect(plan.steps[1].status).toBe('blocked');
      expect(taskRetry?.stepIds ?? []).not.toContain('task-2');
      if (mode === 'partial') {
        expect(taskRetry?.stepIds).toEqual(['task-1']);
        freshReaders(fixture, eventRead(['x', 'a', 'b']));
        await expect(retry(fixture, taskRetry!)).rejects.toMatchObject({ code: 'TASK_RETRY_INVALID' });
        expect(fixture.adapter.publicCampus).not.toHaveBeenCalled();
        expect(fixture.adapter.campusMap).not.toHaveBeenCalled();
      } else expect(taskRetry).toBeNull();
    });

  it('rejects a changed event identity before reading any source', async () => {
    const { fixture, taskRetry } = await prepare();
    const changed = { ...payload(taskRetry!), eventMapSelections: { 'task-2': { ...originalTarget, id: 'a' } } };
    const body = Buffer.from(canonical(changed)).toString('base64url');
    freshReaders(fixture, eventRead(['x', 'a', 'b']));
    await expect(retry(fixture, { ...taskRetry!, token: body + '.' + taskRetry!.token.split('.')[1] }))
      .rejects.toMatchObject({ code: 'TASK_RETRY_INVALID' });
    expect(fixture.adapter.publicCampus).not.toHaveBeenCalled();
    expect(fixture.adapter.campusMap).not.toHaveBeenCalled();
  });

  it('rejects an older signed ordinal-only map continuation instead of reselecting its index', async () => {
    const fixture = fixtureAdapter();
    freshReaders(fixture, eventRead(['x', 'a', 'b']));
    const expiresAt = now + 15 * 60 * 1000;
    const token = signed({ version: 1, binding: hash(binding), question, parsedAt: now, expiresAt,
      requestHash: hash(crossServiceRequest(question, now, binding.schoolId)), stepIds: ['task-2'] });
    await expect(retry(fixture, { version: 1, token, stepIds: ['task-2'], expiresAt }))
      .rejects.toMatchObject({ code: 'TASK_RETRY_INVALID' });
    expect(fixture.adapter.publicCampus).not.toHaveBeenCalled();
    expect(fixture.adapter.campusMap).not.toHaveBeenCalled();
  });

  it.each([
    { 'task-2': { ...originalTarget, schoolId: 'other-school' } },
    { 'task-2': { ...originalTarget, location: 'client-chosen-building' } },
    { 'task-1': originalTarget },
    {},
  ])('rejects invalid signed selection metadata %# without source access', async eventMapSelections => {
    const { fixture, taskRetry } = await prepare();
    freshReaders(fixture, eventRead());
    await expect(retry(fixture, { ...taskRetry!, token: signed({ ...payload(taskRetry!), eventMapSelections }) }))
      .rejects.toMatchObject({ code: 'TASK_RETRY_INVALID' });
    expect(fixture.adapter.publicCampus).not.toHaveBeenCalled();
    expect(fixture.adapter.campusMap).not.toHaveBeenCalled();
  });
});
