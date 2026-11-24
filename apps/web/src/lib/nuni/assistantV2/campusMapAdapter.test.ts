// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDocsFromServer, type Firestore } from 'firebase/firestore';
import { PROVIDENCE_CAMPUS_PLACES } from '@campus/shared/src/providenceCampus';
import type { PublicCampusReadGuard } from '../../publicCampusReadGuard';
import { V2Error } from './contracts';
import { readCampusMap, CAMPUS_MAP_SOURCE_LIMIT } from './campusMapAdapter';

vi.mock('firebase/firestore', () => ({
  collection: (db: unknown, ...path: string[]) => ({ db, path: path.join('/') }),
  query: (ref: object, ...constraints: object[]) => ({ ...ref, constraints }),
  where: (field: string, op: string, value: unknown) => ({ field, op, value }),
  limit: (amount: number) => ({ limit: amount }), getDocsFromServer: vi.fn(),
}));
const anonymousDb = { mode: 'public-anonymous' } as unknown as Firestore;
const now = Date.parse('2026-11-17T03:00:00.000Z');
function doc(id: string, data: Record<string, unknown>, path = 'schools/pu/pois') {
  return { id, data: () => data, ref: { parent: { path } } };
}
const snapshot = (docs: ReturnType<typeof doc>[] = []) => ({ docs, empty: !docs.length });
function published(patch: Record<string, unknown> = {}) {
  return { name: '任垣樓', category: 'academic', lat: 24.226415, lng: 120.580067, schoolId: 'pu', ...patch };
}
function guard(): PublicCampusReadGuard {
  return { db: anonymousDb, beforeRead: vi.fn(), afterRead: vi.fn(), onIncomplete: vi.fn() };
}
const read = (query = '任垣樓501', inputGuard = guard(), schoolId = 'pu', limit = 5) =>
  readCampusMap({ schoolId, args: { query, limit }, guard: inputGuard, now });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getDocsFromServer).mockResolvedValue(snapshot([doc('renyuan-published', published())]) as never);
});

