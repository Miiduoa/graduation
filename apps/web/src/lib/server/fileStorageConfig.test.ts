// @vitest-environment node
import { afterEach, expect, it } from 'vitest';
import { readFileStorageConfig } from './fileStorageConfig';

const KEYS = [
  'FILE_STORAGE_BACKEND',
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET',
  'R2_ENDPOINT',
  'R2_PRESIGN_TTL_SECONDS',
  'R2_REGION',
] as const;

afterEach(() => {
  for (const key of KEYS) delete process.env[key];
});

function complete(env: Record<string, string> = {}) {
  return readFileStorageConfig({
    FILE_STORAGE_BACKEND: 'r2',
    R2_ACCOUNT_ID: 'acct',
    R2_ACCESS_KEY_ID: 'AKIA',
    R2_SECRET_ACCESS_KEY: 'secret',
    R2_BUCKET: 'test-bucket',
    ...env,
  });
}

it('stays disabled when FILE_STORAGE_BACKEND is unset', () => {
  expect(readFileStorageConfig({})).toBeNull();
  expect(readFileStorageConfig({ FILE_STORAGE_BACKEND: 'firebase' })).toBeNull();
});

it('stays disabled when R2 keys are incomplete', () => {
  expect(complete({ R2_SECRET_ACCESS_KEY: '' })).toBeNull();
  expect(complete({ R2_BUCKET: '' })).toBeNull();
  expect(complete({ R2_BUCKET: 'x' })).toBeNull();
});

it('caps the presign TTL at 60 seconds', () => {
  const config = complete({ R2_PRESIGN_TTL_SECONDS: '600' });
  expect(config?.presignTtlSeconds).toBe(60);
  expect(config?.s3.endpoint).toBe('https://acct.r2.cloudflarestorage.com');
});

it('accepts a local S3-compatible endpoint for tests', () => {
  const config = complete({ R2_ENDPOINT: 'http://127.0.0.1:9000/' });
  expect(config?.s3.endpoint).toBe('http://127.0.0.1:9000');
  expect(config?.s3.region).toBe('auto');
});
