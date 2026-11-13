import { NuniError } from '@campus/shared/src/nuni';
import {
  HOMEWORK_MAX_PAGES,
  HOMEWORK_PAGE_SIZE,
  classifySchoolReadError,
  homeworkDescriptionText,
  homeworkPageAdvance,
} from '@campus/shared/src/puLmsReadonly';
import { parseTaipeiInstant } from '@campus/shared/src/taipeiTime';
import type { LmsReadonlySource } from './tronClassLmsSource';

export type TronClassSubmissionBinding = {
  schoolId: 'pu';
  revision: string;
  account: string;
  userId: number;
  userName: string | null;
  cookies: Record<string, string>;
  expiresAt: string;
};

export type TronClassHomeworkScope = { courseId: number; homeworkId: number };

/** These are source-confirmed permissions, not values supplied by the browser. */
export type TronClassAssignment = TronClassHomeworkScope & {
  studentId: number;
  title: string;
  description: string;
  deadline: string | null;
  opensAt: string | null;
  permissionKnown: boolean;
  individual: boolean;
  canSubmit: boolean;
  isClosed: boolean;
  allowLate: boolean;
  remainingAttempts: number | null;
  allowsText: boolean;
  allowsAttachments: boolean;
  maxFiles: number;
  maxFileBytes: number;
  maxTotalBytes: number;
  allowedContentTypes: string[];
};

export type TronClassSourceFile = {
  key: string;
  name: string;
  size: number;
};

export type TronClassSourceReceipt = TronClassHomeworkScope & {
  id: string;
  studentId: number;
  status: 'submitted';
  submittedAt: string;
  content: string;
  attachments: TronClassSourceFile[];
};

export type TronClassUploadInput = {
  fileId: string;
  name: string;
  contentType: string;
  bytes: Uint8Array;
  sha256: string;
};

export type TronClassSourceUpload = TronClassSourceFile & TronClassHomeworkScope & {
  studentId: number;
  sha256: string;
  contentType: string;
};

/**
 * A verified implementation must use one tenant's recorded request/response
 * contract. The submission service never treats an HTTP success as a receipt.
 */
export type TronClassSubmissionSource = {
  contractVerified: boolean;
  getAssignment(binding: TronClassSubmissionBinding, scope: TronClassHomeworkScope): Promise<TronClassAssignment>;
  uploadFile(binding: TronClassSubmissionBinding, assignment: TronClassAssignment, input: TronClassUploadInput): Promise<TronClassSourceUpload>;
  submit(binding: TronClassSubmissionBinding, assignment: TronClassAssignment, input: {
    operationId: string;
    content: string;
    attachments: TronClassSourceFile[];
  }): Promise<void>;
  listSubmissions(binding: TronClassSubmissionBinding, scope: TronClassHomeworkScope): Promise<TronClassSourceReceipt[]>;
};

function unavailable(): never { throw new NuniError(503, 'TRONCLASS_SUBMISSION_UNAVAILABLE'); }

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function numericId(value: unknown): number | null {
  const id = typeof value === 'number' ? value : typeof value === 'string' && /^[1-9]\d*$/.test(value) ? Number(value) : NaN;
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

async function schoolRead<T>(run: () => Promise<T>): Promise<T> {
  try { return await run(); } catch (error) {
    if (classifySchoolReadError(error) === 'session' ||
      (error && typeof error === 'object' && 'status' in error && error.status === 401)) {
      throw new NuniError(401, 'TRONCLASS_RECONNECT_REQUIRED');
    }
    return unavailable();
  }
}

/**
 * Production currently has a verified read integration only. The legacy mobile
 * POST /api/uploads and /homework/{id}/submissions paths are NOT an established
 * submission contract. In particular, uploading a file is not final submission.
 *
 * Keep writes unavailable even if an operator enables the runtime feature flag.
 * A tenant-verified adapter must replace this implementation before activation;
 * no permission or receipt is inferred from guessed fields or a 2xx response.
 */
export function createTronClassSubmissionSource(readonlySource?: LmsReadonlySource): TronClassSubmissionSource {
  return {
    contractVerified: false,
    async getAssignment(binding, scope) {
      const source = readonlySource ?? (await import('./tronClassLmsSource')).tronClassLmsReadonlySource;
      const lists = await schoolRead(() => Promise.all(['ongoing', 'upcoming'].map((status) =>
        source.fetchCourses(binding.cookies, { userId: binding.userId, status: status as 'ongoing' | 'upcoming' }))));
      if (lists.some((list) => !Array.isArray(list) || list.length > 1000)) unavailable();
      const courses = (lists as unknown[][]).flat();
      if (!courses.some((course) => numericId(record(course).id) === scope.courseId)) {
        throw new NuniError(403, 'TRONCLASS_COURSE_ACCESS_DENIED');
      }
      let accumulated = 0;
      let found: Record<string, unknown> | undefined;
      const seen = new Set<number>();
      for (let page = 1; page <= HOMEWORK_MAX_PAGES; page += 1) {
        const response = await schoolRead(() => source.fetchHomeworkPage(binding.cookies, scope.courseId, page, HOMEWORK_PAGE_SIZE));
        if (!response.ok && response.status === 401) throw new NuniError(401, 'TRONCLASS_RECONNECT_REQUIRED');
        if (!response.ok || !Array.isArray(response.value.homework_activities)) unavailable();
        const rows = response.value.homework_activities;
        for (const raw of rows) {
          const row = record(raw);
          const id = numericId(row.id);
          if (!id || seen.has(id) || (row.course_id !== undefined && numericId(row.course_id) !== scope.courseId)) unavailable();
          seen.add(id);
          if (id === scope.homeworkId) found = row;
        }
        accumulated += rows.length;
        const progress = homeworkPageAdvance({
          page, pageSize: HOMEWORK_PAGE_SIZE, pageLength: rows.length,
          accumulated, total: response.value.total, maxPages: HOMEWORK_MAX_PAGES,
        });
        if (progress === 'incomplete') unavailable();
        if (progress === 'complete') break;
      }
      if (!found) throw new NuniError(404, 'TRONCLASS_HOMEWORK_NOT_FOUND');
      const title = typeof found.title === 'string' ? found.title.trim().slice(0, 300) : '';
      if (!title) unavailable();
      const rawDeadline = found.deadline ?? found.end_time;
      const deadline = typeof rawDeadline === 'string' ? parseTaipeiInstant(rawDeadline) : null;
      return {
        courseId: scope.courseId, homeworkId: scope.homeworkId, studentId: binding.userId, title,
        description: homeworkDescriptionText(record(found.data).description ?? found.description),
        deadline: deadline === null ? null : new Date(deadline).toISOString(),
        opensAt: null, permissionKnown: false, individual: false, canSubmit: false,
        isClosed: true, allowLate: false, remainingAttempts: null,
        allowsText: false, allowsAttachments: false,
        maxFiles: 0, maxFileBytes: 0, maxTotalBytes: 0, allowedContentTypes: [],
      };
    },
    async uploadFile() { return unavailable(); },
    async submit() { return unavailable(); },
    async listSubmissions() { return unavailable(); },
  };
}
