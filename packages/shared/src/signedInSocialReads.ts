export const LOGIN_REQUIRED_LOST_FOUND_AND_COMMENTS_TEXT = '登入後才能看失物招領和評論';
export const LOGIN_REQUIRED_ACTION_TEXT = '登入';

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
