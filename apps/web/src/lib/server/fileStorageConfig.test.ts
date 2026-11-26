// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { readFileStorageConfig } from './fileStorageConfig';
vi.mock('server-only', () => ({}));

const env = { FILE_STORAGE_BACKEND: 'supabase', SUPABASE_URL: 'https://project.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test-secret', SUPABASE_STORAGE_BUCKET: 'private-files' };
it('requires explicit opt-in and every server setting', () => {
  expect(readFileStorageConfig({})).toBeNull();
  for (const key of Object.keys(env)) expect(readFileStorageConfig({ ...env, [key]: '' })).toBeNull();
  expect(readFileStorageConfig({ ...env, SUPABASE_URL: 'invalid' })).toBeNull();
  expect(readFileStorageConfig({ ...env, SUPABASE_STORAGE_BUCKET: '../public' })).toBeNull();
});
it('caps downloads at sixty seconds', () => {
  expect(readFileStorageConfig(env)?.presignTtlSeconds).toBe(60);
});
