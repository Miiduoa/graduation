export type LmsHomeworkItem = {
  id: number;
  courseId: number;
  courseName: string;
  title: string;
  deadline: string | null;
  deadlineLabel: string;
  submitted: boolean;
  description: string;
  href: string;
};

export type LmsAnnouncementItem = {
  id: string;
  courseId: number | null;
  courseName: string | null;
  title: string;
  content: string;
  publishedAt: string | null;
  href: string;
  source: 'course' | 'site' | 'activity';
};

export type LmsMaterialFile = {
  name: string;
  allowDownload: boolean;
  downloadHref: string | null;
};

export type LmsMaterialItem = {
  id: number;
  courseId: number;
  courseName: string;
  title: string;
  type: string;
  href: string;
  files: LmsMaterialFile[];
};

export type LmsCourseError = {
  courseId: number;
  courseName: string;
  area: 'homework' | 'announcements' | 'materials';
  status: number | null;
};

export type LmsReadonlySnapshot = {
  success: true;
  ownerUid: string;
  schoolId: 'pu';
  source: 'pu-tronclass';
  fetchedAt: string;
  cache: { hit: boolean; expiresAt: string };
  homework: LmsHomeworkItem[];
  announcements: LmsAnnouncementItem[];
  materials: LmsMaterialItem[];
  courseErrors: LmsCourseError[];
  siteAnnouncementError: { status: number | null } | null;
  upcomingCoursesError: { status: number | null } | null;
};
