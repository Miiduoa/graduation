import { expect, it } from 'vitest';
import {
  buildCampusClassroomMapHref,
  MAX_CAMPUS_CLASSROOM_QUERY_LENGTH,
  normalizeCampusClassroomQuery,
  resolveCampusClassroom,
} from '@campus/shared/src/campusClassroomLookup';
import type { CampusMapPlaceLike } from '@campus/shared/src/providenceCampus';

const hall: CampusMapPlaceLike = {
  id: 'school-a-hall',
  name: '主顧樓',
  category: '教學',
  description: '',
  lat: 24.2,
  lng: 120.5,
};
const places = [
  hall,
  { ...hall, id: 'chapel', name: '主顧聖母堂' },
  { ...hall, id: 'bus', name: '靜宜大學主顧樓', category: '公車' },
];

it('builds a bounded, explicitly scoped search without changing visible room wording', () => {
  const location = '主顧樓 ＰＨ３０３ & #北側';
  const href = buildCampusClassroomMapHref({ schoolId: 'school-a', location });
  const url = new URL(href!, 'https://campus.example');
  expect(url.pathname).toBe('/map');
  expect([...url.searchParams.keys()]).toEqual(['schoolId', 'query']);
  expect(url.searchParams.get('schoolId')).toBe('school-a');
  expect(url.searchParams.get('query')).toBe(location);
  expect(url.hash).toBe('');
});

it('strips controls, collapses whitespace, and bounds Unicode text without splitting characters', () => {
  expect(normalizeCampusClassroomQuery(' \u0000主顧樓\tPH303\u202e\r\n ')).toBe('主顧樓 PH303');
  expect(normalizeCampusClassroomQuery(['主顧303'])).toBe('');
  const text = normalizeCampusClassroomQuery('🏫'.repeat(200));
  expect(Array.from(text)).toHaveLength(MAX_CAMPUS_CLASSROOM_QUERY_LENGTH);
  expect(text.endsWith('🏫')).toBe(true);
});

it.each([
  null,
  undefined,
  '',
  'all',
  'personal',
  'unavailable-campus',
  '../pu',
  'PU',
  'pu&schoolId=other',
])('does not construct a destination or resolve a point for invalid scope %s', (schoolId) => {
  expect(buildCampusClassroomMapHref({ schoolId, location: '主顧303' })).toBeNull();
  expect(resolveCampusClassroom({ schoolId, query: '主顧303', locations: places }).matches).toEqual(
    [],
  );
});

it.each([undefined, null, '', '\u0000\r\n '])(
  'does not construct a link for an empty room %s',
  (location) => {
    expect(buildCampusClassroomMapHref({ schoolId: 'school-a', location })).toBeNull();
    expect(
      resolveCampusClassroom({ schoolId: 'school-a', query: location, locations: places }).status,
    ).toBe('empty');
  },
);

it.each(['主顧樓', '主顧303', '主顧樓 PH303', '主顧樓 ＰＨ３０３', '主顧大樓303'])(
  'uses only the supplied building label and complete room suffix for %s',
  (query) => {
    const actual = query === '主顧大樓303' ? [{ ...hall, name: '主顧大樓' }] : places;
    const result = resolveCampusClassroom({ schoolId: 'school-a', query, locations: actual });
    expect(result.status).toBe('matched');
    expect(result.matches).toEqual([actual[0]]);
    expect(result.matches[0]).toBe(actual[0]);
    expect(result.query).toBe(query);
    expect(result.matches[0].floor).toBeUndefined();
  },
);

it('uses a provided building field without interpreting the room code or fabricating a floor', () => {
  const point = { ...hall, name: '服務中心', building: '管理大樓', floor: '依現場標示' };
  const result = resolveCampusClassroom({
    schoolId: 'school-a',
    query: '管理 M302',
    locations: [point],
  });
  expect(result.status).toBe('matched');
  expect(result.matches[0]).toBe(point);
  expect(result.matches[0].floor).toBe('依現場標示');
});

it.each(['PH303', 'ＰＨ３０３', 'ph 303', 'PH-303', 'PH：303'])(
  'resolves verified PU code %s only against current campus POIs', (query) => {
    const result = resolveCampusClassroom({ schoolId: 'pu', query, locations: places });
    expect(result.status).toBe('matched');
    expect(result.matches).toEqual([hall]);
    expect(result.matches[0]).toBe(hall);
    expect(result.matches[0].floor).toBeUndefined();
  },
);

it('accepts the exact bilingual name, but not an approximate venue description', () => {
  const english = { ...hall, id: 'english', name: 'Providence Hall' };
  const nearby = { ...hall, id: 'nearby', name: '主顧樓旁廣場' };
  const result = resolveCampusClassroom({ schoolId: 'pu', query: 'PH303', locations: [english, nearby] });
  expect(result.status).toBe('matched');
  expect(result.matches).toEqual([english]);
});

