// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import nextConfig from '../../../next.config';

const source = readFileSync(path.resolve(__dirname, '../../../next.config.ts'), 'utf8');

afterEach(() => {
  vi.unstubAllEnvs();
});

it('only opens classroom camera when ASSIGNMENT_FILE_SUBMIT_ENABLED is the literal true', async () => {
  expect(source).toContain("process.env.ASSIGNMENT_FILE_SUBMIT_ENABLED === 'true'");
  expect(source).toContain('必須重建 Web 映像');
  expect(source).toContain("source: '/classroom'");
  expect(source).toContain("source: '/classroom/:path*'");

  vi.stubEnv('ASSIGNMENT_FILE_SUBMIT_ENABLED', '');
  const off = (await nextConfig.headers?.()) ?? [];
  expect(off.some((entry) => entry.source === '/classroom' || entry.source === '/classroom/:path*')).toBe(
    false,
  );
  expect(off.some((entry) => entry.source === '/merchant')).toBe(true);

  vi.stubEnv('ASSIGNMENT_FILE_SUBMIT_ENABLED', 'true');
  const on = (await nextConfig.headers?.()) ?? [];
  expect(on.some((entry) => entry.source === '/classroom')).toBe(true);
  expect(on.some((entry) => entry.source === '/classroom/:path*')).toBe(true);
  const classroom = on.find((entry) => entry.source === '/classroom');
  expect(classroom?.headers[0]?.value).toContain('camera=(self)');
});
