// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { parseAssistantTaskPlan } from '@campus/shared/src/assistantTaskPlan';
import { getOfficialCampusMapUrl } from '@campus/shared/src/campusMapLookup';
import { campusMapHref, campusMapMatch, campusMapResolution, campusMapSourcePath,
  type CampusMapArguments, type CampusMapItem, type CampusMapRead } from './campusMap';
import { run, type RunInput } from './runner';
import { fixtureAdapter, fixtureBinding as binding, FIXTURE_NOW as now, FIXTURE_SECRET as secret } from './fixtures';
import { retryTaskReads } from './taskRetry';
import { V2Error } from './contracts';
import type { PublicCampusRead } from './publicCampus';

function mapRead(args: CampusMapArguments, options: { names?: string[]; partial?: boolean } = {}): CampusMapRead {
  const source = 'school-pois', sourcePath = campusMapSourcePath(binding.schoolId, source);
  const items = (options.names ?? [args.query]).map((name, index): CampusMapItem => {
    const place = { id: 'place-' + index, name, category: '教學大樓', description: '', lat: 24.2, lng: 120.58 };
    return { ...place, schoolId: binding.schoolId, facilities: ['電梯'], source, sourcePath,
      href: campusMapHref(binding.schoolId, args.query, place.id),
      match: campusMapMatch(binding.schoolId, args.query, place)!, verification: 'published' as const };
  });
  return { version: 1, kind: 'map', schoolId: binding.schoolId, query: args.query, limit: args.limit,
    checkedAt: new Date(now).toISOString(), source, sourcePath, status: 'ready', items,
    partial: options.partial ?? false, resolution: campusMapResolution(items, options.partial ?? false),
    href: campusMapHref(binding.schoolId, args.query),
    ...(getOfficialCampusMapUrl(binding.schoolId) ? { officialMapUrl: getOfficialCampusMapUrl(binding.schoolId)! } : {}) };
}

function locationFixture() {
  const fixture = fixtureAdapter();
  fixture.adapter.campusMap = vi.fn(async (args: CampusMapArguments) => mapRead(args));
  return fixture;
}

async function ask(question: string, fixture = locationFixture(), taskProfile?: RunInput['taskProfile']) {
  const model = vi.fn<RunInput['model']>().mockRejectedValue(new Error('Explicit map tasks must not call a model'));
  const reply = await run({ question, taskProfile, history: [], binding, adapter: fixture.adapter, model, secret, now,
    writes: true, signal: new AbortController().signal, log: () => {} });
  expect(model).not.toHaveBeenCalled();
  expect(reply).toMatchObject({ version: 2, modelCalls: 0, dataRead: true, cards: [] });
  const plan = parseAssistantTaskPlan('taskPlan' in reply ? reply.taskPlan : null);
  expect(plan).not.toBeNull();
  expect(fixture.writes).toEqual([]);
  expect(fixture.orderCalls).toEqual([]);
  return { reply, plan: plan! };
}

