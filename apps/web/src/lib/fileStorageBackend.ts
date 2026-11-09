/** Client-visible switch. Server still requires FILE_STORAGE_BACKEND plus R2 keys. */
export const PUBLIC_FILE_STORAGE_BACKEND_FLAG = 'NEXT_PUBLIC_FILE_STORAGE_BACKEND';

export function isR2FileStorageEnabled(
  raw: string | undefined = process.env.NEXT_PUBLIC_FILE_STORAGE_BACKEND,
): boolean {
  return String(raw || '').trim().toLowerCase() === 'r2';
}

export function privateFileApiPath(): string {
  return '/api/files/private';
}
