export const calendarScopes = [
  { id: 'campus', label: '校園行事曆', hint: '校園活動、作業截止與在這裡匯入的 iCal' },
  { id: 'personal', label: '個人行程', hint: '開啟個人行事曆，查看自己新增或匯入的活動與考試' },
  { id: 'timetable', label: '我的課表', hint: '開啟我的課表，查看每週上課時間' },
] as const;

export type CalendarScope = (typeof calendarScopes)[number]['id'];

const calendarRoutes = {
  campus: 'SmartCalendarScreen',
  personal: 'PersonalCalendar',
  timetable: 'PersonalTimetable',
} as const;

export function calendarScopeDestination(current: CalendarScope, next: CalendarScope) {
  return current === next ? null : calendarRoutes[next];
}
