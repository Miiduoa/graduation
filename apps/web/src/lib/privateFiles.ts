import {
  privateStoryPath,
  privateAssignmentPath,
  privateGroupCoverPath,
  privateGroupPostPath,
} from '@campus/shared/src/privateFileAccess';
import { FunctionsUnconfiguredError } from './functionsUrl';
import { getAuth } from './firebase';
import { isR2FileStorageEnabled, privateFileApiPath } from './fileStorageBackend';

export { privateStoryPath, privateAssignmentPath, privateGroupCoverPath, privateGroupPostPath };

export type PrivateFileTicket = {
  path: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  expiresAt: string;
  maxBytes: number;
};

export function privateFilesEnabled(
  raw: string | undefined = process.env.NEXT_PUBLIC_FILE_STORAGE_BACKEND,
): boolean {
  return isR2FileStorageEnabled(raw);
}

function unavailable(): never {
  throw new FunctionsUnconfiguredError('私人檔案儲存尚未啟用');
}

async function idToken(): Promise<string> {
  const user = getAuth()?.currentUser;
  if (!user) throw new Error('Not signed in');
  return user.getIdToken();
}

async function issueTicket(
  action: 'upload' | 'download',
  path: string,
  extra: Record<string, unknown> = {},
): Promise<PrivateFileTicket> {
  if (!privateFilesEnabled()) unavailable();
  const token = await idToken();
  const response = await fetch(privateFileApiPath(), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action, path, ...extra }),
    cache: 'no-store',
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
  if (response.status === 503) unavailable();
  if (!response.ok) {
    const message = typeof payload.error === 'string' ? payload.error : 'File request failed';
    throw Object.assign(new Error(message), { statusCode: response.status });
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
    cache: 'no-store',
  });
  if (response.status === 404) throw new Error('File not found');
  if (!response.ok) throw new Error('File request failed');
  return response.blob();
}

export { isPrivateFileObjectPath } from '@campus/shared/src/privateFileMedia';
import { resolvePrivateFileMedia } from '@campus/shared/src/privateFileMedia';

export async function resolvePrivateMedia(value: string | null | undefined): Promise<string | Blob | null> {
  return resolvePrivateFileMedia(value, privateFilesEnabled(), downloadPrivateFile);
}