describe('map reader uses the current page sources', () => {
  it('reads the bound public collection through the given anonymous client and preserves actual room source details', async () => {
    vi.mocked(getDocsFromServer).mockResolvedValue(snapshot([doc('renyuan-published', published({ floor: '2F', facilities: ['無障礙電梯'] }))]) as never);
    const limits = guard();
    const result = await read('任垣樓501', limits);
    expect(result).toMatchObject({ source: 'school-pois', sourcePath: 'schools/pu/pois', status: 'ready',
      resolution: 'matched', partial: false, query: '任垣樓501',
      items: [{ name: '任垣樓', lat: 24.226415, lng: 120.580067, floor: '2F', facilities: ['無障礙電梯'], match: 'building' }] });
    expect(getDocsFromServer).toHaveBeenCalledOnce();
    expect(vi.mocked(getDocsFromServer).mock.calls[0][0]).toEqual({ db: anonymousDb, path: 'schools/pu/pois',
      constraints: [{ limit: CAMPUS_MAP_SOURCE_LIMIT + 1 }] });
    expect(limits.beforeRead).toHaveBeenCalledOnce();
    expect(JSON.stringify(vi.mocked(getDocsFromServer).mock.calls)).not.toMatch(/users|favorites|session|token|registrations/);
    expect(JSON.stringify(vi.mocked(getDocsFromServer).mock.calls)).not.toContain('任垣樓501');
  });

  it('looks up legacy POIs only after a confirmed empty canonical collection, with an exact school filter', async () => {
    vi.mocked(getDocsFromServer).mockResolvedValueOnce(snapshot() as never)
      .mockResolvedValueOnce(snapshot([doc('legacy-renyuan', published(), 'pois')]) as never);
    const limits = guard(); const result = await read('任垣樓501', limits);
    expect(result).toMatchObject({ source: 'legacy-pois', sourcePath: 'pois', items: [{ id: 'legacy-renyuan' }] });
    expect(vi.mocked(getDocsFromServer).mock.calls[1][0]).toMatchObject({ db: anonymousDb, path: 'pois',
      constraints: expect.arrayContaining([{ field: 'schoolId', op: '==', value: 'pu' }]) });
    expect(limits.beforeRead).toHaveBeenCalledTimes(2);
  });

  it('uses the same actual Providence catalogue after both sources are empty, retaining its original OSM source', async () => {
    vi.mocked(getDocsFromServer).mockResolvedValue(snapshot() as never);
    const result = await read('PH101');
    const hall = PROVIDENCE_CAMPUS_PLACES.find(place => place.id === 'pu-zhugu')!;
    expect(result).toMatchObject({ source: 'bundled-providence', status: 'ready', partial: false, resolution: 'matched',
      items: [{ id: hall.id, name: hall.name, lat: hall.lat, lng: hall.lng,
        source: 'bundled-providence', sourceUrl: hall.sourceUrl, match: 'building', verification: 'cross-checked' }] });
    expect(result.items[0]).not.toHaveProperty('floor');
  });

  it('retains bundled places as explicitly incomplete if the public source fails, without probing a legacy collection', async () => {
    vi.mocked(getDocsFromServer).mockRejectedValueOnce(new Error('permission-denied'));
    const result = await read('PH101');
    expect(result).toMatchObject({ source: 'bundled-providence', status: 'ready', partial: true, resolution: 'partial',
      items: [{ id: 'pu-zhugu' }] });
    expect(getDocsFromServer).toHaveBeenCalledOnce();
    expect(vi.mocked(getDocsFromServer).mock.calls[0][0]).toMatchObject({ path: 'schools/pu/pois' });
  });

  it('keeps a known bundled map usable without a public Firestore configuration, without billing a query', async () => {
    const limits = guard(); delete limits.db;
    expect(await read('PH101', limits)).toMatchObject({ source: 'bundled-providence', partial: true, items: [{ id: 'pu-zhugu' }] });
    expect(limits.beforeRead).not.toHaveBeenCalled();
    expect(getDocsFromServer).not.toHaveBeenCalled();
  });

  it('does not mix Providence data into another school or confuse absent data with a verified nonexistent place', async () => {
    vi.mocked(getDocsFromServer).mockResolvedValue(snapshot() as never);
    expect(await read('PH101', guard(), 'nthu')).toMatchObject({ schoolId: 'nthu', status: 'unavailable',
      unavailable: 'NOT_CONNECTED', items: [], partial: false });
    const limits = guard(); delete limits.db;
    expect(await read('PH101', limits, 'nthu')).toMatchObject({ status: 'unavailable', unavailable: 'SOURCE_UNAVAILABLE', items: [], partial: true });
  });

  it('preserves an explicit not-found result when that school has other valid published places', async () => {
    vi.mocked(getDocsFromServer).mockResolvedValue(snapshot([doc('other', published({ schoolId: 'nthu', name: '資訊館' }), 'schools/nthu/pois')]) as never);
    expect(await read('PH101', guard(), 'nthu')).toMatchObject({ status: 'ready', items: [], resolution: 'unmatched', partial: false });
  });

  it('does not hide ambiguous buildings behind a one-item output limit', async () => {
    vi.mocked(getDocsFromServer).mockResolvedValue(snapshot([
      doc('first', published()), doc('second', published({ lat: 24.227415 })),
    ]) as never);
    expect(await read('任垣樓501')).toMatchObject({ resolution: 'ambiguous', partial: false, items: [{ id: 'first' }, { id: 'second' }] });
    expect(await read('任垣樓501', guard(), 'pu', 1)).toMatchObject({ resolution: 'partial', partial: true, items: [{ id: 'first' }] });
  });

  it('preserves ambiguity when an existing English name collides with another building', async () => {
    const place = PROVIDENCE_CAMPUS_PLACES.find(item => item.id === 'pu-renyuan')!;
    const name = 'Anthony Kuo Hall';
    const query = name + ' 303';
    const catalog = doc(place.id, { ...place, name });
    const direct = doc('imported-building', published({ name: '教學館', building: name }));
    vi.mocked(getDocsFromServer).mockResolvedValue(snapshot([catalog, direct]) as never);
    expect(await read(query)).toMatchObject({
      resolution: 'ambiguous', partial: false, items: [
        { id: 'imported-building', match: 'building' }, { id: place.id, match: 'building' },
      ],
    });

    vi.mocked(getDocsFromServer).mockResolvedValue(snapshot([doc(place.id, place)]) as never);
    expect(await read(query)).toMatchObject({
      resolution: 'matched', partial: false, items: [{ id: place.id, match: 'building' }],
    });
  });

  it('preserves a published place name alongside another place with the same building name', async () => {
    const place = PROVIDENCE_CAMPUS_PLACES.find(item => item.id === 'pu-library')!;
    const name = 'Luking Library';
    const library = doc(place.id, { ...place, name });
    const teachingHall = doc('imported-building', published({ name: '教學館', building: name }));
    vi.mocked(getDocsFromServer).mockResolvedValue(snapshot([library, teachingHall]) as never);
    expect(await read(name)).toMatchObject({
      resolution: 'ambiguous', partial: false, items: [
        { id: place.id, match: 'place' }, { id: 'imported-building', match: 'building' },
      ],
    });
  });

  it('preserves a published building text match alongside a place with the same name', async () => {
    const place = PROVIDENCE_CAMPUS_PLACES.find(item => item.id === 'pu-wenxing')!;
    const name = 'Bishop Kupfer Hall';
    vi.mocked(getDocsFromServer).mockResolvedValue(snapshot([
      doc(place.id, { ...place, building: name }),
      doc('imported-building', published({ name })),
    ]) as never);
    expect(await read(name)).toMatchObject({
      resolution: 'ambiguous', partial: false, items: [
        { id: 'imported-building', match: 'place' }, { id: place.id, match: 'search' },
      ],
    });
  });

  it.each([
    ['pu-renyuan', 'AK', 'AK303', false, 'building'],
    ['pu-renyuan', 'AK303', 'AK303', false, 'place'],
    ['pu-wenxing', 'Bishop Kupfer Hall', 'Bishop Kupfer Hall 303', true, 'building'],
  ])('prefers the direct name over the catalog match for %s (%s)', async (id, name, query, rename, match) => {
    const place = PROVIDENCE_CAMPUS_PLACES.find(item => item.id === id)!;
    const catalog = doc(id, { ...place, name: rename ? name : place.name });
    const direct = doc('imported-building', published({ name }));
    vi.mocked(getDocsFromServer).mockResolvedValue(snapshot([catalog, direct]) as never);
    expect(await read(query, guard(), 'pu', 1)).toMatchObject({
      resolution: 'matched', partial: false, items: [{ id: 'imported-building', match }],
    });

    vi.mocked(getDocsFromServer).mockResolvedValue(snapshot([catalog]) as never);
    expect(await read(query)).toMatchObject({
      resolution: 'matched', partial: false, items: [{ id, match: rename ? match : 'building' }],
    });
  });

  it('does not label one fuzzy or single-source place a uniquely verified location', async () => {
    expect(await read('任垣')).toMatchObject({ resolution: 'candidates', items: [{ match: 'search' }] });
    vi.mocked(getDocsFromServer).mockResolvedValue(snapshot() as never);
    expect(await read('P1 停車場')).toMatchObject({ resolution: 'candidates', items: [{ verification: 'single-source' }] });
  });

  it('filters wrong-school, invalid, demo and wrong-path documents without treating missing rows as a complete source', async () => {
    const limits = guard();
    vi.mocked(getDocsFromServer).mockResolvedValue(snapshot([
      doc('valid', published()), doc('foreign', published({ schoolId: 'nthu', name: 'PRIVATE FOREIGN' })),
      doc('invalid', published({ lat: 91 })), doc('demo', published({ isDemo: true })),
      doc('wrong-path', published(), 'schools/nthu/pois'), doc('blank', published({ name: '' })),
    ]) as never);
    const result = await read('任垣樓501', limits);
    expect(result).toMatchObject({ status: 'ready', partial: true, resolution: 'partial', items: [{ id: 'valid' }] });
    expect(result.items).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain('PRIVATE FOREIGN');
    expect(getDocsFromServer).toHaveBeenCalledOnce();
    expect(limits.onIncomplete).toHaveBeenCalledOnce();
  });

  it('does not grant legacy data missing schoolId the selected school identity', async () => {
    const data: Record<string, unknown> = published(); delete data.schoolId;
    vi.mocked(getDocsFromServer).mockResolvedValueOnce(snapshot() as never)
      .mockResolvedValueOnce(snapshot([doc('missing-school', data, 'pois')]) as never);
    const result = await read('任垣樓501');
    expect(result.partial).toBe(true);
    expect(result.items.every(item => item.id !== 'missing-school')).toBe(true);
  });

  it('drops duplicate source identities instead of choosing whichever record appears first', async () => {
    vi.mocked(getDocsFromServer).mockResolvedValue(snapshot([
      doc('same', published({ schoolId: 'nthu' }), 'schools/nthu/pois'),
      doc('same', published({ schoolId: 'nthu', lat: 24.227415 }), 'schools/nthu/pois'),
    ]) as never);
    expect(await read('任垣樓501', guard(), 'nthu')).toMatchObject({ status: 'unavailable', partial: true, items: [] });
  });

  it('bounds the source scan and never treats its returned subset as a unique whole-campus match', async () => {
    vi.mocked(getDocsFromServer).mockResolvedValue(snapshot(Array.from({ length: CAMPUS_MAP_SOURCE_LIMIT + 1 }, (_, i) =>
      doc(`place-${i}`, published({ name: i === 0 ? '任垣樓' : `其他建築 ${i}` })))) as never);
    expect(await read('任垣樓501')).toMatchObject({ partial: true, resolution: 'partial', items: [{ id: 'place-0' }] });
    expect(getDocsFromServer).toHaveBeenCalledOnce();
  });

  it('does not mistake clipped display fields for a fully searched source', async () => {
    vi.mocked(getDocsFromServer).mockResolvedValue(snapshot([doc('long', published({ schoolId: 'nthu',
      name: '資訊館', description: '其他資訊'.repeat(100) + '校史室' }), 'schools/nthu/pois')]) as never);
    expect(await read('校史室', guard(), 'nthu')).toMatchObject({ status: 'ready', items: [], partial: true, resolution: 'partial' });
  });

  it('preserves actual server records instead of attaching bundled metadata merely because an ID collides', async () => {
    vi.mocked(getDocsFromServer).mockResolvedValue(snapshot([doc('pu-renyuan', published({ name: '另一棟', lat: 24.2, lng: 120.5 }))]) as never);
    const result = await read('另一棟');
    expect(result.items[0]).toMatchObject({ id: 'pu-renyuan', source: 'school-pois', verification: 'published', lat: 24.2, lng: 120.5 });
    expect(result.items[0]).not.toHaveProperty('sourceUrl');
  });
});

