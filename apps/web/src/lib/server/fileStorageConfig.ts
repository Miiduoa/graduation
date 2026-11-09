import type { S3Config } from './awsS3';

export const FILE_STORAGE_BACKEND_FLAG = 'FILE_STORAGE_BACKEND';
export const MAX_PRESIGN_TTL_SECONDS = 60;

export type FileStorageConfig = {
  backend: 'r2';
  s3: S3Config;
  presignTtlSeconds: number;
};

function flagEnabled(raw: string | undefined, expected: string): boolean {
  return String(raw || '').trim().toLowerCase() === expected;
}

export function isR2FileStorageBackend(
  raw: string | undefined = process.env.FILE_STORAGE_BACKEND,
): boolean {
  return flagEnabled(raw, 'r2');
}

export function readFileStorageConfig(
  env: Record<string, string | undefined> = process.env,
): FileStorageConfig | null {
  if (!isR2FileStorageBackend(env.FILE_STORAGE_BACKEND)) return null;
  const accountId = String(env.R2_ACCOUNT_ID || '').trim();
  const accessKeyId = String(env.R2_ACCESS_KEY_ID || '').trim();
  const secretAccessKey = String(env.R2_SECRET_ACCESS_KEY || '').trim();
  const bucket = String(env.R2_BUCKET || '').trim();
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return null;
  if (!/^[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]$/i.test(bucket)) return null;
  const customEndpoint = String(env.R2_ENDPOINT || '').trim().replace(/\/+$/, '');
  const endpoint = customEndpoint || `https://${accountId}.r2.cloudflarestorage.com`;
  if (!/^https?:\/\//i.test(endpoint)) return null;
  const ttlRaw = Number(env.R2_PRESIGN_TTL_SECONDS || MAX_PRESIGN_TTL_SECONDS);
  const ttl = Number.isInteger(ttlRaw) && ttlRaw > 0 ? ttlRaw : MAX_PRESIGN_TTL_SECONDS;
  const region = String(env.R2_REGION || '').trim() || 'auto';
  return {
    backend: 'r2',
    presignTtlSeconds: Math.min(MAX_PRESIGN_TTL_SECONDS, ttl),
    s3: {
      accessKeyId,
      secretAccessKey,
      bucket,
      endpoint,
      region,
    },
  };
}
