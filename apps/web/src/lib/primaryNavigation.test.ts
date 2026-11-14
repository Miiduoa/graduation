import { expect, it } from 'vitest';
import { primaryNavigationSection } from './primaryNavigation';

it.each([
  ['/', 'today'],
  ['/today', 'today'],
  ['/today-v2', 'today'],
  ['/timetable', 'study'],
  ['/school-courses', 'study'],
  ['/school-lms', 'study'],
  ['/school-lms/homework/10001/20001', 'study'],
  ['/course/cs101/assignments', 'study'],
  ['/teacher/course/cs101', 'study'],
  ['/classroom', 'study'],
  ['/classroom/grades', 'study'],
  ['/classroom/course/cs101', 'study'],
  ['/credit-planner', 'study'],
  ['/grades', 'study'],
  ['/calendar', 'study'],
  ['/cafeteria/restaurant-1', 'life'],
  ['/food', 'life'],
  ['/shops', 'life'],
  ['/hub', 'today'],
  ['/bus/registered', 'life'],
  ['/library', 'life'],
  ['/events/talk-1', 'life'],
  ['/community/post/topic-1', 'connect'],
  ['/connect', 'connect'],
  ['/social', 'connect'],
  ['/dms/conversation-1', 'connect'],
  ['/friends', 'connect'],
  ['/announcements/news-1', 'connect'],
  ['/messages', 'connect'],
  ['/student-card', 'me'],
  ['/student-card/verify', 'me'],
  ['/profile', 'me'],
  ['/auth/account', 'me'],
  ['/auth/platform/class-workspace/cw_123', 'study'],
  ['/settings', 'me'],
  ['/classroom/account', 'me'],
  ['/admin/students/student-1', 'more'],
  ['/search', 'more'],
] as const)('keeps %s in its primary navigation section', (pathname, expected) => {
  expect(primaryNavigationSection(pathname)).toBe(expected);
});

it.each([
  '/lost-found-old',
  '/classroom-old',
  '/grades-old',
  '/school-courses-old',
  '/unknown',
  '/connect-old',
  '/community-old',
  '/student-card-old',
  '/classroom/login',
  null,
  undefined,
])('does not mark an unrelated route %s as an active service', (pathname) => {
  expect(primaryNavigationSection(pathname)).toBeNull();
});

it('keeps home aliases in the section they redirect to', () => {
  expect(primaryNavigationSection('/today')).toBe('today');
  expect(primaryNavigationSection('/hub')).toBe('today');
  expect(primaryNavigationSection('/')).toBe('today');
  expect(primaryNavigationSection('/life')).toBe('life');
});
