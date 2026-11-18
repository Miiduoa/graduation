import { NuniError } from '@campus/shared/src/nuni';
import { isTronClassSubmissionHistory } from '@campus/shared/src/tronClassSubmissionHistory';
import { isTronClassAcknowledgedReadbackResult } from '@campus/shared/src/tronClassSubmissionConfirmation';
import {
  validNativeTronClassDownload,
  type NativeTronClassDownloadInput,
  type NativeTronClassDownloadedFile,
} from './tronClassNativeDownload';
import type {
  TronClassConnection,
  TronClassDetails,
  TronClassPreparation,
  TronClassReceipt,
  TronClassResult,
  TronClassSnapshot,
  TronClassUpload,
  TronClassUploadScope,
} from './tronClassIntegrationTypes';

export type TronClassAccess = {
  owner: string;
  isCurrent(): boolean;
  request(input: Record<string, unknown>): Promise<unknown>;
  download?(input: NativeTronClassDownloadInput): Promise<NativeTronClassDownloadedFile>;
  upload(scope: TronClassUploadScope, bytes: Uint8Array, contentType: string): Promise<unknown>;
};
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= 100_000;
const nullableText = (value: unknown) => value === null || text(value);
const id = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const count = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const time = (value: unknown) =>
  text(value) &&
  value.length === 24 &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString() === value;
const revision = (value: unknown) => text(value) && /^[a-f0-9]{32}$/.test(value);
const array = (value: unknown, check: (row: unknown) => boolean, max = 5000): value is unknown[] =>
  Array.isArray(value) && value.length <= max && value.every(check);
const only = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).every((key) => keys.includes(key));
const invalid = (): never => {
  throw new NuniError(502, 'INVALID_RESPONSE');
};
export const isTronClassOperationId = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{16,80}$/.test(value);

export function parseNativeTronClassConnection(value: unknown): TronClassConnection {
  if (
    !record(value) ||
    value.schoolId !== 'pu' ||
    typeof value.connected !== 'boolean' ||
    !(value.revision === null || revision(value.revision)) ||
    !nullableText(value.account) ||
    !nullableText(value.userName) ||
    !(value.expiresAt === null || time(value.expiresAt)) ||
    !(
      value.studentKey === undefined ||
      value.studentKey === null ||
      (value.connected &&
        typeof value.studentKey === 'string' &&
        /^[a-f0-9]{64}$/.test(value.studentKey))
    ) ||
    (value.connected && (!revision(value.revision) || !text(value.account) || !value.account))
  )
    return invalid();
  return value as TronClassConnection;
}

export function parseNativeTronClassSnapshot(value: unknown): TronClassSnapshot {
  const scoped = (row: unknown): row is Record<string, unknown> =>
    record(row) &&
    (row.courseId === null || id(row.courseId)) &&
    text(row.courseName) &&
    text(row.title) &&
    text(row.href);
  if (
    !record(value) ||
    !revision(value.revision) ||
    !time(value.fetchedAt) ||
    typeof value.partial !== 'boolean' ||
    !array(
      value.courses,
      (row) =>
        record(row) &&
        id(row.id) &&
        text(row.name) &&
        text(row.code) &&
        array(row.teachers, text, 100) &&
        nullableText(row.semester) &&
        text(row.status) &&
        text(row.href),
      1000,
    ) ||
    !array(
      value.homework,
      (row) =>
        scoped(row) &&
        id(row.id) &&
        id(row.courseId) &&
        (row.deadline === null || time(row.deadline)) &&
        text(row.deadlineLabel) &&
        (row.submitted === null || typeof row.submitted === 'boolean') &&
        text(row.description),
    ) ||
    !array(
      value.announcements,
      (row) =>
        scoped(row) &&
        (text(row.id) || id(row.id)) &&
        text(row.content) &&
        (row.publishedAt === null || time(row.publishedAt)) &&
        text(row.source),
    ) ||
    !array(
      value.materials,
      (row) =>
        scoped(row) &&
        (text(row.id) || id(row.id)) &&
        text(row.type) &&
        array(
          row.files,
          (file) =>
            record(file) &&
            text(file.name) &&
            typeof file.allowDownload === 'boolean' &&
            nullableText(file.downloadHref),
          500,
        ),
    ) ||
    !array(
      value.errors,
      (row) =>
        record(row) &&
        (row.courseId === null || id(row.courseId)) &&
        ['courses', 'homework', 'materials', 'announcements'].includes(String(row.area)) &&
        text(row.message),
      1000,
    )
  )
    return invalid();
  const snapshot = value as TronClassSnapshot;
  const courses = new Set(snapshot.courses.map((course) => course.id));
  const homework = new Set(snapshot.homework.map((row) => `${row.courseId}:${row.id}`));
  if (
    courses.size !== snapshot.courses.length ||
    homework.size !== snapshot.homework.length ||
    snapshot.homework.some((row) => !courses.has(row.courseId))
  )
    return invalid();
  return snapshot;
}

