import {
  privateStoryPath,
  privateAssignmentPath,
  privateGroupAssignmentPath,
  privateGroupCoverPath,
  privateGroupPostPath,
} from '@campus/shared/src/privateFileAccess';
import { getAuthInstance, hasUsableFirebaseConfig } from '../firebase';

export { privateStoryPath, privateGroupAssignmentPath, privateAssignmentPath, privateGroupCoverPath, privateGroupPostPath };

export class PrivateFileStorageUnconfiguredError extends Error {
  readonly code = 'unconfigured';
  constructor(message = '私人檔案儲存尚未啟用') {
    super(message);
    this.name = 'PrivateFileStorageUnconfiguredError';
  }
}

export const HOSTED_PRIVATE_FILE_URL = 'https://nuni.tw/api/files/private';

export type PrivateFileTicket = {
  path: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  expiresAt: string;
  maxBytes: number;
};

export function isR2FileStorageEnabled(
  raw: string | undefined = process.env.EXPO_PUBLIC_FILE_STORAGE_BACKEND,
): boolean {
  return String(raw || '').trim().toLowerCase() === 'r2';
}

export function privateFileApiUrl(
  env: Record<string, string | undefined> = process.env,
): string {
  const override = String(env.EXPO_PUBLIC_FILE_STORAGE_URL || '').trim().replace(/\/+$/, '');
  return override || HOSTED_PRIVATE_FILE_URL;
}

function unavailable(statusCode?: number): never {
  throw Object.assign(new PrivateFileStorageUnconfiguredError(), { statusCode, source: 'api' });
}

async function idToken(): Promise<string> {
  if (!hasUsableFirebaseConfig()) unavailable();
  const user = getAuthInstance().currentUser;
  if (!user) throw new Error('Not signed in');
  return user.getIdToken();
}

async function issueTicket(
  action: 'upload' | 'download',
  path: string,
  extra: Record<string, unknown> = {},
): Promise<PrivateFileTicket> {
  if (!isR2FileStorageEnabled()) unavailable();
  const token = await idToken();
  const response = await fetch(privateFileApiUrl(), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action, path, ...extra }),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    error?: unknown;
    path?: unknown;
    url?: unknown;
    method?: unknown;
    headers?: unknown;
    expiresAt?: unknown;
    maxBytes?: unknown;
  };
  if (response.status === 503) unavailable(503);
  if (!response.ok) {
    const message = typeof payload.error === 'string' ? payload.error : 'File request failed';
    throw Object.assign(new Error(message), { statusCode: response.status, source: 'api' });
  }
  if (
    typeof payload.path !== 'string' ||
    typeof payload.url !== 'string' ||
    typeof payload.method !== 'string' ||
    typeof payload.expiresAt !== 'string' ||
    !payload.headers ||
    typeof payload.headers !== 'object'
  ) {
    throw new Error('File request failed');
  }
  return {
    path: payload.path,
    url: payload.url,
    method: payload.method,
    headers: payload.headers as Record<string, string>,
    expiresAt: payload.expiresAt,
    maxBytes: Number(payload.maxBytes) || 0,
  };
}

export async function uploadPrivateFile(input: {
  path: string;
  body: Blob | ArrayBuffer | Uint8Array;
  contentType: string;
}): Promise<{ path: string }> {
  const byteSize =
    input.body instanceof Blob
      ? input.body.size
      : input.body instanceof ArrayBuffer
        ? input.body.byteLength
        : input.body.byteLength;
  const ticket = await issueTicket('upload', input.path, {
    contentType: input.contentType,
    byteSize,
  });
  const response = await fetch(ticket.url, {
    method: ticket.method,
    headers: ticket.headers,
    body: input.body as BodyInit,
  });
  if (response.status === 412) throw new Error('File already exists or changed');
  if (!response.ok) throw new Error('File request failed');
  return { path: ticket.path };
}

export async function downloadPrivateFile(path: string): Promise<Blob> {
  const ticket = await issueTicket('download', path);
  const response = await fetch(ticket.url, {
    method: ticket.method,
    headers: ticket.headers,
  });
  if (!response.ok) throw Object.assign(new Error('File request failed'), { statusCode: response.status, source: 'object' });
  return response.blob();
}

export { isPrivateFileObjectPath } from '@campus/shared/src/privateFileMedia';
import { resolvePrivateFileMedia } from '@campus/shared/src/privateFileMedia';

export async function resolvePrivateMedia(value: string | null | undefined): Promise<string | Blob | null> {
  return resolvePrivateFileMedia(value, isR2FileStorageEnabled(), downloadPrivateFile);
}
