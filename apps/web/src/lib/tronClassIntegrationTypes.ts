export type TronClassConnection = {
  schoolId: 'pu';
  connected: boolean;
  revision: string | null;
  account: string | null;
  userName: string | null;
  expiresAt: string | null;
};

export type TronClassCourseSummary = {
  id: number;
  name: string;
  code: string;
  teachers: string[];
  semester: string | null;
  status: string;
  href: string;
};

export type TronClassHomeworkItem = {
  id: number;
  courseId: number;
  courseName: string;
  title: string;
  deadline: string | null;
  deadlineLabel: string;
  submitted: boolean | null;
  description: string;
  href: string;
};

export type TronClassAnnouncement = {
  id: string | number;
  courseId: number | null;
  courseName: string;
  title: string;
  content: string;
  publishedAt: string | null;
  href: string;
  source: string;
};

export type TronClassMaterial = {
  id: string | number;
  courseId: number | null;
  courseName: string;
  title: string;
  type: string;
  href: string;
  files: { name: string; allowDownload: boolean; downloadHref: string | null }[];
};

export type TronClassSyncError = {
  courseId: number | null;
  area: 'courses' | 'homework' | 'materials' | 'announcements';
  message: string;
};

export type TronClassSnapshot = {
  revision: string;
  fetchedAt: string;
  courses: TronClassCourseSummary[];
  homework: TronClassHomeworkItem[];
  announcements: TronClassAnnouncement[];
  materials: TronClassMaterial[];
  errors: TronClassSyncError[];
  partial: boolean;
};

export type TronClassSubmissionReceipt = {
  id: string;
  courseId: number;
  homeworkId: number;
  status: 'submitted';
  submittedAt: string;
  content: string;
  attachments: { name: string; size: number }[];
  source: 'tronclass';
};

export type TronClassPreparation = {
  source: 'tronclass';
  schoolId: 'pu';
  courseId: number;
  homeworkId: number;
  revision: string;
  title: string;
  description: string;
  deadline: string | null;
  canSubmit: boolean;
  blockedReason: string | null;
  maxFiles: number;
  maxFileBytes: number;
  allowedContentTypes: string[];
  receipt: TronClassSubmissionReceipt | null;
};

export type TronClassSubmissionResult = {
  status: 'submitted' | 'unknown';
  operationId: string;
  receipt: TronClassSubmissionReceipt | null;
};

export type TronClassUploadedFile = {
  fileId: string;
  name: string;
  contentType: string;
  size: number;
  sha256: string;
  status: 'uploaded';
};
