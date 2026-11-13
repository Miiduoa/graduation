import type {
  TronClassConnection,
  TronClassPreparation,
  TronClassSnapshot,
  TronClassSubmissionResult,
  TronClassUploadedFile,
} from './tronClassIntegrationTypes';

export type TronClassIdentity =
  | { kind: 'platform'; context: string }
  | { kind: 'firebase'; getIdToken: () => Promise<string> };

export class TronClassRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 0,
  ) {
    super(message);
    this.name = 'TronClassRequestError';
  }
}

export function tronClassErrorMessage(reason: unknown): string {
  if (reason instanceof TronClassRequestError) return reason.message;
  return '連線尚未完成，請確認網路後再試。';
}

export function safeTronClassHref(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.origin === 'https://tronclass.pu.edu.tw' && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

export function tronClassUploadKey(value: string | null | undefined): string | null {
  const safe = safeTronClassHref(value);
  if (!safe) return null;
  try {
    const url = new URL(safe);
    if (url.search || url.hash) return null;
    const match = /^\/api\/uploads\/([^/]+)\/blob$/.exec(url.pathname);
    const key = match ? decodeURIComponent(match[1]) : '';
    return /^[A-Za-z0-9._-]{1,200}$/.test(key) && key !== '.' && key !== '..' ? key : null;
  } catch {
    return null;
  }
}

const MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024;

async function downloadedFile(response: Response): Promise<{ blob: Blob; filename: string }> {
  const type = response.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase();
  const disposition = response.headers.get('Content-Disposition') ?? '';
  const encodedName = /(?:^|;)\s*filename\*\s*=\s*UTF-8''([^;]+)/i.exec(disposition)?.[1];
  if (
    !type ||
    ['text/html', 'application/xhtml+xml'].includes(type) ||
    !/^attachment(?:;|$)/i.test(disposition) ||
    !encodedName ||
    !response.body
  )
    return invalidResponse();
  let filename: string;
  try {
    filename = decodeURIComponent(encodedName)
      .replace(/[<>:"/\\|?*\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '_')
      .trim()
      .slice(0, 200);
  } catch {
    return invalidResponse();
  }
  if (!filename || filename === '.' || filename === '..') return invalidResponse();
  const tooLarge = () =>
    new TronClassRequestError(
      'TRONCLASS_DOWNLOAD_TOO_LARGE',
      '這份附件較大，請開啟原始教材下載。',
      413,
    );
  const length = response.headers.get('Content-Length');
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_DOWNLOAD_BYTES)) {
    await response.body.cancel();
    throw tooLarge();
  }
  const reader = response.body.getReader();
  const chunks: ArrayBuffer[] = [];
  let total = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      total += result.value.byteLength;
      if (total > MAX_DOWNLOAD_BYTES) {
        await reader.cancel();
        throw tooLarge();
      }
      chunks.push(new Uint8Array(result.value).buffer);
    }
  } finally {
    reader.releaseLock();
  }
  if (length && total !== Number(length)) return invalidResponse();
  return { blob: new Blob(chunks, { type }), filename };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === 'string';
const isNullableText = (value: unknown): boolean => value === null || isText(value);
const isId = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const isTime = (value: unknown): value is string =>
  isText(value) && Number.isFinite(Date.parse(value));
const isRevision = (value: unknown): value is string =>
  isText(value) && /^[a-f0-9]{32}$/.test(value);
const isOperationId = (value: unknown): value is string =>
  isText(value) && /^[A-Za-z0-9_-]{16,80}$/.test(value);
const isArrayOf = (value: unknown, check: (item: unknown) => boolean, max = 5000): boolean =>
  Array.isArray(value) && value.length <= max && value.every(check);
const invalidResponse = (): never => {
  throw new TronClassRequestError('INVALID_RESPONSE', '尚未收到可確認的回覆，請稍後重新查詢。');
};

function isReceipt(value: unknown): boolean {
  return (
    isRecord(value) &&
    value.source === 'tronclass' &&
    value.status === 'submitted' &&
    isText(value.id) &&
    value.id.length > 0 &&
    isId(value.courseId) &&
    isId(value.homeworkId) &&
    isTime(value.submittedAt) &&
    isText(value.content) &&
    isArrayOf(
      value.attachments,
      (file) =>
        isRecord(file) &&
        isText(file.name) &&
        typeof file.size === 'number' &&
        Number.isSafeInteger(file.size) &&
        file.size >= 0,
      100,
    )
  );
}

