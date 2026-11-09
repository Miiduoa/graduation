import 'server-only';
import { createHmac } from 'node:crypto';
import { validPrivateFileName, validPrivateFileSegment } from '@campus/shared/src/privateFileAccess';
import { createClient } from '@supabase/supabase-js';
import { readFileStorageConfig, type FileStorageConfig } from './fileStorageConfig';

export type SignedFileRequest = {
  url: string;
  method: 'PUT' | 'GET';
  headers: Record<string, string>;
  expiresAt: string;
};
export type FileObjectInfo = {
  contentType: string;
  contentLength: number;
  metadata: Record<string, string>;
};
export type FileStorage = {
  presignPut: (input: {
    key: string;
    contentType: string;
    contentLength: number;
    metadata?: Record<string, string>;
    now?: Date;
  }) => Promise<SignedFileRequest>;
  presignGet: (input: { key: string; contentType?: string; attachment?: boolean; now?: Date }) => Promise<SignedFileRequest>;
  head: (key: string) => Promise<FileObjectInfo | null>;
  remove: (key: string) => Promise<void>;
};

export function createSupabaseFileStorage(config: FileStorageConfig, fetchImpl: typeof fetch = fetch): FileStorage {
  const assertKey = (key: string) => {
    const parts = key.split('/');
    const expected = `/${config.bucket}/${key}`;
    if (!validPrivateFileSegment(config.bucket) || !parts.slice(0, -1).every(validPrivateFileSegment) ||
      !validPrivateFileName(parts.at(-1)) || new URL(expected, config.url).pathname !== expected) {
      throw new Error('Invalid file storage path');
    }
  };
  const assertSignedUrl = (url: string, key: string, operation: 'sign' | 'upload/sign') => {
    const parsed = new URL(url);
    const base = new URL(config.url);
    if (parsed.origin !== base.origin || parsed.pathname !== `${base.pathname.replace(/\/$/, '')}/storage/v1/object/${operation}/${config.bucket}/${key}`) {
      throw new Error('Invalid file storage path');
    }
  };
  const bucketForKey = (key: string) => {
    assertKey(key);
    return createClient(config.url, config.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: async (input, init) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        const base = new URL(config.url);
        const prefix = `${base.pathname.replace(/\/$/, '')}/storage/v1/object/`;
        const expected = `${config.bucket}/${key}`;
        const paths = ['upload/sign/', 'sign/', 'info/'].map((operation) => `${prefix}${operation}${expected}`);
        if (init?.method === 'DELETE') paths.push(`${prefix}${config.bucket}`);
        if (url.origin !== base.origin || !paths.includes(url.pathname) || url.search || url.hash) {
          throw new Error('Invalid file storage path');
        }
        return fetchImpl(input, init);
      } },
    }).storage.from(config.bucket);
  };
  // Storage user metadata is client controlled; authenticate story ownership separately.
  const ownerProof = (key: string, uid: string) => createHmac('sha256', config.serviceRoleKey)
    .update(JSON.stringify(['private-file-owner-v1', key, uid])).digest('hex');
  const failed = () => new Error('File storage request failed');
  return {
    async presignPut({ key, contentType, metadata, now = new Date() }) {
      const { data, error } = await bucketForKey(key).createSignedUploadUrl(key, { upsert: false });
      if (error || !data) throw failed();
      assertSignedUrl(data.signedUrl, key, 'upload/sign');
      const headers: Record<string, string> = { 'content-type': contentType, 'cache-control': 'private, no-store' };
      const displayMetadata = metadata?.originalFilename ? { originalFilename: metadata.originalFilename } : {};
      if (metadata?.['owner-uid'] || metadata?.originalFilename) {
        headers['x-metadata'] = Buffer.from(JSON.stringify({
          ...displayMetadata,
          ...(metadata['owner-uid'] ? { ownerUid: metadata['owner-uid'], ownerProof: ownerProof(key, metadata['owner-uid']) } : {}),
        })).toString('base64');
      }
      return { url: data.signedUrl, method: 'PUT', headers, expiresAt: new Date(now.getTime() + 7200_000).toISOString() };
    },
    async presignGet({ key, attachment, now = new Date() }) {
      const ttl = Math.min(60, Math.max(1, config.presignTtlSeconds));
      const { data, error } = await bucketForKey(key).createSignedUrl(key, ttl, {
        download: attachment ? key.split('/').at(-1) : false,
      });
      if (error || !data) throw failed();
      assertSignedUrl(data.signedUrl, key, 'sign');
      return { url: data.signedUrl, method: 'GET', headers: {}, expiresAt: new Date(now.getTime() + ttl * 1000).toISOString() };
    },
    async head(key) {
      const { data, error } = await bucketForKey(key).info(key);
      if (error) {
        if ('statusCode' in error && String(error.statusCode) === '404') return null;
        throw failed();
      }
      if (!data) throw failed();
      const metadata: Record<string, string> = {};
      const user = data.metadata as Record<string, unknown> | undefined;
      if (typeof user?.ownerUid === 'string' && user.ownerProof === ownerProof(key, user.ownerUid)) {
        metadata['owner-uid'] = user.ownerUid;
      }
      return { contentType: String(data.contentType || '').split(';')[0].trim().toLowerCase(), contentLength: data.size ?? NaN, metadata };
    },
    async remove(key) {
      const { error } = await bucketForKey(key).remove([key]);
      if (error) throw failed();
    },
  };
}

export function getFileStorage(env: Record<string, string | undefined> = process.env, fetchImpl: typeof fetch = fetch): FileStorage | null {
  const config = readFileStorageConfig(env);
  return config ? createSupabaseFileStorage(config, fetchImpl) : null;
}
