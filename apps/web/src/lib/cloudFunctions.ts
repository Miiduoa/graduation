import { normalizeFunctionsBaseUrl, resolveFunctionsHttpUrl } from './functionsUrl';

type EnvMap = Record<string, string | undefined>;

function emulatorEnabled(env: EnvMap = process.env): boolean {
  const flag = String(env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR || '')
    .trim()
    .toLowerCase();
  return flag === '1' || flag === 'true';
}

export function getFunctionsBaseUrl(env: EnvMap = process.env): string | null {
  if (emulatorEnabled(env)) return null;
  return normalizeFunctionsBaseUrl(env.NEXT_PUBLIC_FUNCTIONS_BASE_URL);
}

export function getCloudFunctionUrl(
  functionName: string,
  options: { projectId?: string; region?: string; env?: EnvMap } = {},
): string {
  const env = options.env || process.env;
  const projectId = options.projectId || env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const region = options.region || env.NEXT_PUBLIC_CLOUD_FUNCTION_REGION || 'asia-east1';
  if (emulatorEnabled(env)) {
    return resolveFunctionsHttpUrl({
      functionName,
      projectId,
      region,
      emulator: {
        host: env.NEXT_PUBLIC_FIREBASE_EMULATOR_HOST || 'localhost',
        port: Number(env.NEXT_PUBLIC_FIREBASE_EMULATOR_FUNCTIONS_PORT || '5001'),
        projectId,
      },
    });
  }
  return resolveFunctionsHttpUrl({
    functionName,
    projectId,
    region,
    baseUrl: getFunctionsBaseUrl(env),
  });
}
