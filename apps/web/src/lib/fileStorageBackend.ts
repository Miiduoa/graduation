/** Client-visible switch. Server still requires FILE_STORAGE_BACKEND plus Supabase configuration. */
export const PUBLIC_FILE_STORAGE_BACKEND_FLAG = 'NEXT_PUBLIC_FILE_STORAGE_BACKEND';

export function isSupabaseFileStorageEnabled(
  raw: string | undefined = process.env.NEXT_PUBLIC_FILE_STORAGE_BACKEND,
): boolean {
  return String(raw || '').trim().toLowerCase() === 'supabase';
}

export function privateFileApiPath(): string {
  return '/api/files/private';
}
