export const LOGIN_REQUIRED_LOST_FOUND_AND_COMMENTS_TEXT = '登入後才能看失物招領和評論';
export const LOGIN_REQUIRED_COMMENTS_TEXT = '登入後才能看評論';
export const LOGIN_REQUIRED_ACTION_TEXT = '登入';

export function sanitizeLoginReturnPath(value?: string | null, fallback = '/'): string {
  if (!value) return fallback;
  if (!value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(value)) {
    return fallback;
  }
  try {
    if (new URL(value, 'https://campus.local').origin !== 'https://campus.local') return fallback;
    return value;
  } catch {
    return fallback;
  }
}

export function isPermissionDeniedError(error: unknown): boolean {
  const code =
    error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
      ? error.code
      : '';
  if (code === 'permission-denied' || code.endsWith('/permission-denied')) return true;
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /Missing or insufficient permissions|permission-denied/i.test(message);
}

export function permissionDeniedError(): Error & { code: string } {
  const error = new Error('permission-denied') as Error & { code: string };
  error.code = 'permission-denied';
  return error;
}