describe('map reads keep cancellation and budget boundaries', () => {
  it('rejects invalid or cross-school arguments before any source query', async () => {
    await expect(read('任垣樓', guard(), 'personal')).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(readCampusMap({ schoolId: 'pu', args: { query: '任垣樓', limit: 5, schoolId: 'nthu' } as never, guard: guard(), now }))
      .rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(getDocsFromServer).not.toHaveBeenCalled();
  });

  it('charges each underlying lookup and never hides the shared budget error with the bundled source', async () => {
    vi.mocked(getDocsFromServer).mockResolvedValue(snapshot() as never);
    let remaining = 1;
    const limits = guard();
    limits.beforeRead = () => { if (remaining-- === 0) throw new V2Error(429, 'API_BUDGET_EXCEEDED'); };
    await expect(read('PH101', limits)).rejects.toMatchObject({ code: 'API_BUDGET_EXCEEDED' });
    expect(getDocsFromServer).toHaveBeenCalledOnce();
  });

  it('does not publish late records or start a fallback query after a caller cancellation', async () => {
    let resolve!: (value: unknown) => void;
    vi.mocked(getDocsFromServer).mockReturnValueOnce(new Promise(done => { resolve = done; }) as never);
    const controller = new AbortController();
    const limits = guard(); limits.afterRead = () => controller.signal.throwIfAborted();
    const pending = read('PH101', limits);
    controller.abort(); resolve(snapshot());
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(getDocsFromServer).toHaveBeenCalledOnce();
  });

  it('does not fall back after the bound account becomes unavailable', async () => {
    const limits = guard(); let checks = 0;
    limits.afterRead = () => { if (++checks > 1) throw new V2Error(401, 'UNAUTHENTICATED'); };
    await expect(read('PH101', limits)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(getDocsFromServer).toHaveBeenCalledOnce();
  });
});