function parseResult(action: string, value: unknown, input: Record<string, unknown>): unknown {
  if (!isRecord(value)) return invalidResponse();
  if (['status', 'connect', 'disconnect'].includes(action)) {
    if (
      value.schoolId !== 'pu' ||
      typeof value.connected !== 'boolean' ||
      !(value.revision === null || isRevision(value.revision)) ||
      !isNullableText(value.account) ||
      !isNullableText(value.userName) ||
      !(value.expiresAt === null || isTime(value.expiresAt)) ||
      (value.connected && (!isRevision(value.revision) || !isText(value.account) || !value.account))
    )
      return invalidResponse();
  } else if (action === 'sync') {
    const hasScope = (item: unknown): item is Record<string, unknown> =>
      isRecord(item) &&
      (item.courseId === null || isId(item.courseId)) &&
      isText(item.courseName) &&
      isText(item.title) &&
      isText(item.href);
    if (
      !isRevision(value.revision) ||
      !isTime(value.fetchedAt) ||
      typeof value.partial !== 'boolean' ||
      !isArrayOf(
        value.courses,
        (item) =>
          isRecord(item) &&
          isId(item.id) &&
          isText(item.name) &&
          isText(item.code) &&
          isArrayOf(item.teachers, isText, 100) &&
          isNullableText(item.semester) &&
          isText(item.status) &&
          isText(item.href),
        1000,
      ) ||
      !isArrayOf(
        value.homework,
        (item) =>
          hasScope(item) &&
          isId(item.id) &&
          isId(item.courseId) &&
          (item.deadline === null || isTime(item.deadline)) &&
          isText(item.deadlineLabel) &&
          (item.submitted === null || typeof item.submitted === 'boolean') &&
          isText(item.description),
      ) ||
      !isArrayOf(
        value.announcements,
        (item) =>
          hasScope(item) &&
          (isText(item.id) || isId(item.id)) &&
          isText(item.content) &&
          (item.publishedAt === null || isTime(item.publishedAt)) &&
          isText(item.source),
      ) ||
      !isArrayOf(
        value.materials,
        (item) =>
          hasScope(item) &&
          (isText(item.id) || isId(item.id)) &&
          isText(item.type) &&
          isArrayOf(
            item.files,
            (file) =>
              isRecord(file) &&
              isText(file.name) &&
              typeof file.allowDownload === 'boolean' &&
              isNullableText(file.downloadHref),
            500,
          ),
      ) ||
      !isArrayOf(
        value.errors,
        (item) =>
          isRecord(item) &&
          (item.courseId === null || isId(item.courseId)) &&
          ['courses', 'homework', 'materials', 'announcements'].includes(String(item.area)) &&
          isText(item.message),
        1000,
      )
    )
      return invalidResponse();
  } else if (action === 'prepare') {
    if (
      value.source !== 'tronclass' ||
      value.schoolId !== 'pu' ||
      value.courseId !== input.courseId ||
      value.homeworkId !== input.homeworkId ||
      !isRevision(value.revision) ||
      !isText(value.title) ||
      !isText(value.description) ||
      !(value.deadline === null || isTime(value.deadline)) ||
      typeof value.canSubmit !== 'boolean' ||
      !isNullableText(value.blockedReason) ||
      typeof value.maxFiles !== 'number' ||
      !Number.isSafeInteger(value.maxFiles) ||
      value.maxFiles < 0 ||
      typeof value.maxFileBytes !== 'number' ||
      !Number.isSafeInteger(value.maxFileBytes) ||
      value.maxFileBytes < 0 ||
      !isArrayOf(value.allowedContentTypes, isText, 100) ||
      !(value.receipt === null || isReceipt(value.receipt))
    )
      return invalidResponse();
    if (
      isRecord(value.receipt) &&
      (value.receipt.courseId !== input.courseId || value.receipt.homeworkId !== input.homeworkId)
    )
      return invalidResponse();
  } else if (action === 'submit' || action === 'reconcile') {
    if (
      !['submitted', 'unknown'].includes(String(value.status)) ||
      !isOperationId(value.operationId) ||
      value.operationId !== input.operationId ||
      (value.status === 'submitted' ? !isReceipt(value.receipt) : value.receipt !== null)
    )
      return invalidResponse();
    if (
      action === 'submit' &&
      isRecord(value.receipt) &&
      (value.receipt.courseId !== input.courseId || value.receipt.homeworkId !== input.homeworkId)
    )
      return invalidResponse();
  } else if (action === 'upload') {
    if (
      value.status !== 'uploaded' ||
      value.fileId !== input.fileId ||
      value.name !== input.name ||
      value.size !== input.size ||
      !isText(value.contentType) ||
      !isText(value.sha256) ||
      !/^[a-f0-9]{64}$/.test(value.sha256)
    )
      return invalidResponse();
  }
  return value;
}

