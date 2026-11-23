import { NuniError } from '@campus/shared/src/nuni';
import { withWakeRetry } from '@campus/shared/src/wakeAwareRequest';
import { getAuthInstance } from '../firebase';
import { validTronClassUploadQuery } from './nuniClient';
import { assertTronClassNativeConnectAllowed } from './tronClassNativeConnectEnabled';
import type { TronClassUploadScope } from './tronClassIntegrationTypes';
import {
  requestNativeTronClassDownload,
  requestNativeTronClassSubmissionDownload,
  validNativeTronClassDownload,
  validNativeTronClassSubmissionDownload,
  type NativeTronClassDownloadInput,
  type NativeTronClassSubmissionDownloadInput,
} from './tronClassNativeDownload';

export function isNativeTronClassFirebaseOwner(uid: string): boolean {
  return getAuthInstance().currentUser?.uid === uid;
}

export async function nativeTronClassFirebaseDownload(
  uid: string,
  isCurrent: () => boolean,
  input: NativeTronClassDownloadInput,
  signal?: AbortSignal,
) {
  if (!validNativeTronClassDownload(input)) throw new NuniError(422, 'TRONCLASS_INVALID_INPUT');
  const scope = {
    courseId: input.courseId,
    activityId: input.activityId,
    uploadKey: input.uploadKey,
    revision: input.revision,
  };
  const current = () => !signal?.aborted && isCurrent() && isNativeTronClassFirebaseOwner(uid);
  if (!current()) throw new NuniError(409, 'SESSION_CHANGED');
  const user = getAuthInstance().currentUser;
  if (!user || typeof user.getIdToken !== 'function' || uid.startsWith('demo_'))
    throw new NuniError(401, 'SIGN_IN_REQUIRED');
  const token = await user.getIdToken();
  if (!current()) throw new NuniError(409, 'SESSION_CHANGED');
  return requestNativeTronClassDownload(`Bearer ${token}`, scope, current, signal);
}

export async function nativeTronClassFirebaseSubmissionDownload(
  uid: string,
  isCurrent: () => boolean,
  input: NativeTronClassSubmissionDownloadInput,
  signal?: AbortSignal,
) {
  if (!validNativeTronClassSubmissionDownload(input))
    throw new NuniError(422, 'TRONCLASS_INVALID_INPUT');
  const scope = {
    courseId: input.courseId,
    homeworkId: input.homeworkId,
    submissionId: input.submissionId,
    uploadId: input.uploadId,
    revision: input.revision,
  };
  const current = () => !signal?.aborted && isCurrent() && isNativeTronClassFirebaseOwner(uid);
  if (!current()) throw new NuniError(409, 'SESSION_CHANGED');
  const user = getAuthInstance().currentUser;
  if (!user || typeof user.getIdToken !== 'function' || uid.startsWith('demo_'))
    throw new NuniError(401, 'SIGN_IN_REQUIRED');
  const token = await user.getIdToken();
  if (!current()) throw new NuniError(409, 'SESSION_CHANGED');
  const result = await requestNativeTronClassSubmissionDownload(`Bearer ${token}`, scope, current, signal);
  if (!current()) throw new NuniError(409, 'SESSION_CHANGED');
  return result;
}

export function tronClassUploadQuery(scope: TronClassUploadScope): Record<string, string> {
  const query = {
    courseId: String(scope.courseId),
    homeworkId: String(scope.homeworkId),
    revision: scope.revision,
    operationId: scope.operationId,
    fileId: scope.fileId,
    name: scope.name,
  };
  if (!validTronClassUploadQuery(query)) throw new NuniError(422, 'TRONCLASS_INVALID_INPUT');
  return query;
}

/** Firebase is used only when the caller has proved there is no active platform session. */
export async function nativeTronClassFirebaseRequest(
  uid: string,
  isCurrent: () => boolean,
  input:
    | Record<string, unknown>
    | { scope: TronClassUploadScope; bytes: Uint8Array; contentType: string },
  signal?: AbortSignal,
): Promise<unknown> {
  const action = 'action' in input ? String(input.action) : 'upload';
  assertTronClassNativeConnectAllowed(action);
  const assertCurrent = () => {
    if (!isCurrent() || signal?.aborted || getAuthInstance().currentUser?.uid !== uid)
      throw new NuniError(409, 'SESSION_CHANGED');
  };
  assertCurrent();
  const user = getAuthInstance().currentUser;
  if (!user || typeof user.getIdToken !== 'function' || uid.startsWith('demo_'))
    throw new NuniError(401, 'SIGN_IN_REQUIRED');
  const token = await user.getIdToken();
  assertCurrent();
  const upload =
    'bytes' in input && input.bytes instanceof Uint8Array
      ? (input as { scope: TronClassUploadScope; bytes: Uint8Array; contentType: string })
      : null;
  if (
    !upload &&
    !['status', 'connect', 'disconnect', 'courses', 'sync', 'prepare', 'submit', 'reconcile', 'cancel-preparation'].includes(action)
  )
    throw new NuniError(422, 'TRONCLASS_INVALID_INPUT');
  const endpoint = upload
    ? `https://nuni.tw/api/tronclass?${new URLSearchParams(tronClassUploadQuery(upload.scope))}`
    : 'https://nuni.tw/api/tronclass';
  return withWakeRetry(
    async (attemptSignal) => {
      assertCurrent();
      try {
        const response = await fetch(endpoint, {
          method: upload ? 'PUT' : 'POST',
          redirect: 'error',
          cache: 'no-store',
          signal: attemptSignal,
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${token}`,
            'Content-Type': upload?.contentType ?? 'application/json',
          },
          body: upload ? (upload.bytes as unknown as BodyInit) : JSON.stringify(input),
        });
        assertCurrent();
        const body = await response.text();
        assertCurrent();
        if (body.length > 2_000_000) throw new NuniError(502, 'INVALID_RESPONSE');
        let value: unknown;
        try {
          value = JSON.parse(body);
        } catch {
          throw new NuniError(502, 'INVALID_RESPONSE');
        }
        if (!response.ok) {
          const code =
            value && typeof value === 'object' ? (value as Record<string, unknown>).error : null;
          throw new NuniError(
            response.status,
            typeof code === 'string' && /^[A-Z0-9_]{1,100}$/.test(code) ? code : 'REQUEST_FAILED',
          );
        }
        return value;
      } catch (error) {
        assertCurrent();
        if (error instanceof NuniError) throw error;
        throw new NuniError(0, 'NETWORK_ERROR');
      }
    },
    {
      timeoutMs: ['connect', 'disconnect'].includes(action) ? 90000 : 60000,
      externalSignal: signal,
      retry: !upload && ['status', 'courses', 'sync', 'prepare', 'reconcile'].includes(action),
    },
  );
}
