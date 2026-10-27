import {
  TEACHER_LMS_UNAVAILABLE_CODE,
  TEACHER_LMS_UNAVAILABLE_COPY,
  isTeacherLmsUnavailableNotice,
} from '@campus/shared/src/schoolLogin';

export const SCHOOL_LOGIN_GENERIC_ERROR = '登入失敗。請確認學號與密碼，或稍後再試。';
export { TEACHER_LMS_UNAVAILABLE_CODE, TEACHER_LMS_UNAVAILABLE_COPY };

const CLOSED_SERVER_ERROR = '尚未開放';
const UNAVAILABLE_SERVER_ERROR = '學校系統暫時無法連線';

export class SchoolLoginHttpError extends Error {
  readonly status: number;
  readonly serverError: string;
  readonly code: string;

  constructor(status: number, serverError = '', code = '') {
    super(schoolLoginErrorCopy(status, serverError, code));
    this.name = 'SchoolLoginHttpError';
    this.status = status;
    this.serverError = serverError;
    this.code = code;
  }
}

export function schoolLoginErrorCopy(status: number, serverError?: string, code?: string): string {
  const message = String(serverError || '').trim();
  const errorCode = String(code || '').trim();
  if (status === 401) return '學號或密碼錯誤';
  if (status === 429) return '嘗試太多次，請稍後再試';
  if (status === 503 && message === CLOSED_SERVER_ERROR) {
    return '這間學校尚未開放學號登入';
  }
  if (status === 503 && message === UNAVAILABLE_SERVER_ERROR) {
    return '學校系統暫時連不上，請稍後再試';
  }
  if (status === 503 && isTeacherLmsUnavailableNotice(errorCode || message)) {
    return TEACHER_LMS_UNAVAILABLE_COPY;
  }
  return SCHOOL_LOGIN_GENERIC_ERROR;
}

export function schoolLoginFailureCopy(error: unknown): string {
  if (error instanceof SchoolLoginHttpError) {
    return schoolLoginErrorCopy(error.status, error.serverError, error.code);
  }
  return SCHOOL_LOGIN_GENERIC_ERROR;
}
