/** Shared user-facing destinations; mobile route identifiers stay stable for existing links. */
export const PRIMARY_DESTINATIONS = [
  { id: 'today', label: '今天', webPath: '/', mobileTab: 'Today' },
  { id: 'study', label: '課務', webPath: '/timetable', mobileTab: '學習' },
  { id: 'life', label: '生活', webPath: '/life', mobileTab: '校園' },
  { id: 'connect', label: '交流', webPath: '/connect', mobileTab: '訊息' },
  { id: 'me', label: '我的', webPath: '/profile', mobileTab: '我的' },
] as const;
