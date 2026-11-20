import { isNetworkUnavailable, isTimeoutFailure } from '@campus/shared/src/loadFailureCopy';
import { isFunctionsUnconfiguredError } from '@/lib/functionsUrl';

export const LEAVE_LOAD_TIMEOUT_MS = 8000;

export const LEAVE_COPY = {
  loadingSubmit: '正在讀取請假資料…',
  loadingReview: '正在讀取請假核閱…',
  unavailableSubmit: '請假線上送出尚未開放',
  unavailableReview: '請假線上審核尚未開放',
  emptySubmit: '還沒有請假紀錄',
  emptySubmitHint: '建立後，會在這裡看到每門課的站內核閱狀態。',
  emptyReview: '目前沒有待核閱的請假',
  emptyReviewHint: '學生建立請假紀錄，且課程已指派給你後，才會顯示在此處。',
  network: '目前讀不到資料，請確認網路後重試。',
  timeout: '讀取逾時，請稍後再試。',
  generic: '暫時讀不到請假資料，請稍後再試。',
  unauthorized: '學校帳號已登出，請重新登入。',
  forbiddenSubmit: '目前沒有權限查看請假資料。',
  forbiddenReview: '目前沒有核閱權限',
  retry: '重試',
  login: '重新登入',
} as const;

export type LeavePageKind = 'submit' | 'review';
export type LeavePageErrorReason = 'network' | 'timeout' | 'other';

export type LeavePageFailure =
  | { status: 'unavailable' }
  | { status: 'unauthorized' }
  | { status: 'forbidden' }
  | { status: 'error'; reason: LeavePageErrorReason };

export type LeavePageView<D> =
  | { status: 'loading' }
  | LeavePageFailure
  | { status: 'empty'; data: D }
  | { status: 'ready'; data: D };

export class LeaveLoadTimeoutError extends Error {
  readonly code = 'leave-load-timeout';
  constructor() {
    super('請假資料讀取逾時');
    this.name = 'LeaveLoadTimeoutError';
  }
}

export function initialLeavePageView<D>(configured: boolean): LeavePageView<D> {
  return configured ? { status: 'loading' } : { status: 'unavailable' };
}

export function leavePageSuccess<D>(data: D, isEmpty: boolean): LeavePageView<D> {
  return isEmpty ? { status: 'empty', data } : { status: 'ready', data };
}

export function withLeaveLoadTimeout<T>(
  work: Promise<T>,
  timeoutMs = LEAVE_LOAD_TIMEOUT_MS,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new LeaveLoadTimeoutError()), timeoutMs);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function httpStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object' || !('status' in error)) return null;
  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' && Number.isFinite(status) ? status : null;
}

function errorCode(error: unknown): string {
  if (!error || typeof error !== 'object' || !('code' in error)) return '';
  return String((error as { code?: unknown }).code || '')
    .replace(/^functions\//i, '')
    .toLowerCase();
}

export function leavePageFailureFromError(error: unknown): LeavePageFailure {
  if (isFunctionsUnconfiguredError(error)) return { status: 'unavailable' };
  const status = httpStatus(error);
  const code = errorCode(error);
  if (status === 401 || code === 'unauthenticated') return { status: 'unauthorized' };
  if (status === 403 || code === 'permission-denied') return { status: 'forbidden' };
  if (
    status === 404 ||
    status === 501 ||
    code === 'not-found' ||
    code === 'unimplemented' ||
    code === 'functions-unconfigured' ||
    code === 'unconfigured'
  ) {
    return { status: 'unavailable' };
  }
  if (error instanceof LeaveLoadTimeoutError || code === 'leave-load-timeout' || isTimeoutFailure(error)) {
    return { status: 'error', reason: 'timeout' };
  }
  if (isNetworkUnavailable(error)) return { status: 'error', reason: 'network' };
  return { status: 'error', reason: 'other' };
}

export function leaveFailureCopy(kind: LeavePageKind, failure: LeavePageFailure): string {
  if (failure.status === 'unavailable') {
    return kind === 'review' ? LEAVE_COPY.unavailableReview : LEAVE_COPY.unavailableSubmit;
  }
  if (failure.status === 'unauthorized') return LEAVE_COPY.unauthorized;
  if (failure.status === 'forbidden') {
    return kind === 'review' ? LEAVE_COPY.forbiddenReview : LEAVE_COPY.forbiddenSubmit;
  }
  if (failure.reason === 'network') return LEAVE_COPY.network;
  if (failure.reason === 'timeout') return LEAVE_COPY.timeout;
  return LEAVE_COPY.generic;
}

export function leaveLoadingCopy(kind: LeavePageKind): string {
  return kind === 'review' ? LEAVE_COPY.loadingReview : LEAVE_COPY.loadingSubmit;
}

export function shouldRetryLeaveFailure(failure: LeavePageFailure): boolean {
  return failure.status === 'error';
}
