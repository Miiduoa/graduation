import { calendarScopeDestination, calendarScopes } from '../features/calendarScope';
import { resolveTabForRoute } from '../utils/routeRegistry';

test.each(calendarScopes)('留在 $label 不重建頁面或重設日期', ({ id }) => {
  expect(calendarScopeDestination(id, id)).toBeNull();
});

test.each([
  ['campus', 'personal', 'PersonalCalendar', '學習'],
  ['campus', 'timetable', 'PersonalTimetable', '學習'],
  ['personal', 'campus', 'SmartCalendarScreen', 'Today'],
  ['timetable', 'campus', 'SmartCalendarScreen', 'Today'],
] as const)('從 %s 切換到 %s 使用既有路由', (current, next, route, tab) => {
  const destination = calendarScopeDestination(current, next);
  expect(destination).toBe(route);
  expect(resolveTabForRoute(destination!)).toBe(tab);
});
