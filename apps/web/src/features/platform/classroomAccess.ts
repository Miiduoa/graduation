import { NuniError } from '@campus/shared/src/nuni';
import type { PlatformResponse } from './platformFetch';

export const CLASSROOM_ACCESS_ERROR = '目前無法存取這門課程，請重新確認課程權限。';

export function classroomAccessDenied(value: unknown): boolean {
  if (value instanceof NuniError)
    return [401, 403, 404].includes(value.status) || value.code === 'SESSION_CHANGED';
  if (!value || typeof value !== 'object') return false;
  const response = value as PlatformResponse;
  const error = response.body?.error;
  return (
    [401, 403, 404].includes(response.status) ||
    error === 'SESSION_CHANGED' ||
    (!!error && typeof error === 'object' && 'code' in error && error.code === 'SESSION_CHANGED')
  );
}