describe('cross-service classroom location execution', () => {
  it.each(['teacher', 'merchant', 'club', 'school', 'platform'] as const)(
    '%s reads its own next classroom alongside public information without student coursework', async taskProfile => {
      const fixture = locationFixture();
      const ledger = vi.spyOn(fixture.adapter, 'ledger');
      const courses = vi.spyOn(fixture.adapter, 'courses');
      const work = vi.spyOn(fixture.adapter, 'work');
      const { reply, plan } = await ask('查下一堂課，教室在哪裡，查學校電話', fixture, taskProfile);
      expect(reply).not.toHaveProperty('roleGuide');
      expect(ledger).toHaveBeenCalledOnce();
      expect(fixture.adapter.campusMap).toHaveBeenCalledExactlyOnceWith({ query: '資訊202', limit: 5 });
      expect(plan.steps.map(step => step.serviceId)).toEqual(['timetable', 'map', 'school-info']);
      // The synthetic fixture school is absent from the bundled public
      // directory. Its missing phone source cannot be reported as completed.
      expect(plan.steps.map(step => step.status)).toEqual(['completed', 'completed', 'blocked']);
      expect(reply.stopReason).toBe('TASKS_INCOMPLETE');
      expect(plan.steps[1].dependsOn).toEqual([plan.steps[0].id]);
      expect(courses).not.toHaveBeenCalled();
      expect(work).not.toHaveBeenCalled();
    },
  );

  it.each(['teacher', 'merchant', 'club', 'school', 'platform'] as const)(
    '%s can read a named map location without accessing any personal or student source', async taskProfile => {
      const fixture = locationFixture();
      const ledger = vi.spyOn(fixture.adapter, 'ledger');
      const courses = vi.spyOn(fixture.adapter, 'courses');
      const work = vi.spyOn(fixture.adapter, 'work');
      const { plan } = await ask('學生活動中心在哪裡', fixture, taskProfile);
      expect(plan.steps[0]).toMatchObject({ serviceId: 'map', status: 'completed' });
      expect(fixture.adapter.campusMap).toHaveBeenCalledExactlyOnceWith({ query: '學生活動中心', limit: 5 });
      expect(ledger).not.toHaveBeenCalled();
      expect(courses).not.toHaveBeenCalled();
      expect(work).not.toHaveBeenCalled();
    },
  );

  it('reads the next class, uses its exact classroom and completes independent dining', async () => {
    const fixture = locationFixture();
    const ledger = vi.spyOn(fixture.adapter, 'ledger');
    const { reply, plan } = await ask('查下一堂課，教室在哪裡，查餐廳', fixture);
    expect(ledger).toHaveBeenCalledOnce();
    expect(fixture.adapter.campusMap).toHaveBeenCalledExactlyOnceWith({ query: '資訊202', limit: 5 });
    expect(ledger.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(fixture.adapter.campusMap!).mock.invocationCallOrder[0]);
    expect(plan.steps.map(step => step.status)).toEqual(['completed', 'completed', 'completed']);
    expect(plan.steps[1].dependsOn).toEqual([plan.steps[0].id]);
    expect(plan.steps[1].href).toBe(campusMapHref(binding.schoolId, '資訊202'));
    expect(reply.answer).toContain('資料結構｜課表教室：資訊202');
    expect(reply.answer).toContain('24.2, 120.58');
    expect(reply.answer).toContain('尚未建立導航路線或計算到達時間');
  });

  it('queries a named campus place without reading any private ledger', async () => {
    const fixture = locationFixture();
    const ledger = vi.spyOn(fixture.adapter, 'ledger');
    const { plan } = await ask('任垣樓在哪裡', fixture);
    expect(ledger).not.toHaveBeenCalled();
    expect(fixture.adapter.campusMap).toHaveBeenCalledExactlyOnceWith({ query: '任垣樓', limit: 5 });
    expect(plan.steps[0]).toMatchObject({ serviceId: 'map', status: 'completed' });
  });

  it('preserves a long location answer when its encoded map link exceeds the task UI limit', async () => {
    const fixture = locationFixture(), query = '測'.repeat(119) + '樓';
    const { reply, plan } = await ask(query + '在哪裡', fixture);
    expect(plan.steps[0]).toMatchObject({ serviceId: 'map', status: 'completed' });
    expect(plan.steps[0].href).toBeUndefined();
    expect(reply.answer).toContain(query);
  });

  it.each(['missing-location', 'parallel', 'unplaced', 'no-source', 'foreign-school', 'no-next'] as const)(
    'does not guess a destination for %s, while keeping independent results', async mode => {
      const fixture = locationFixture(), snapshot = fixture.snapshot();
      if (mode === 'missing-location') snapshot.records = snapshot.records.map(record =>
        record.id === 'class-b' ? { ...record, location: undefined } : record);
      if (mode === 'parallel') snapshot.records.push({ ...snapshot.records[1], id: 'parallel', title: '另一堂課', location: '不能自選的大樓' });
      if (mode === 'unplaced') snapshot.records.push({ ...snapshot.records[1], id: 'unknown-time', startTime: undefined, endTime: undefined });
      if (mode === 'no-source') snapshot.records = snapshot.records.filter(record => record.kind !== 'timetable');
      if (mode === 'no-next') snapshot.records = snapshot.records.filter(record => record.id === 'class-a');
      fixture.adapter.ledger = async () => mode === 'foreign-school' ? { ...snapshot, schoolId: 'foreign-school' } : snapshot;
      const { reply, plan } = await ask('下一堂課教室在哪裡，查餐廳', fixture);
      expect(fixture.adapter.campusMap).not.toHaveBeenCalled();
      expect(plan.steps.find(step => step.serviceId === 'map')?.status).toBe('blocked');
      expect(plan.steps.find(step => step.serviceId === 'cafeteria')?.status).toBe('completed');
      expect(reply.answer).not.toContain('不能自選的大樓');
    });

  it('does not shift to another class when the next classroom source is invalid', async () => {
    const fixture = locationFixture(), snapshot = fixture.snapshot();
    snapshot.records = snapshot.records.map(record => record.id === 'class-b'
      ? { ...record, location: '資訊\u202e202' } : record);
    fixture.adapter.ledger = async () => snapshot;
    const { plan } = await ask('下一堂課教室在哪裡', fixture);
    expect(fixture.adapter.campusMap).not.toHaveBeenCalled();
    expect(plan.steps[1]).toMatchObject({ status: 'blocked', summary: expect.stringContaining('沒有改查其他課程') });
  });

  it('preserves partial, ambiguous and unmatched place results as unfinished tasks', async () => {
    for (const options of [{ partial: true }, { names: ['資訊202', '資訊202'] }, { names: [] }]) {
      const fixture = locationFixture();
      fixture.adapter.campusMap = vi.fn(async args => mapRead(args, options));
      const { reply, plan } = await ask('下一堂課教室在哪裡', fixture);
      expect(plan.steps[1].status).toBe(options.names?.length === 0 ? 'blocked' : 'partial');
      expect(reply.stopReason).toBe('TASKS_INCOMPLETE');
      expect('taskRetry' in reply && reply.taskRetry).toBeTruthy();
    }
  });

  it('rejects a cross-school or mismatched query result without losing an independent restaurant read', async () => {
    for (const overrides of [{ schoolId: 'foreign-school' }, { query: '另一個教室' }]) {
      const fixture = locationFixture();
      fixture.adapter.campusMap = vi.fn(async args => ({ ...mapRead(args), ...overrides }));
      const { plan } = await ask('任垣樓在哪裡，查餐廳', fixture);
      expect(plan.steps.find(step => step.serviceId === 'map')?.status).toBe('blocked');
      expect(plan.steps.find(step => step.serviceId === 'cafeteria')?.status).toBe('completed');
    }
  });

  it('rechecks the source class on retry and does not reuse the failed destination', async () => {
    const fixture = locationFixture();
    fixture.adapter.campusMap = vi.fn(async () => { throw new V2Error(503, 'CAMPUS_MAP_UNAVAILABLE'); });
    const { reply, plan } = await ask('下一堂課教室在哪裡，查餐廳', fixture);
    if (!('taskRetry' in reply) || !reply.taskRetry) throw new Error('Missing read continuation');
    const snapshot = fixture.snapshot();
    snapshot.records = snapshot.records.map(record => record.id === 'class-b' ? { ...record, location: '新教室301' } : record);
    fixture.adapter.ledger = vi.fn(async () => snapshot);
    fixture.adapter.campusMap = vi.fn(async args => mapRead(args));
    const result = await retryTaskReads({ token: reply.taskRetry.token,
      stepIds: [plan.steps.find(step => step.serviceId === 'map')!.id], binding, secret, now: now + 1000,
      adapter: fixture.adapter, signal: new AbortController().signal });
    expect(fixture.adapter.ledger).toHaveBeenCalledOnce();
    expect(fixture.adapter.campusMap).toHaveBeenCalledExactlyOnceWith({ query: '新教室301', limit: 5 });
    expect(result.taskPlan.steps.map(step => step.status)).toEqual(['completed', 'completed']);
    expect(result.cards).toEqual([]);
    expect(fixture.writes).toEqual([]);
  });
});

