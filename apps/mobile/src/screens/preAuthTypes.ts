/** 未登入導覽路由參數（獨立檔以避免 LoginLanding ↔ PreAuthStack 循環 import） */
export type PreAuthStackParamList = {
  LoginLanding: undefined;
  Map: undefined;
  Library: undefined;
  LibraryCatalog: { initialQuery?: string } | undefined;
  SchoolInfo: undefined;
  StudentCard: undefined;
  BusSchedule: undefined;
  公告總覽: undefined;
  公告詳情: { id: string };
  CourseCatalog: undefined;
  Health: undefined;
  Dormitory: undefined;
  Career: undefined;
  SSOLogin: undefined;
  NuniTimetableAssistant: undefined;
  PersonalImport: { kind?: 'timetable' | 'grades' | 'events' } | undefined;
  PersonalTimetable: { term?: string; courseId?: string; schoolId?: string; date?: string; startAt?: number; reminderScope?: string } | undefined;
  PersonalCalendar: { eventId?: string } | undefined;
  NuniWorkspace: {
    tab?: 'courses' | 'food' | 'merchant' | 'account';
    assistantAccountId?: string;
    workspaceId?: string;
    assignmentId?: string;
    materialId?: string;
  } | undefined;
};
