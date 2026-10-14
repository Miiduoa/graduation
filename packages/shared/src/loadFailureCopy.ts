export const NETWORK_RETRY_TEXT = '請確認網路後再試';
export const TEMPORARY_UNAVAILABLE_TEXT = '暫時讀不到資料，請稍後再試';

const TIMEOUT_MARKERS = [
  'timeout',
  'timed out',
  'etimedout',
  'deadline-exceeded',
  'err_connection_timed_out',
  'aborted',
];

const NETWORK_MESSAGE_MARKERS = [
  'failed to fetch',
  'network request failed',
  'networkerror when attempting to fetch',
  'load failed',
  'the internet connection appears to be offline',
  'client is offline',
  'err_internet_disconnected',
  'err_name_not_resolved',
  'err_address_unreachable',
  'err_network_changed',
  'enotfound',
  'enetunreach',
  'enetdown',
  'eai_again',
];

const NETWORK_CODES = new Set([
  'ENOTFOUND',
  'ENETUNREACH',
  'ENETDOWN',
  'EAI_AGAIN',
  'ERR_INTERNET_DISCONNECTED',
  'ERR_NAME_NOT_RESOLVED',
  'ERR_ADDRESS_UNREACHABLE',
  'ERR_NETWORK_CHANGED',
  'NETWORK_ERROR',
]);

export type LoadFailureCopyOptions = {
  online?: boolean | null;
};

function textOf(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.message;
  if (value && typeof value === 'object' && 'message' in value) {
    const message = (value as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return '';
}

function codeOf(value: unknown): string {
  if (!value || typeof value !== 'object' || !('code' in value)) return '';
  const code = (value as { code?: unknown }).code;
  return typeof code === 'string' ? code : '';
}

function nameOf(value: unknown): string {
  if (value instanceof Error) return value.name;
  if (value && typeof value === 'object' && 'name' in value) {
    const name = (value as { name?: unknown }).name;
    if (typeof name === 'string') return name;
  }
  return '';
}

function chain(error: unknown): unknown[] {
  const items: unknown[] = [];
  const seen = new Set<unknown>();
  let current = error;
  while (current != null && !seen.has(current)) {
    seen.add(current);
    items.push(current);
    if (typeof current !== 'object' || !('cause' in current)) break;
    current = (current as { cause?: unknown }).cause;
  }
  return items;
}

function combinedText(error: unknown): string {
  return chain(error)
    .flatMap((item) => [textOf(item), codeOf(item), nameOf(item)])
    .join(' ')
    .toLowerCase();
}

export function isDeviceOffline(online?: boolean | null): boolean {
  return online === false;
}

export function isTimeoutFailure(error: unknown): boolean {
  const text = combinedText(error);
  return TIMEOUT_MARKERS.some((marker) => text.includes(marker));
}

export function isNetworkLayerError(error: unknown): boolean {
  if (error == null) return false;
  if (isTimeoutFailure(error)) return false;
  for (const item of chain(error)) {
    const code = codeOf(item);
    if (
      NETWORK_CODES.has(code) ||
      NETWORK_CODES.has(code.replace(/^functions\//, '').toUpperCase())
    ) {
      return true;
    }
    const name = nameOf(item).toLowerCase();
    const message = textOf(item).toLowerCase();
    if (name === 'networkerror') return true;
    if (
      NETWORK_MESSAGE_MARKERS.some((marker) => message.includes(marker) || name.includes(marker))
    ) {
      return true;
    }
    if (name === 'typeerror' && (message.includes('fetch') || message.includes('network'))) {
      return true;
    }
  }
  return false;
}

export function isNetworkUnavailable(
  error?: unknown,
  options: LoadFailureCopyOptions = {},
): boolean {
  return isDeviceOffline(options.online) || isNetworkLayerError(error);
}

export function loadFailureCopy(error?: unknown, options: LoadFailureCopyOptions = {}): string {
  return isNetworkUnavailable(error, options) ? NETWORK_RETRY_TEXT : TEMPORARY_UNAVAILABLE_TEXT;
}