it('does not cross school scopes or populate a missing school catalog', () => {
  expect(resolveCampusClassroom({ schoolId: 'school-a', query: 'PH303', locations: places }).status).toBe('unmatched');
  expect(resolveCampusClassroom({
    schoolId: 'pu', query: 'PH303', locations: [{ ...hall, schoolId: 'school-b' }],
  }).status).toBe('unmatched');
  expect(resolveCampusClassroom({ schoolId: 'pu', query: 'PH303', locations: [] }).status).toBe('unmatched');
});

it('requires a deliberate choice when two valid POIs describe the coded building', () => {
  const desk = { ...hall, id: 'desk', name: '服務台', building: '主顧樓' };
  const result = resolveCampusClassroom({ schoolId: 'pu', query: 'PH303', locations: [hall, desk] });
  expect(result.status).toBe('ambiguous');
  expect(result.matches).toEqual([hall, desk]);
});

it.each(['PH', 'PHxyz303', 'PHAB303', 'PH303旁', 'PH303 / 任垣201', 'SP303', 'AK303', 'R201'])(
  'leaves incomplete, unverified, or composite PU code %s unresolved', (query) => {
    expect(resolveCampusClassroom({ schoolId: 'pu', query, locations: places }).status).toBe('unmatched');
  },
);

it.each(['ZZ303', 'R201', '303', '主顧', '主顧樓旁邊', '主顧樓 PH303 / 任垣201', '線上課程'])(
  'leaves an unknown or incomplete room unresolved: %s',
  (query) => {
    expect(resolveCampusClassroom({ schoolId: 'school-a', query, locations: places })).toEqual({
      query,
      status: 'unmatched',
      matches: [],
    });
  },
);

it('keeps every matching POI ambiguous instead of taking the first building or facility', () => {
  const desk = { ...hall, id: 'help-desk', name: '服務台', building: '主顧樓' };
  for (const locations of [
    [hall, desk],
    [desk, hall],
  ]) {
    const result = resolveCampusClassroom({
      schoolId: 'school-a',
      query: '主顧樓 PH303',
      locations,
    });
    expect(result.status).toBe('ambiguous');
    expect(new Set(result.matches.map((place) => place.id))).toEqual(new Set([hall.id, desk.id]));
  }
});

it('does not load Providence points when the current campus catalog is empty', () => {
  for (const schoolId of ['pu', 'school-b']) {
    expect(resolveCampusClassroom({ schoolId, query: '主顧303', locations: [] }).status).toBe(
      'unmatched',
    );
  }
});

it('rejects an explicitly different school and keeps colliding IDs from selecting a wrong point', () => {
  const other = { ...hall, schoolId: 'school-b' };
  expect(
    resolveCampusClassroom({ schoolId: 'school-a', query: '主顧303', locations: [other] }).status,
  ).toBe('unmatched');
  const collision = { ...hall, name: '另一棟樓', lat: 25 };
  expect(
    resolveCampusClassroom({ schoolId: 'school-a', query: '主顧303', locations: [collision, hall] })
      .matches,
  ).toEqual([]);
});

it('does not turn a bad coordinate or descriptive mention into a navigable match', () => {
  const invalid = { ...hall, lat: Number.NaN };
  const mention = { ...hall, name: '餐廳', description: '位在主顧樓附近', facilities: ['主顧303'] };
  expect(
    resolveCampusClassroom({ schoolId: 'school-a', query: '主顧303', locations: [invalid] }).status,
  ).toBe('unmatched');
  expect(
    resolveCampusClassroom({ schoolId: 'school-a', query: '主顧303', locations: [mention] }).status,
  ).toBe('unmatched');
});

it('does not confuse a Latin prefix with a complete building name', () => {
  const lab = { ...hall, name: 'Lab' };
  expect(
    resolveCampusClassroom({ schoolId: 'school-a', query: 'Laboratory101', locations: [lab] })
      .status,
  ).toBe('unmatched');
  expect(
    resolveCampusClassroom({ schoolId: 'school-a', query: 'Lab 101', locations: [lab] }).status,
  ).toBe('matched');
});

it.each([
  ['R1', 'R101', 'unmatched'],
  ['R1', 'R1A01', 'unmatched'],
  ['R1', 'Ｒ１０１', 'unmatched'],
  ['R1', 'R1 01', 'matched'],
  ['R1', 'R1-01', 'matched'],
  ['R1', 'R1教室01', 'matched'],
  ['R1', 'R1室01', 'matched'],
  ['教學1樓', '教學101', 'unmatched'],
  ['教學1樓', '教學1 01', 'matched'],
  ['教學1樓', '教學1樓01', 'matched'],
] as const)(
  'requires an explicit boundary after digit-ending building %s in %s',
  (name, query, status) => {
    expect(
      resolveCampusClassroom({
        schoolId: 'school-a',
        query,
        locations: [{ ...hall, name }],
      }).status,
    ).toBe(status);
  },
);
