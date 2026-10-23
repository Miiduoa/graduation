// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import nextConfig from '../../../next.config';

const source = readFileSync(path.resolve(__dirname, '../../../next.config.ts'), 'utf8');
const dockerfile = readFileSync(
  path.resolve(__dirname, '../../../../../deploy/web/Dockerfile.nuni'),
  'utf8',
);
const workflow = readFileSync(
  path.resolve(__dirname, '../../../../../.github/workflows/web-release.yml'),
  'utf8',
);

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

  expect(dockerfile).toContain('ARG ASSIGNMENT_FILE_SUBMIT_ENABLED=false');
  expect(dockerfile).toContain('ENV ASSIGNMENT_FILE_SUBMIT_ENABLED=$ASSIGNMENT_FILE_SUBMIT_ENABLED');
  expect(workflow).toContain('assignment_file_submit_enabled');
  expect(workflow).toContain("default: 'false'");
  expect(workflow).toContain('--build-arg ASSIGNMENT_FILE_SUBMIT_ENABLED');
});
