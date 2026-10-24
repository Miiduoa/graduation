import {
  areFunctionsConfigured,
  normalizeFunctionsBaseUrl,
  resolveFunctionsHttpUrl,
} from './functionsUrl';

export { areFunctionsConfigured };

type EnvMap = Record<string, string | undefined>;

// Next only inlines statically named public variables in browser bundles.
// Keep the explicit allowlist here; passing process.env loses these values.
function publicFunctionsEnv(): EnvMap {
  return {
    NEXT_PUBLIC_USE_FIREBASE_EMULATOR: process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR,
    NEXT_PUBLIC_FUNCTIONS_BASE_URL: process.env.NEXT_PUBLIC_FUNCTIONS_BASE_URL,
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    NEXT_PUBLIC_CLOUD_FUNCTION_REGION: process.env.NEXT_PUBLIC_CLOUD_FUNCTION_REGION,
    NEXT_PUBLIC_FIREBASE_EMULATOR_HOST: process.env.NEXT_PUBLIC_FIREBASE_EMULATOR_HOST,
    NEXT_PUBLIC_FIREBASE_EMULATOR_FUNCTIONS_PORT:
      process.env.NEXT_PUBLIC_FIREBASE_EMULATOR_FUNCTIONS_PORT,
  };
}

function emulatorEnabled(env: EnvMap): boolean {
  const flag = String(env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR || '')
    .trim()
    .toLowerCase();
  return flag === '1' || flag === 'true';
}

export function getFunctionsBaseUrl(env: EnvMap = publicFunctionsEnv()): string | null {
  if (emulatorEnabled(env)) return null;
  return normalizeFunctionsBaseUrl(env.NEXT_PUBLIC_FUNCTIONS_BASE_URL);
}

export function getCloudFunctionUrl(
  functionName: string,
  options: { projectId?: string; region?: string; env?: EnvMap } = {},
): string {
  const env = options.env || publicFunctionsEnv();
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
