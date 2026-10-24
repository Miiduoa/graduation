export function normalizeFunctionsBaseUrl(raw?: string | null): string | null {
  const trimmed = String(raw || '')
    .trim()
    .replace(/\/+$/, '');
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function emulatorFlagEnabled(raw?: string | null): boolean {
  const flag = String(raw || '')
    .trim()
    .toLowerCase();
  return flag === '1' || flag === 'true';
}

/**
 * Cloud Functions are available when a custom HTTP base URL is set, or when
 * the Firebase emulator is on. Production Spark projects have no
 * asia-east1-*.cloudfunctions.net endpoints.
 */
export function areFunctionsConfigured(
  baseUrl: string | null | undefined = process.env.NEXT_PUBLIC_FUNCTIONS_BASE_URL,
  emulatorEnabled = emulatorFlagEnabled(process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR),
): boolean {
  return Boolean(emulatorEnabled) || Boolean(normalizeFunctionsBaseUrl(baseUrl));
}

export const FUNCTIONS_UNCONFIGURED_CODE = 'functions-unconfigured';

export class FunctionsUnconfiguredError extends Error {
  readonly code = FUNCTIONS_UNCONFIGURED_CODE;
  constructor(message = '此功能尚未啟用') {
    super(message);
    this.name = 'FunctionsUnconfiguredError';
  }
}

export function isFunctionsUnconfiguredError(error: unknown): boolean {
  if (error instanceof FunctionsUnconfiguredError) return true;
  if (!error || typeof error !== 'object') return false;
  const code = 'code' in error ? String((error as { code?: unknown }).code || '') : '';
  return code === FUNCTIONS_UNCONFIGURED_CODE || code === 'unconfigured';
}

export function resolveFunctionsHttpUrl(options: {
  functionName: string;
  projectId?: string;
  region?: string;
  baseUrl?: string | null;
  emulator?: { host: string; port: number; projectId?: string; region?: string } | null;
}): string {
  if (options.emulator) {
    const projectId = options.emulator.projectId || options.projectId;
    const region = options.emulator.region || options.region || 'asia-east1';
    if (!projectId) {
      throw new Error('Firebase projectId is missing. Check your web environment variables.');
    }
    return `http://${options.emulator.host}:${options.emulator.port}/${projectId}/${region}/${options.functionName}`;
  }

  const base = normalizeFunctionsBaseUrl(options.baseUrl);
  if (base) return `${base}/${options.functionName}`;

  const region = options.region || 'asia-east1';
  if (!options.projectId) {
    throw new Error('Firebase projectId is missing. Check your web environment variables.');
  }
  return `https://${region}-${options.projectId}.cloudfunctions.net/${options.functionName}`;
}