function isReceipt(
  value: unknown,
  scope: { courseId: number; homeworkId: number },
): value is TronClassReceipt {
  return (
    record(value) &&
    value.source === 'tronclass' &&
    value.status === 'submitted' &&
    value.courseId === scope.courseId &&
    value.homeworkId === scope.homeworkId &&
    text(value.id) &&
    value.id.length > 0 &&
    time(value.submittedAt) &&
    text(value.content) &&
    array(value.attachments, (file) => record(file) && text(file.name) && count(file.size), 100)
  );
}
function isDetails(value: unknown): value is TronClassDetails {
  if (!record(value)) return false;
  if (value.status === 'unavailable') return only(value, ['status']);
  const flag = (value: unknown) => value === null || typeof value === 'boolean';
  const optionalCount = (value: unknown) => value === null || count(value);
  if (
    value.status !== 'available' ||
    !time(value.fetchedAt) ||
    !only(value, [
      'status',
      'fetchedAt',
      'submissionType',
      'mode',
      'opensAt',
      'deadline',
      'isInProgress',
      'isClosed',
      'attempts',
      'resubmissionOpen',
      'retractAllowed',
    ]) ||
    !['individual', 'group', 'unknown'].includes(String(value.submissionType)) ||
    !['normal', 'multiple', 'unknown'].includes(String(value.mode)) ||
    !(value.opensAt === null || time(value.opensAt)) ||
    !(value.deadline === null || time(value.deadline)) ||
    !flag(value.isInProgress) ||
    !flag(value.isClosed) ||
    !flag(value.resubmissionOpen) ||
    !flag(value.retractAllowed) ||
    !record(value.attempts) ||
    !only(value.attempts, ['unlimited', 'limit', 'used', 'remaining'])
  )
    return false;
  const attempts = value.attempts;
  if (
    !flag(attempts.unlimited) ||
    !optionalCount(attempts.limit) ||
    !optionalCount(attempts.used) ||
    !optionalCount(attempts.remaining) ||
    (attempts.unlimited === true && attempts.limit !== null)
  )
    return false;
  return (
    attempts.remaining ===
    (attempts.unlimited === false && count(attempts.limit) && count(attempts.used)
      ? Math.max(0, attempts.limit - attempts.used)
      : null)
  );
}
export function parseNativeTronClassPreparation(
  value: unknown,
  scope: { courseId: number; homeworkId: number },
): TronClassPreparation {
  if (
    !record(value) ||
    value.source !== 'tronclass' ||
    value.schoolId !== 'pu' ||
    value.courseId !== scope.courseId ||
    value.homeworkId !== scope.homeworkId ||
    !revision(value.revision) ||
    !text(value.title) ||
    !text(value.description) ||
    !(value.deadline === null || time(value.deadline)) ||
    typeof value.canSubmit !== 'boolean' ||
    !nullableText(value.blockedReason) ||
    !count(value.maxFiles) ||
    !count(value.maxFileBytes) ||
    !array(value.allowedContentTypes, text, 100) ||
    !(value.receipt === null || isReceipt(value.receipt, scope))
  )
    return invalid();
  if (value.rules !== undefined) {
    const rules = value.rules;
    if (!record(rules)) return invalid();
    if (rules.status === 'unknown') {
      if (!only(rules, ['status']) || value.canSubmit) return invalid();
    } else if (rules.status === 'confirmed') {
      if (
        !only(rules, ['status', 'allowsText', 'allowsAttachments', 'maxTotalBytes']) ||
        typeof rules.allowsText !== 'boolean' ||
        typeof rules.allowsAttachments !== 'boolean' ||
        !count(rules.maxTotalBytes) ||
        !array(
          value.allowedContentTypes,
          (type) =>
            text(type) &&
            type.length <= 100 &&
            /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(type),
          50,
        )
      )
        return invalid();
    } else return invalid();
  }
  if (value.details !== undefined && !isDetails(value.details)) return invalid();
  if (value.history !== undefined && !isTronClassSubmissionHistory(value.history, scope))
    return invalid();
  return value as TronClassPreparation;
}