export function createTronClassClient(identity: TronClassIdentity) {
  async function headers(): Promise<Record<string, string>> {
    if (identity.kind === 'platform') return { 'X-Campus-Session': identity.context };
    return { Authorization: `Bearer ${await identity.getIdToken()}` };
  }

  async function responseValue<T>(response: Response): Promise<T> {
    let value: unknown;
    try {
      value = await response.json();
    } catch {
      throw new TronClassRequestError(
        'INVALID_RESPONSE',
        '尚未收到可確認的回覆，請稍後重新查詢。',
        response.status,
      );
    }
    if (!response.ok) {
      const error = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
      throw new TronClassRequestError(
        typeof error.error === 'string' ? error.error : 'REQUEST_FAILED',
        typeof error.message === 'string' ? error.message : '暫時無法完成，請稍後再試。',
        response.status,
      );
    }
    if (!value || typeof value !== 'object')
      throw new TronClassRequestError(
        'INVALID_RESPONSE',
        '尚未收到可確認的回覆，請稍後重新查詢。',
        response.status,
      );
    return value as T;
  }

  async function request<T>(action: string, input: Record<string, unknown> = {}): Promise<T> {
    const authHeaders = await headers();
    const response = await fetch('/api/tronclass', {
      method: 'POST',
      cache: 'no-store',
      credentials: 'same-origin',
      redirect: 'error',
      signal: AbortSignal.timeout(action === 'connect' || action === 'disconnect' ? 90000 : 60000),
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...input, action }),
    });
    const value = await responseValue<unknown>(response);
    return parseResult(action, value, input) as T;
  }

  return {
    status: () => request<TronClassConnection>('status'),
    connect: (account: string, password: string, expectedRevision: string | null) =>
      request<TronClassConnection>('connect', {
        schoolId: 'pu',
        account,
        password,
        expectedRevision,
      }),
    disconnect: (expectedRevision: string | null) =>
      request<TronClassConnection>('disconnect', { expectedRevision }),
    sync: (courseId?: number) =>
      request<TronClassSnapshot>('sync', courseId === undefined ? {} : { courseId }),
    async downloadMaterial(input: {
      courseId: number;
      activityId: number;
      uploadKey: string;
      revision: string;
    }): Promise<{ blob: Blob; filename: string }> {
      if (
        !isId(input.courseId) ||
        !isId(input.activityId) ||
        !isRevision(input.revision) ||
        !/^[A-Za-z0-9._-]{1,200}$/.test(input.uploadKey) ||
        ['.', '..'].includes(input.uploadKey)
      )
        return invalidResponse();
      const authHeaders = await headers();
      const response = await fetch('/api/tronclass/material-download', {
        method: 'POST',
        cache: 'no-store',
        credentials: 'same-origin',
        redirect: 'error',
        signal: AbortSignal.timeout(60000),
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!response.ok) await responseValue<unknown>(response);
      return downloadedFile(response);
    },
    prepare: (courseId: number, homeworkId: number) =>
      request<TronClassPreparation>('prepare', { courseId, homeworkId }),
    submit: (input: {
      courseId: number;
      homeworkId: number;
      revision: string;
      operationId: string;
      content: string;
      attachments: string[];
      confirmed: true;
    }) => request<TronClassSubmissionResult>('submit', input),
    reconcile: (operationId: string, revision: string) =>
      request<TronClassSubmissionResult>('reconcile', { operationId, revision }),
    async upload(input: {
      courseId: number;
      homeworkId: number;
      revision: string;
      operationId: string;
      fileId: string;
      file: File;
    }): Promise<TronClassUploadedFile> {
      const authHeaders = await headers();
      const query = new URLSearchParams({
        courseId: String(input.courseId),
        homeworkId: String(input.homeworkId),
        revision: input.revision,
        operationId: input.operationId,
        fileId: input.fileId,
        name: input.file.name,
      });
      const response = await fetch(`/api/tronclass?${query}`, {
        method: 'PUT',
        cache: 'no-store',
        credentials: 'same-origin',
        redirect: 'error',
        signal: AbortSignal.timeout(60000),
        headers: { ...authHeaders, 'Content-Type': input.file.type || 'application/octet-stream' },
        body: input.file,
      });
      const value = await responseValue<unknown>(response);
      return parseResult('upload', value, {
        fileId: input.fileId,
        name: input.file.name,
        size: input.file.size,
      }) as TronClassUploadedFile;
    },
  };
}

export type TronClassClient = ReturnType<typeof createTronClassClient>;
