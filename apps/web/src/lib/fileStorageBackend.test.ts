// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { isSupabaseFileStorageEnabled } from './fileStorageBackend';

afterEach(() => {
  vi.unstubAllEnvs();
});

it.each([
  [undefined, false],
  ['', false],
  ['supabase', true],
  [' Supabase ', true],
  ['r2', false],
] as const)('checks the public file storage backend %s', (raw, enabled) => {
  vi.stubEnv('NEXT_PUBLIC_FILE_STORAGE_BACKEND', raw);
  expect(isSupabaseFileStorageEnabled(raw)).toBe(enabled);
  expect(isSupabaseFileStorageEnabled()).toBe(enabled);
});
