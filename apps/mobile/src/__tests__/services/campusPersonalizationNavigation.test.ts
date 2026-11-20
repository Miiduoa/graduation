import {
  buildCampusRecommendations,
  createDefaultCampusPreferences,
  CAMPUS_STAGE_OPTIONS,
  CAMPUS_FOCUS_OPTIONS,
} from '@campus/shared/src/campusPersonalization';
import { campusRecommendationDestination } from '../../services/campusPersonalizationNavigation';

const navigation = {
  navigate: jest.fn(),
  getState: () => ({
    routeNames: [
      'NuniWorkspace',
      'PersonalTimetable',
      'PersonalCalendar',
      'Map',
      'BusSchedule',
      'PersonalImport',
    ],
  }),
};

test('all real recommendations retain a reachable native or fixed website destination for platform accounts', () => {
  for (const stage of CAMPUS_STAGE_OPTIONS)
    for (const focus of CAMPUS_FOCUS_OPTIONS) {
      const result = buildCampusRecommendations({
        preferences: {
          ...createDefaultCampusPreferences(),
          stage: stage.value,
          focus: focus.value,
          configured: true,
        },
        now: new Date('2026-11-13T08:00:00+08:00'),
        events: [],
        schoolId: 'pu',
      });
      for (const item of result.recommendations) {
        const destination = campusRecommendationDestination(item.href, 'platform', navigation);
        expect(destination).not.toBeNull();
        if (destination?.kind === 'web') {
          expect(new URL(destination.url).origin).toBe('https://nuni.tw');
          expect(new URL(destination.url).searchParams.get('campus')).toBe('pu');
        }
      }
    }
});

test('campus and personal import links keep the exact local service and preserve import kind', () => {
  expect(
    campusRecommendationDestination('/map?campus=pu&schoolId=pu', 'platform', navigation),
  ).toEqual({ kind: 'native', route: 'Map' });
  expect(
    campusRecommendationDestination('/import?kind=timetable&campus=pu', 'platform', navigation),
  ).toEqual({ kind: 'native', route: 'PersonalImport', params: { kind: 'timetable' } });
  expect(
    campusRecommendationDestination('/groups?campus=pu&schoolId=pu', 'platform', navigation),
  ).toEqual({ kind: 'web', url: 'https://nuni.tw/groups?campus=pu&schoolId=pu' });
});

test('platform identity never borrows school-only tabs for private recommendations', () => {
  const both = {
    ...navigation,
    getState: () => ({ routeNames: ['NuniWorkspace', '學習', 'Today', '我的'] }),
  };
  expect(campusRecommendationDestination('/credit-planner?campus=pu', 'platform', both)?.kind).toBe(
    'web',
  );
  expect(campusRecommendationDestination('/classroom?campus=pu', 'platform', both)).toEqual({
    kind: 'native',
    route: 'NuniWorkspace',
    params: { tab: 'courses' },
  });
});

test.each([
  'https://evil.example',
  '//evil.example',
  '/admin?redirect=https://evil.example',
  '/map#secret',
  '/unknown',
  '/calendar?kind=grades',
  '/community/me?kind=timetable',
])('unknown and injected destinations are rejected: %s', (href) => {
  expect(campusRecommendationDestination(href, 'platform', navigation)).toBeNull();
});