export function parseNativeTronClassResult(
  value: unknown,
  scope: { operationId: string; courseId: number; homeworkId: number },
): TronClassResult {
  if (!isTronClassOperationId(scope.operationId) || !id(scope.courseId) || !id(scope.homeworkId))
    return invalid();
  if (isTronClassAcknowledgedReadbackResult(value, scope)) return value;
  if (
    !record(value) ||
    !only(value, ['status', 'operationId', 'receipt']) ||
    value.operationId !== scope.operationId ||
    !['submitted', 'unknown'].includes(String(value.status)) ||
    (value.status === 'submitted' ? !isReceipt(value.receipt, scope) : value.receipt !== null)
  )
    return invalid();
  return value as TronClassResult;
}

export function createNativeTronClassClient(access: TronClassAccess) {
  const assertCurrent = () => {
    if (!access.isCurrent()) throw new NuniError(409, 'SESSION_CHANGED');
  };
  async function request(action: string, input: Record<string, unknown> = {}): Promise<unknown> {
    assertCurrent();
    try {
      const result = await access.request({ ...input, action });
      assertCurrent();
      return result;
    } catch (error) {
      assertCurrent();
      throw error;
    }
  }
  const sameRevision = <T extends { revision: string }>(value: T, expected: string): T => {
    if (!revision(expected) || value.revision !== expected)
      throw new NuniError(409, 'TRONCLASS_BINDING_CHANGED');
    return value;
  };
  return {
    owner: access.owner,
    isCurrent: access.isCurrent,
    async status() {
      return parseNativeTronClassConnection(await request('status'));
    },
    async connect(account: string, password: string, expectedRevision: string | null) {
      if (
        !account.trim() ||
        account.length > 200 ||
        !password ||
        password.length > 1000 ||
        !(expectedRevision === null || revision(expectedRevision))
      )
        throw new NuniError(422, 'TRONCLASS_INVALID_INPUT');
      const result = parseNativeTronClassConnection(
        await request('connect', {
          schoolId: 'pu',
          account: account.trim(),
          password,
          expectedRevision,
        }),
      );
      if (!result.connected) return invalid();
      return result;
    },
    async disconnect(expectedRevision: string | null) {
      const result = parseNativeTronClassConnection(
        await request('disconnect', { expectedRevision }),
      );
      if (result.connected) return invalid();
      return result;
    },
    async sync(expectedRevision: string, courseId?: number) {
      if (courseId !== undefined && !id(courseId))
        throw new NuniError(422, 'TRONCLASS_INVALID_INPUT');
      const value = sameRevision(
        parseNativeTronClassSnapshot(
          await request('sync', courseId === undefined ? {} : { courseId }),
        ),
        expectedRevision,
      );
      if (
        courseId !== undefined &&
        (!value.courses.some((course) => course.id === courseId) ||
          [...value.homework, ...value.announcements, ...value.materials].some(
            (row) => row.courseId !== courseId,
          ))
      )
        return invalid();
      return value;
    },
    async download(input: NativeTronClassDownloadInput) {
      assertCurrent();
      if (!validNativeTronClassDownload(input)) throw new NuniError(422, 'TRONCLASS_INVALID_INPUT');
      if (!access.download) throw new NuniError(503, 'TRONCLASS_DOWNLOAD_UNAVAILABLE');
      const value = await access.download(input);
      assertCurrent();
      return value;
    },
    async prepare(courseId: number, homeworkId: number, expectedRevision: string) {
      if (!id(courseId) || !id(homeworkId)) throw new NuniError(422, 'TRONCLASS_INVALID_INPUT');
      return sameRevision(
        parseNativeTronClassPreparation(await request('prepare', { courseId, homeworkId }), {
          courseId,
          homeworkId,
        }),
        expectedRevision,
      );
    },
    async submit(input: {
      courseId: number;
      homeworkId: number;
      revision: string;
      operationId: string;
      content: string;
      attachments: string[];
      confirmed: true;
    }) {
      if (
        !id(input.courseId) ||
        !id(input.homeworkId) ||
        !revision(input.revision) ||
        !isTronClassOperationId(input.operationId) ||
        input.confirmed !== true ||
        typeof input.content !== 'string' ||
        input.content.length > 20000 ||
        !array(input.attachments, isTronClassOperationId, 4) ||
        new Set(input.attachments).size !== input.attachments.length
      )
        throw new NuniError(422, 'TRONCLASS_INVALID_INPUT');
      return parseNativeTronClassResult(await request('submit', input), input);
    },
    async reconcile(scope: {
      operationId: string;
      revision: string;
      courseId: number;
      homeworkId: number;
    }) {
      if (!isTronClassOperationId(scope.operationId) || !revision(scope.revision))
        throw new NuniError(422, 'TRONCLASS_INVALID_INPUT');
      return parseNativeTronClassResult(
        await request('reconcile', { operationId: scope.operationId, revision: scope.revision }),
        scope,
      );
    },
    async upload(
      scope: TronClassUploadScope,
      bytes: Uint8Array,
      contentType: string,
      sha256: string,
    ): Promise<TronClassUpload> {
      assertCurrent();
      if (
        !id(scope.courseId) ||
        !id(scope.homeworkId) ||
        !revision(scope.revision) ||
        !isTronClassOperationId(scope.operationId) ||
        !isTronClassOperationId(scope.fileId) ||
        !scope.name ||
        scope.name.length > 200 ||
        /[\\/]/.test(scope.name) ||
        Array.from(scope.name).some(
          (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
        ) ||
        !(bytes instanceof Uint8Array) ||
        bytes.byteLength <= 0 ||
        bytes.byteLength > 10 * 1024 * 1024 ||
        !/^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/.test(contentType) ||
        !/^[a-f0-9]{64}$/.test(sha256)
      )
        throw new NuniError(422, 'TRONCLASS_INVALID_INPUT');
      const result = await access.upload(scope, bytes, contentType);
      assertCurrent();
      if (
        !record(result) ||
        result.status !== 'uploaded' ||
        result.fileId !== scope.fileId ||
        result.name !== scope.name ||
        result.size !== bytes.byteLength ||
        result.contentType !== contentType ||
        result.sha256 !== sha256 ||
        !/^[a-f0-9]{64}$/.test(sha256)
      )
        return invalid();
      return result as TronClassUpload;
    },
  };
}
export type NativeTronClassClient = ReturnType<typeof createNativeTronClassClient>;

export function tronClassConnectionLost(error: unknown): boolean {
  return (
    error instanceof NuniError &&
    [
      'TRONCLASS_RECONNECT_REQUIRED',
      'TRONCLASS_BINDING_CHANGED',
      'TRONCLASS_NOT_CONNECTED',
    ].includes(error.code)
  );
}
export function nativeTronClassError(error: unknown): string {
  const code = error instanceof NuniError ? error.code : '';
  const messages: Record<string, string> = {
    SESSION_CHANGED: '登入帳號已變更，請重新開啟這個頁面。',
    SESSION_EXPIRED: 'nuni 登入已到期，請重新登入。',
    SIGN_IN_REQUIRED: '請先登入 nuni 再連接 TronClass。',
    TRONCLASS_BINDING_CHANGED: 'TronClass 連接已變更，請重新讀取狀態。',
    TRONCLASS_RECONNECT_REQUIRED: 'TronClass 登入已到期，請重新連接。',
    TRONCLASS_NOT_CONNECTED: '請先連接 TronClass 帳號。',
    TRONCLASS_LOGIN_FAILED: '無法登入 TronClass，請確認學校帳號與密碼。',
    TRONCLASS_INVALID_CREDENTIALS: '無法登入 TronClass，請確認學校帳號與密碼。',
    TRONCLASS_LOGIN_RATE_LIMITED: '登入嘗試過於頻繁，請於 15 分鐘後再試。',
    TRONCLASS_RATE_LIMITED: '操作較頻繁，請稍候再試。',
    TRONCLASS_IDENTITY_UNVERIFIED: '尚未確認校方帳號身分，請重新連接。',
    TRONCLASS_CONFIGURATION_REQUIRED: 'TronClass 連接服務尚未完成設定。',
    TRONCLASS_WRITE_DISABLED: '目前可以整理與預覽作業，正式繳交請使用校方原頁。',
    TRONCLASS_WRITES_DISABLED: '目前可以整理與預覽作業，正式繳交請使用校方原頁。',
    TRONCLASS_SUBMISSION_BLOCKED: '最新規則不允許繳交，請重新查看作業要求。',
    TRONCLASS_SUBMISSION_NOT_FOUND: '尚未找到這次操作的確認紀錄，請到校方原頁確認；App 不會重送。',
    TRONCLASS_READ_TIMEOUT: '校方回應較慢，請稍後重試。',
    TRONCLASS_DOWNLOAD_TOO_LARGE: '教材超過 25 MB，請使用校方原頁下載。',
    TRONCLASS_DOWNLOAD_TIMEOUT: '教材下載逾時，請稍後重試。',
    TRONCLASS_MATERIAL_DOWNLOAD_DENIED: '校方尚未允許下載這份教材，請重新讀取課程。',
    INVALID_RESPONSE: '尚未收到可確認的回覆，請重新查詢。',
    NETWORK_ERROR: '目前無法連線，請確認網路後重試。',
  };
  return messages[code] ?? '目前無法完成這項操作，請稍後重試。';
}

export function safeTronClassSourceHref(value: string): string | null {
  try {
    const url = new URL(value);
    return url.origin === 'https://tronclass.pu.edu.tw' && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

export function nativeTronClassDownloadTarget(
  material: TronClassSnapshot['materials'][number],
  file: TronClassSnapshot['materials'][number]['files'][number],
  expectedRevision: string,
): NativeTronClassDownloadInput | null {
  if (!file.allowDownload || !file.downloadHref || !id(material.courseId)) return null;
  const safe = safeTronClassSourceHref(file.downloadHref);
  if (!safe) return null;
  try {
    const url = new URL(safe);
    if (url.search || url.hash) return null;
    const match = /^\/api\/uploads\/([^/]+)\/blob$/.exec(url.pathname);
    const uploadKey = match ? decodeURIComponent(match[1]) : '';
    const activityId =
      typeof material.id === 'number'
        ? material.id
        : /^[1-9]\d*$/.test(material.id)
          ? Number(material.id)
          : 0;
    const input = {
      courseId: material.courseId,
      activityId,
      uploadKey,
      revision: expectedRevision,
    };
    return validNativeTronClassDownload(input) ? input : null;
  } catch {
    return null;
  }
}
