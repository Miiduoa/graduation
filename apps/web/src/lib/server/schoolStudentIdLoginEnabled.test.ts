import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it, vi } from 'vitest';
import { isSchoolStudentIdLoginEnabled } from './schoolStudentIdLoginEnabled';

const webRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..');

afterEach(() => {
  vi.unstubAllEnvs();
});

it('伺服器端學號登入開關沒設就是關，明確打開才算開', () => {
  expect(isSchoolStudentIdLoginEnabled(undefined)).toBe(false);
  expect(isSchoolStudentIdLoginEnabled('')).toBe(false);
  expect(isSchoolStudentIdLoginEnabled('false')).toBe(false);
  expect(isSchoolStudentIdLoginEnabled('0')).toBe(false);
  expect(isSchoolStudentIdLoginEnabled('true')).toBe(true);
  expect(isSchoolStudentIdLoginEnabled('1')).toBe(true);
  expect(isSchoolStudentIdLoginEnabled('on')).toBe(true);
  expect(isSchoolStudentIdLoginEnabled()).toBe(false);
  vi.stubEnv('SCHOOL_STUDENT_ID_LOGIN_ENABLED', 'true');
  expect(isSchoolStudentIdLoginEnabled()).toBe(true);
});

it('does not treat leftover NEXT_PUBLIC_SCHOOL_STUDENT_ID_LOGIN as the runtime switch', () => {
  vi.stubEnv('NEXT_PUBLIC_SCHOOL_STUDENT_ID_LOGIN', 'true');
  vi.stubEnv('SCHOOL_STUDENT_ID_LOGIN_ENABLED', '');
  expect(isSchoolStudentIdLoginEnabled()).toBe(false);
});

it('開關只在伺服器讀，登入頁與 SchoolAccountRequired 不把旗標打進 client bundle', () => {
  const envExample = readFileSync(join(webRoot, '.env.example'), 'utf8');
  expect(envExample).toMatch(/SCHOOL_STUDENT_ID_LOGIN_ENABLED/);
  expect(envExample).not.toMatch(/NEXT_PUBLIC_SCHOOL_STUDENT_ID_LOGIN/);
  for (const file of [
    'src/app/login/page.tsx',
    'src/components/SchoolAccountRequired.tsx',
    'src/lib/signInOptions.ts',
  ]) {
    const source = readFileSync(join(webRoot, file), 'utf8');
    expect(source).not.toMatch(/SCHOOL_STUDENT_ID_LOGIN_ENABLED/);
    expect(source).not.toMatch(/NEXT_PUBLIC_SCHOOL_STUDENT_ID_LOGIN/);
  }
  const api = readFileSync(join(webRoot, 'src/lib/nuni/api.ts'), 'utf8');
  expect(api).toMatch(/isSchoolStudentIdLoginEnabled\(\)/);
});
