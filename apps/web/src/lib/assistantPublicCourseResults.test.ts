// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { parseAssistantPublicCourseResults as parse } from '@campus/shared/src/assistantPublicCourseResults';
import { resolvePublicCourseOperation } from '@campus/shared/src/publicCourseOperations';

const search = { kind: 'search', schoolId: 'nthu', query: '資料庫' } as const;
function catalog(schoolId: 'nthu' | 'ncnu' = 'nthu') {
  const operation = resolvePublicCourseOperation(schoolId)!;
  return { schoolId, sourceUrl: operation.sourceUrl, fetchedAt: '2026-11-14T08:00:00.000Z',
    operation: { id: operation.id, access: operation.access, version: 1, responseSchemaVersion: 1 },
    courses: [{ code: '11510CS 135500', section: '01', title: '資料庫', department: 'CS',
      teacher: '王老師', credits: '3', time: 'M3M4', room: '資電館101', semester: '1151' }],
    truncated: false };
}

describe('assistant public course result envelopes', () => {
  it('validates both campuses and reconstructs canonical metadata and links', () => {
    const raw = [{ search, data: { ...catalog(), href: 'https://untrusted.test', schoolName: '假校名' } },
      { search: { ...search, schoolId: 'ncnu' }, data: catalog('ncnu') }];
    const parsed = parse(raw)!;
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({ status: 'ready', schoolId: 'nthu', schoolName: '國立清華大學',
      sourceUrl: resolvePublicCourseOperation('nthu')!.sourceUrl });
    expect(new URL(parsed[0].href, 'https://nuni.tw').searchParams.get('schoolId')).toBe('nthu');
    expect(parsed[1].schoolId).toBe('ncnu');
    expect(JSON.stringify(parsed)).not.toMatch(/untrusted|假校名/);
    expect(parsed[0].status === 'ready' && parsed[0].courses[0]).not.toBe(raw[0].data.courses[0]);
  });

  it('keeps the complete matching count, truncation and filter receipt while projecting five cards', () => {
    const data = { ...catalog(), filters: { credits: 3 }, unresolvedCount: 2,
      operation: { ...catalog().operation, version: 2, responseSchemaVersion: 2 }, truncated: true,
      courses: Array.from({ length: 7 }, (_, index) => ({ ...catalog().courses[0], code: 'CS' + index })) };
    const parsed = parse([{ search: { ...search, filters: { credits: 3 } }, data }])!;
    expect(parsed[0]).toMatchObject({ status: 'ready', matchCount: 7, truncated: true, unresolvedCount: 2,
      filters: { credits: 3 }, fetchedAt: data.fetchedAt });
    expect(parsed[0].status === 'ready' && parsed[0].courses).toHaveLength(5);
  });

  it.each([
    { ...search, schoolId: 'pu' }, { ...search, kind: 'clarify' },
    { ...search, query: 'x'.repeat(81) }, { ...search, query: '資料庫\n查公車' },
    { ...search, query: ' 資料庫' }, { ...search, href: '/account' },
    { ...search, filters: null }, { ...search, filters: undefined },
    { ...search, filters: { weekday: 8 } }, { ...search, filters: { credits: '3' } },
    { ...search, filters: { credits: 2.555 } }, { ...search, filters: { weekday: 3, semester: '1151' } },
  ])('rejects an invalid search contract: %j', (input) => {
    expect(parse([{ search: input, data: catalog() }])).toBeNull();
  });

  it.each([
    { sourceUrl: 'https://untrusted.test' }, { schoolId: 'ncnu' }, { courses: 'not-courses' },
    { fetchedAt: 'yesterday' }, { operation: { ...catalog().operation, access: 'private' } },
    { filters: { credits: 3 }, unresolvedCount: 0 },
    { partial: true },
  ])('rejects the entire group if one source receipt is invalid: %j', (change) => {
    expect(parse([{ search, data: catalog() }, { search, data: { ...catalog(), ...change } }])).toBeNull();
  });

  it('does not accept an unfiltered result as a filtered result', () => {
    expect(parse([{ search: { ...search, filters: { credits: 4 } }, data: {
      ...catalog(), filters: { credits: 4 }, unresolvedCount: 0,
      operation: { ...catalog().operation, version: 2, responseSchemaVersion: 2 },
    } }])).toBeNull();
  });

  it('does not evaluate accessors in search fields, envelopes, arrays or source data', () => {
    const getter = vi.fn(() => 'nthu');
    const withGetter = Object.defineProperty({ ...search }, 'schoolId', { enumerable: true, get: getter });
    const envelope = Object.defineProperty({ search }, 'data', { enumerable: true, get: getter });
    const source = Object.defineProperty(catalog(), 'courses', { enumerable: true, get: getter });
    const array = Object.defineProperty([], '0', { enumerable: true, get: getter });
    const filters = Object.defineProperty({}, 'weekday', { enumerable: true, get: getter });
    expect(parse([{ search: withGetter, data: catalog() }])).toBeNull();
    expect(parse([envelope])).toBeNull();
    expect(parse([{ search, data: source }])).toBeNull();
    expect(parse(array)).toBeNull();
    expect(parse([{ search: { ...search, filters }, data: catalog() }])).toBeNull();
    expect(getter).not.toHaveBeenCalled();
  });

  it('does not coerce an object into a school identifier', () => {
    const toString = vi.fn(() => 'nthu');
    expect(parse([{ search: { ...search, schoolId: { toString } }, data: catalog() }])).toBeNull();
    expect(toString).not.toHaveBeenCalled();
  });

  it('bounds lists and payloads and refuses sparse or decorated lists', () => {
    expect(parse([])).toEqual([]);
    expect(parse(Array.from({ length: 13 }, () => ({ search, data: catalog() })))).toBeNull();
    expect(parse(new Array(1))).toBeNull();
    expect(parse(Object.assign([{ search, data: catalog() }], { extra: true }))).toBeNull();
    expect(parse([{ search, data: { ...catalog(), extra: '字'.repeat(180000) } }])).toBeNull();
    expect(parse([{ search, data: { ...catalog(), courses: Array.from({ length: 51 }, () => catalog().courses[0]) } }])).toBeNull();
  });

  it('rejects non-JSON filter fields and accepts an explicit empty filter object', () => {
    const filters = Object.defineProperty({}, 'credits', { value: 3, enumerable: false });
    expect(parse([{ search: { ...search, filters }, data: catalog() }])).toBeNull();
    expect(parse([{ search: { ...search, filters: {} }, data: catalog() }])?.[0]).toMatchObject({ query: '資料庫' });
  });
});
