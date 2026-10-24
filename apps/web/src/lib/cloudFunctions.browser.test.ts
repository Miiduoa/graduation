// @vitest-environment node
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { expect, it } from 'vitest';

type ClientExports = typeof import('./cloudFunctions');

async function browserBundle(publicEnv: Record<string, string>): Promise<ClientExports> {
  const names = [
    'NEXT_PUBLIC_USE_FIREBASE_EMULATOR',
    'NEXT_PUBLIC_FUNCTIONS_BASE_URL',
    'NEXT_PUBLIC_FIREBASE_PROJECT_ID',
    'NEXT_PUBLIC_CLOUD_FUNCTION_REGION',
    'NEXT_PUBLIC_FIREBASE_EMULATOR_HOST',
    'NEXT_PUBLIC_FIREBASE_EMULATOR_FUNCTIONS_PORT',
  ];
  const bundled = await build({
    entryPoints: [fileURLToPath(new URL('./cloudFunctions.ts', import.meta.url))],
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'cjs',
    define: Object.fromEntries(
      names.map((name) => [`process.env.${name}`, JSON.stringify(publicEnv[name] ?? '')]),
    ),
  });
  const browserModule = { exports: {} };
  // Browser runtimes do not provide the build machine's environment object.
  runInNewContext(bundled.outputFiles[0].text, { module: browserModule, process: { env: {} } });
  return browserModule.exports as ClientExports;
}

it('keeps the configured Fly API in a browser bundle with no runtime public env', async () => {
  const client = await browserBundle({
    NEXT_PUBLIC_FUNCTIONS_BASE_URL: 'https://nuni-functions.fly.dev',
  });
  expect(client.getFunctionsBaseUrl()).toBe('https://nuni-functions.fly.dev');
  expect(client.areFunctionsConfigured()).toBe(true);
  expect(
    client.getCloudFunctionUrl('getRepairServiceCapability', { projectId: 'demo-browser' }),
  ).toBe('https://nuni-functions.fly.dev/getRepairServiceCapability');
  expect(client.getCloudFunctionUrl('joinGroupByCode')).toBe('/api/fn/joinGroupByCode');
  expect(client.getCloudFunctionUrl('createTimetableShare')).toBe('/api/fn/createTimetableShare');
  expect(client.getCloudFunctionUrl('revokeTimetableShare')).toBe('/api/fn/revokeTimetableShare');
});

it('does not treat Spark Cloud Functions hostnames as configured after browser compilation', async () => {
  const client = await browserBundle({
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'campus-one-tw',
  });
  expect(client.areFunctionsConfigured()).toBe(false);
  expect(client.getFunctionsBaseUrl()).toBeNull();
  expect(client.getCloudFunctionUrl('joinGroupByCode')).toBe('/api/fn/joinGroupByCode');
  expect(client.getCloudFunctionUrl('askCampusAssistant', { projectId: 'campus-one-tw' })).toBe(
    'https://asia-east1-campus-one-tw.cloudfunctions.net/askCampusAssistant',
  );
});

it('treats the emulator as configured even without a Fly base URL', async () => {
  const client = await browserBundle({
    NEXT_PUBLIC_USE_FIREBASE_EMULATOR: 'true',
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'demo-browser',
  });
  expect(client.areFunctionsConfigured()).toBe(true);
});

it('keeps emulator routing ahead of Fly routing after browser compilation', async () => {
  const client = await browserBundle({
    NEXT_PUBLIC_USE_FIREBASE_EMULATOR: 'true',
    NEXT_PUBLIC_FUNCTIONS_BASE_URL: 'https://nuni-functions.fly.dev',
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'demo-browser',
    NEXT_PUBLIC_FIREBASE_EMULATOR_HOST: '127.0.0.1',
    NEXT_PUBLIC_FIREBASE_EMULATOR_FUNCTIONS_PORT: '53322',
    NEXT_PUBLIC_CLOUD_FUNCTION_REGION: 'asia-east1',
  });
  expect(client.getFunctionsBaseUrl()).toBeNull();
  expect(client.getCloudFunctionUrl('getRepairServiceCapability')).toBe(
    'http://127.0.0.1:53322/demo-browser/asia-east1/getRepairServiceCapability',
  );
});
