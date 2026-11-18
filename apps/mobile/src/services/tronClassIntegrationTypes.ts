import type { TronClassBindingStatus } from '@campus/shared/src/tronClassIntegration';
import type { TronClassSubmissionHistory } from '@campus/shared/src/tronClassSubmissionHistory';
import type { TronClassAcknowledgedReadbackResult } from '@campus/shared/src/tronClassSubmissionConfirmation';
import type { TronClassCourseSummary } from '@campus/shared/src/tronClassCourseIndex';

export type { TronClassCourseIndex } from '@campus/shared/src/tronClassCourseIndex';

// The native boundary consumes the public BFF contract, never school cookies or raw school rows.
export type TronClassConnection = TronClassBindingStatus;
export type TronClassCourse = TronClassCourseSummary;
export type TronClassHomework = {
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
export type TronClassSnapshot = {
  revision: string;
  fetchedAt: string;
  courses: TronClassCourse[];
  homework: TronClassHomework[];
  announcements: {
    id: string | number;
    courseId: number | null;
    courseName: string;
    title: string;
    content: string;
    publishedAt: string | null;
    href: string;
    source: string;
  }[];
  materials: {
    id: string | number;
    courseId: number | null;
    courseName: string;
    title: string;
    type: string;
    href: string;
    files: { name: string; allowDownload: boolean; downloadHref: string | null }[];
  }[];
  errors: {
    courseId: number | null;
    area: 'courses' | 'homework' | 'materials' | 'announcements';
    message: string;
  }[];
  partial: boolean;
};
export type TronClassReceipt = {
  id: string;
  courseId: number;
  homeworkId: number;
  status: 'submitted';
  submittedAt: string;
  content: string;
  attachments: { name: string; size: number }[];
  source: 'tronclass';
};
export type TronClassRules =
  | { status: 'unknown' }
  | { status: 'confirmed'; allowsText: boolean; allowsAttachments: boolean; maxTotalBytes: number };
export type TronClassDetails =
  | { status: 'unavailable' }
  | {
      status: 'available';
      fetchedAt: string;
      submissionType: 'individual' | 'group' | 'unknown';
      mode: 'normal' | 'multiple' | 'unknown';
      opensAt: string | null;
      deadline: string | null;
      isInProgress: boolean | null;
      isClosed: boolean | null;
      attempts: {
        unlimited: boolean | null;
        limit: number | null;
        used: number | null;
        remaining: number | null;
      };
      resubmissionOpen: boolean | null;
      retractAllowed: boolean | null;
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
  rules?: TronClassRules;
  details?: TronClassDetails;
  receipt: TronClassReceipt | null;
  history?: TronClassSubmissionHistory;
};
export type TronClassResult =
  | { status: 'submitted' | 'unknown'; operationId: string; receipt: TronClassReceipt | null }
  | TronClassAcknowledgedReadbackResult;
export type TronClassUpload = {
  fileId: string;
  name: string;
  contentType: string;
  size: number;
  sha256: string;
  status: 'uploaded';
};
export type TronClassUploadScope = {
  courseId: number;
  homeworkId: number;
  revision: string;
  operationId: string;
  fileId: string;
  name: string;
};
/** URI handles and content live only in this mounted screen; they are never serialized. */
export type TronClassLocalFile = {
  key: string;
  uri: string;
  name: string;
  size: number;
  contentType: string;
};
export type TronClassLocalDraft = {
  courseId: number;
  homeworkId: number;
  content: string;
  files: TronClassLocalFile[];
};
