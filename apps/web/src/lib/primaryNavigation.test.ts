import { expect, it } from 'vitest';
import { primaryNavigationSection } from './primaryNavigation';

it.each([
  ['/', 'today'],
  ['/timetable', 'study'],
  ['/classroom', 'study'],
  ['/course/cs101/assignments', 'study'],
  ['/teacher/course/cs101', 'study'],
  ['/classroom/grades', 'study'],
  ['/credit-planner', 'study'],
  ['/grades', 'study'],
  ['/calendar', 'study'],
  ['/cafeteria/restaurant-1', 'life'],
  ['/bus/registered', 'life'],
  ['/library', 'life'],
  ['/events/talk-1', 'life'],
  ['/community/post/topic-1', 'life'],
  ['/settings', 'me'],
  ['/classroom/account', 'me'],
  ['/admin/students/student-1', 'more'],
  ['/search', 'more'],
] as const)('keeps %s in its primary navigation section', (pathname, expected) => {
  expect(primaryNavigationSection(pathname)).toBe(expected);
});

it.each(['/lost-found-old', '/classroom-old', '/grades-old', '/school-courses-old', '/unknown', null, undefined])(
  'does not mark an unrelated route %s as an active service',
  (pathname) => {
    expect(primaryNavigationSection(pathname)).toBeNull();
  },
);
