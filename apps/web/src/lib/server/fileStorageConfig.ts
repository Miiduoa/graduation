import 'server-only';

export const FILE_STORAGE_BACKEND_FLAG = 'FILE_STORAGE_BACKEND';
export const MAX_PRESIGN_TTL_SECONDS = 60;

export type FileStorageConfig = {
  backend: 'supabase';
  url: string;
  serviceRoleKey: string;
  bucket: string;
  presignTtlSeconds: number;
};

export function readFileStorageConfig(
  env: Record<string, string | undefined> = process.env,
): FileStorageConfig | null {
  if (env.FILE_STORAGE_BACKEND?.trim().toLowerCase() !== 'supabase') return null;
  const url = env.SUPABASE_URL?.trim().replace(/\/+$/, '') || '';
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim() || '';
  const bucket = env.SUPABASE_STORAGE_BUCKET?.trim() || '';
  if (!url || !serviceRoleKey || !/^[a-z0-9][a-z0-9._-]*$/i.test(bucket)) return null;
  try {
    const parsed = new URL(url);
    if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) return null;
  } catch { return null; }
  return { backend: 'supabase', url, serviceRoleKey, bucket, presignTtlSeconds: MAX_PRESIGN_TTL_SECONDS };
}
