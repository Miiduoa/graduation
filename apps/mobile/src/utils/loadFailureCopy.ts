import {
  loadFailureCopy as sharedLoadFailureCopy,
  loadServiceFailureCopy as sharedLoadServiceFailureCopy,
  type LoadFailureCopyOptions,
} from '@campus/shared/src/loadFailureCopy';
import { isPermissionDeniedError } from '@campus/shared/src/signedInSocialReads';
import { getNetworkStatus } from '../services/offline';

export {
  NETWORK_RETRY_TEXT,
  SERVICE_PAUSED_TEXT,
  TEMPORARY_UNAVAILABLE_TEXT,
  isDeviceOffline,
  isNetworkLayerError,
  isNetworkUnavailable,
  isTimeoutFailure,
  shouldOfferLoadRetry,
} from '@campus/shared/src/loadFailureCopy';

function resolvedOnline(): boolean | undefined {
  const status = getNetworkStatus();
  if (status.type === 'unknown' && status.isInternetReachable == null) return undefined;
  if (!status.isConnected || status.isInternetReachable === false) return false;
  return true;
}

export function loadFailureCopy(error?: unknown, options: LoadFailureCopyOptions = {}): string {
  return sharedLoadFailureCopy(error, {
    online: options.online ?? resolvedOnline(),
  });
}

export function loadServiceFailureCopy(
  error?: unknown,
  options: LoadFailureCopyOptions = {},
): string {
  return sharedLoadServiceFailureCopy(error, {
    online: options.online ?? resolvedOnline(),
  });
}

export function loadFailureOrLoginCopy(error: unknown, loginPrompt: string): string {
  if (isPermissionDeniedError(error)) return loginPrompt;
  if (error instanceof Error && error.message === 'missing-account') return loginPrompt;
  return loadFailureCopy(error);
}
