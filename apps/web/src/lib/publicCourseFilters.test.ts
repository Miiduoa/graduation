// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  evaluatePublicCourseFilters,
  parsePublicCourseFilterParams,
  parsePublicCourseFilters,
  publicCourseWeekdays,
} from '@campus/shared/src/publicCourseFilters';
import {
  isPublicCourseCatalog,
  type PublicCatalogCourse,
} from '@campus/shared/src/publicCourseCatalog';
import { resolvePublicCourseOperation } from '@campus/shared/src/publicCourseOperations';
import {
  publicCourseAssistantRead,
  formatPublicCourseAssistantRead,
} from '@campus/shared/src/publicCourseAssistant';
import { isPublicCourseResponseUrl } from '@campus/shared/src/publicCourseAssistantClient';

const course: PublicCatalogCourse = {
  code: '11510CS  235101',
  section: '01',
  title: '資料結構',
  department: 'CS',
  teacher: '王老師',
  time: 'W3W4\nF5',
  room: 'R1\nR2',
  semester: '1151',
  credits: '3.00',
  meetings: [
    { time: 'W3W4', room: 'R1' },
    { time: 'F5', room: 'R2' },
  ],
};
const filters = { weekday: 3, credits: 3 };
function result() {
  const operation = resolvePublicCourseOperation('nthu', 2)!;
  return {
    schoolId: 'nthu',
    sourceUrl: operation.sourceUrl,
    operation: { id: operation.id, version: 2, responseSchemaVersion: 2, access: operation.access },
    fetchedAt: '2026-11-07T13:00:00.000Z',
    courses: [course],
    filters,
    unresolvedCount: 2,
    truncated: false,
  };
}

describe('public course filters', () => {
  it.each([
    ['weekday=3&credits=2.50', { weekday: 3, credits: 2.5 }],
    ['credits=0', { credits: 0 }],
    ['credits=40', { credits: 40 }],
    ['', {}],
  ])(
    'reads explicit numeric conditions without confusing zero and unset: %s',
    (query, expected) => {
      expect(parsePublicCourseFilterParams(new URLSearchParams(query))).toEqual(expected);
    },
  );
  it.each([
    'weekday=0',
    'weekday=8',
    'weekday=',
    'weekday=3&weekday=3',
    'weekday=3.0',
    'credits=',
    'credits=3&credits=3',
    'credits=41',
    'credits=-1',
    'credits=2.555',
    'credits=Infinity',
    'credits=NaN',
    'credits=0x3',
    'credits=3e0',
    'credits=03',
  ])('refuses malformed conditions instead of widening the search: %s', (query) => {
    expect(parsePublicCourseFilterParams(new URLSearchParams(query))).toBeNull();
  });
  it('does not invoke getters or accept inherited, unknown, or undefined filter values', () => {
    let reads = 0;
    expect(
      parsePublicCourseFilters({
        get weekday() {
          reads += 1;
          return 3;
        },
      }),
    ).toBeNull();
    expect(reads).toBe(0);
    for (const value of [
      Object.create(filters),
      { semester: '1151' },
      { weekday: undefined },
      { credits: NaN },
      [],
      null,
    ]) {
      expect(parsePublicCourseFilters(value)).toBeNull();
    }
  });
  it('matches an actual day while keeping all meetings and unverified-term weekday evidence', () => {
    expect(publicCourseWeekdays(course, 'nthu')).toEqual([3, 5]);
    expect(publicCourseWeekdays({ ...course, semester: '1152' }, 'nthu')).toEqual([3, 5]);
    expect(evaluatePublicCourseFilters(course, 'nthu', filters)).toBe('match');
    expect(evaluatePublicCourseFilters(course, 'nthu', { weekday: 4 })).toBe('exclude');
    expect(course.meetings).toHaveLength(2);
    expect(
      evaluatePublicCourseFilters({ ...course, credits: '', meetings: [] }, 'nthu', filters),
    ).toBe('unresolved');
    expect(
      evaluatePublicCourseFilters({ ...course, credits: '2', meetings: [] }, 'nthu', filters),
    ).toBe('exclude');
    expect(evaluatePublicCourseFilters({ ...course, credits: '0' }, 'nthu', { credits: 0 })).toBe(
      'match',
    );
  });
});

describe('filtered response and handoff contract', () => {
  const search = { kind: 'search', schoolId: 'nthu', query: '資料', filters } as const;
  it('requires verifiable filtered data and preserves all original meetings in preview and handoff', () => {
    expect(isPublicCourseCatalog(result(), 'nthu', filters)).toBe(true);
    expect(isPublicCourseCatalog(result(), 'nthu')).toBe(false);
    const read = publicCourseAssistantRead(search, result());
    expect(read.status).toBe('ready');
    if (read.status !== 'ready') throw new Error('Expected read');
    expect(read.courses[0]).toEqual(course);
    expect(read.filters).toEqual(filters);
    expect(read.unresolvedCount).toBe(2);
    expect(Object.fromEntries(new URL(read.href, 'https://nuni.tw').searchParams)).toEqual({
      schoolId: 'nthu',
      campus: 'nthu',
      q: '資料',
      weekday: '3',
      credits: '3',
    });
    const content = formatPublicCourseAssistantRead(read);
    expect(content).toContain('星期三有課 · 3 學分');
    expect(content).toContain('星期三、星期五');
    expect(content).toContain('另有 2 筆');
  });
  it.each([
    { operation: undefined },
    { operation: { ...result().operation, version: 1, responseSchemaVersion: 1 } },
    { operation: { ...result().operation, responseSchemaVersion: 1 } },
    { filters: undefined },
    { filters: { weekday: 3 } },
    { filters: { ...filters, arbitrary: true } },
    { filters: { ...filters, weekday: 5 } },
    { unresolvedCount: undefined },
    { unresolvedCount: -1 },
    { unresolvedCount: 1.5 },
    { unresolvedCount: 20_001 },
    { courses: [{ ...course, credits: '2' }] },
    { courses: [{ ...course, meetings: [] }] },
  ])('does not accept dropped or fabricated conditions: %j', (patch) => {
    expect(isPublicCourseCatalog({ ...result(), ...patch }, 'nthu', filters)).toBe(false);
  });
  it.each([
    ['schoolId=nthu&q=資料&weekday=3&credits=3', true],
    ['schoolId=nthu&q=資料&weekday=3&credits=3.0', true],
    ['schoolId=nthu&q=資料', false],
    ['schoolId=nthu&q=資料&weekday=5&credits=3', false],
    ['schoolId=nthu&q=資料&weekday=3&credits=3&credits=3', false],
    ['schoolId=nthu&q=資料&weekday=3&credits=3&_=1', false],
    ['schoolId=ncnu&q=資料&weekday=3&credits=3', false],
  ])('pins native response parameters including every filter: %s', (query, valid) => {
    expect(
      isPublicCourseResponseUrl('https://nuni.tw/api/public-course-catalog?' + query, search),
    ).toBe(valid);
  });
});
