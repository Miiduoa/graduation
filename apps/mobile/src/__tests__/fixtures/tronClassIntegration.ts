import type {
  TronClassConnection,
  TronClassHomework,
  TronClassPreparation,
  TronClassSnapshot,
} from '../../services/tronClassIntegrationTypes';
import type { TronClassSubmissionHistory } from '@campus/shared/src/tronClassSubmissionHistory';

export const revision = 'a'.repeat(32);
export const nextRevision = 'b'.repeat(32);
export const studentKey = 'c'.repeat(64);
export const stamp = '2026-11-18T10:00:00.000Z';
export const operationId = '11111111-1111-4111-8111-111111111111';
export const connection: TronClassConnection = {
  schoolId: 'pu',
  connected: true,
  revision,
  studentKey,
  account: 'student-a',
  userName: '同學 A',
  expiresAt: '2026-11-19T10:00:00.000Z',
};
export const disconnected: TronClassConnection = {
  schoolId: 'pu',
  connected: false,
  revision: null,
  studentKey: null,
  account: null,
  userName: null,
  expiresAt: null,
};
export const homework: TronClassHomework = {
  id: 20,
  courseId: 10,
  courseName: '程式設計',
  title: '期中作業',
  deadline: stamp,
  deadlineLabel: '2026/11/18 18:00',
  submitted: null,
  description: '請繳交程式與說明。',
  href: 'https://tronclass.pu.edu.tw/course/10/content#/homework/20',
};
export const snapshot: TronClassSnapshot = {
  revision,
  fetchedAt: stamp,
  partial: false,
  errors: [],
  courses: [
    {
      id: 10,
      name: '程式設計',
      code: 'CS101',
      teachers: ['王老師'],
      semester: '115-1',
      status: 'active',
      href: 'https://tronclass.pu.edu.tw/course/10',
    },
  ],
  homework: [homework],
  announcements: [],
  materials: [],
};
export const preparation: TronClassPreparation = {
  source: 'tronclass',
  schoolId: 'pu',
  courseId: 10,
  homeworkId: 20,
  revision,
  title: homework.title,
  description: homework.description,
  deadline: stamp,
  canSubmit: false,
  blockedReason: '目前可以整理與預覽，請到校方原頁繳交。',
  maxFiles: 4,
  maxFileBytes: 10 * 1024 * 1024,
  allowedContentTypes: [],
  rules: {
    status: 'confirmed',
    allowsText: true,
    allowsAttachments: true,
    maxTotalBytes: 20 * 1024 * 1024,
  },
  receipt: null,
};
export const submissionHistory: TronClassSubmissionHistory = {
  source: 'tronclass',
  courseId: 10,
  homeworkId: 20,
  fetchedAt: stamp,
  state: 'available',
  latestId: '30',
  entries: [{
    id: '30', state: 'submitted', isLatest: true, createdAt: stamp,
    content: '先前版本的答案', contentTruncated: false, hasOtherResources: false,
    attachments: [{ name: '先前答案.pdf', size: 3, download: { uploadId: 50 } }],
  }],
};
export function acknowledged(op: string = operationId) {
  return {
    status: 'confirmed',
    operationId: op,
    receipt: null,
    confirmation: {
      kind: 'acknowledged-readback',
      source: 'tronclass',
      schoolId: 'pu',
      operationId: op,
      submissionId: 30,
      courseId: 10,
      homeworkId: 20,
      confirmedAt: stamp,
      sourceRecordedAt: null,
    },
  } as const;
}