function eventRead(): PublicCampusRead {
  return { version: 1, kind: 'events', schoolId: binding.schoolId, source: 'school-club-events',
    sourcePath: `schools/${binding.schoolId}/clubEvents`, checkedAt: new Date(now).toISOString(),
    status: 'ready', partial: false, href: `/events?schoolId=${binding.schoolId}`,
    items: ['one', 'two'].map((id, index) => ({ id, schoolId: binding.schoolId, title: `活動 ${index + 1}`, summary: '',
      startsAt: `2026-11-05T${index ? '12' : '08'}:00:00.000Z`, location: index ? '主顧樓' : '任垣樓',
      href: `/events/${id}?schoolId=${binding.schoolId}&source=school-club-events` })) };
}

describe('cross-service event location execution', () => {
  it('uses the exact requested ordinal in the verified ordered activity source', async () => {
    const fixture = locationFixture();
    fixture.adapter.publicCampus = vi.fn(async () => eventRead());
    const ledger = vi.spyOn(fixture.adapter, 'ledger');
    const { reply, plan } = await ask('查近期活動，查第二個活動位置，查餐廳', fixture);
    expect(fixture.adapter.publicCampus).toHaveBeenCalledExactlyOnceWith('events', 5);
    expect(fixture.adapter.campusMap).toHaveBeenCalledExactlyOnceWith({ query: '主顧樓', limit: 5 });
    expect(ledger).not.toHaveBeenCalled();
    expect(plan.steps[1]).toMatchObject({ status: 'completed', dependsOn: [plan.steps[0].id] });
    expect(reply.answer).toContain('活動 2｜活動地點：主顧樓');
  });

  it('blocks ordinal selection from partial, unordered or missing-location evidence without choosing another event', async () => {
    for (const mode of ['partial', 'unordered', 'missing'] as const) {
      const fixture = locationFixture(), read = eventRead();
      if (mode === 'partial') read.partial = true;
      if (mode === 'unordered') read.items.reverse();
      if (mode === 'missing') delete read.items[0].location;
      fixture.adapter.publicCampus = vi.fn(async () => read);
      const { plan } = await ask('查近期活動，查第一個活動在哪裡，查餐廳', fixture);
      expect(fixture.adapter.campusMap).not.toHaveBeenCalled();
      expect(plan.steps[1].status).toBe('blocked');
      expect(plan.steps[2].status).toBe('completed');
    }
  });

  it('does not substitute a different event when the requested ordinal is absent', async () => {
    const fixture = locationFixture();
    fixture.adapter.publicCampus = vi.fn(async () => eventRead());
    const { reply, plan } = await ask('查近期活動，查第五個活動在哪裡', fixture);
    expect(fixture.adapter.campusMap).not.toHaveBeenCalled();
    expect(plan.steps[1].status).toBe('blocked');
    expect(reply.answer).toContain('沒有第 5 筆活動');
  });

  it('rereads the same activity list on retry and derives the new source location', async () => {
    const fixture = locationFixture();
    fixture.adapter.publicCampus = vi.fn(async () => eventRead());
    fixture.adapter.campusMap = vi.fn(async () => { throw new V2Error(503, 'CAMPUS_MAP_UNAVAILABLE'); });
    const { reply, plan } = await ask('查近期活動，查第一個活動在哪裡', fixture);
    if (!('taskRetry' in reply) || !reply.taskRetry) throw new Error('Missing activity location retry');
    const fresh = eventRead();
    fresh.items[0].location = '更正大樓';
    fixture.adapter.publicCampus = vi.fn(async () => fresh);
    fixture.adapter.campusMap = vi.fn(async args => mapRead(args));
    const result = await retryTaskReads({ token: reply.taskRetry.token, stepIds: [plan.steps[1].id], binding, secret,
      now: now + 1000, adapter: fixture.adapter, signal: new AbortController().signal });
    expect(fixture.adapter.publicCampus).toHaveBeenCalledExactlyOnceWith('events', 5);
    expect(fixture.adapter.campusMap).toHaveBeenCalledExactlyOnceWith({ query: '更正大樓', limit: 5 });
    expect(result.taskPlan.steps.map(step => step.status)).toEqual(['completed', 'completed']);
    expect(result.cards).toEqual([]);
  });
});
