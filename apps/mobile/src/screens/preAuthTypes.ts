/** 未登入導覽路由參數（獨立檔以避免 LoginLanding ↔ PreAuthStack 循環 import） */
import type { PublicCourseFilters } from '@campus/shared/src/publicCourseFilters';
import type { AssistantRoleProfileId } from '@campus/shared/src/assistantRoleProfiles';
import type { AssistantWorkContext } from '@campus/shared/src/assistantRoleWorkflows';

export type AssistantDraftParams = { prompt?: string; taskProfile?: AssistantRoleProfileId; draftEntryId?: string } | undefined;

export type PreAuthStackParamList = {
  LoginLanding: undefined;
  Explore: { workContext?: AssistantWorkContext } | undefined;
  AIChat: AssistantDraftParams;
  Map: undefined;
  Library: undefined;
  LibraryCatalog: { initialQuery?: string; autoSearch?: boolean } | undefined;
  SchoolInfo: undefined;
  StudentCard: undefined;
  BusSchedule: undefined;
  公告總覽: undefined;
  公告詳情: { id: string };
  活動總覽: { saved?: string } | undefined;
  活動詳情: { id: string; source?: string; schoolId?: string };
  CourseCatalog: { publicSchoolId?: 'ncnu' | 'nthu'; filter?: { keyword?: string } & PublicCourseFilters; autoSearch?: boolean } | undefined;
  Health: undefined;
  Dormitory: undefined;
  PlatformLostFound: { id?: string; schoolId?: string } | undefined;
  Career: undefined;
  SSOLogin: undefined;
  TronClassWorkspace: undefined;
  /** `prompt` only pre-fills the composer; the student still chooses to send it. */
  NuniTimetableAssistant: AssistantDraftParams;
  PersonalImport: { kind?: 'timetable' | 'grades' | 'events' } | undefined;
  PersonalTimetable: { term?: string; courseId?: string; schoolId?: string; date?: string; startAt?: number; reminderScope?: string } | undefined;
  PersonalCalendar: { eventId?: string; eventScope?: string } | undefined;
  OralExamDemo: undefined;
  NuniWorkspace: {
    tab?: 'courses' | 'food' | 'merchant' | 'account';
    assistantAccountId?: string;
    workspaceId?: string;
    assignmentId?: string;
    materialId?: string;
  } | undefined;
};
