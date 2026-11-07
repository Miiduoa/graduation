// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { getPathMatch } from 'next/dist/shared/lib/router/utils/path-match';
import { vi } from 'vitest';
import config from '../../next.config';

describe('photo PDF preview policy', () => {
  it('permits blob frames and PDF objects only within classroom pages', async () => {
    const rules = await config.headers!();
    const policy = (source: string) => rules.find((rule) => rule.source === source)!
      .headers.find((header) => header.key === 'Content-Security-Policy')!.value;
    expect(policy('/:path*')).toContain("object-src 'none'");
    expect(policy('/:path*')).not.toContain('frame-src');
    for (const source of ['/:section(classroom)/:path*']) {
      expect(policy(source)).toContain("object-src blob:; frame-src 'self' blob:");
      expect(policy(source)).toContain("default-src 'self'");
      expect(policy(source)).toContain("frame-ancestors 'none'");
    }
  });
});

it('keeps camera permission gated and blob previews scoped to classroom routes', async () => {
  try {
    for (const flag of ['', 'false', 'TRUE', '1', 'true']) {
      vi.stubEnv('ASSIGNMENT_FILE_SUBMIT_ENABLED', flag);
      const rules = await config.headers!();
      const scanPages = ['/merchant', '/merchant/workspace', '/course/c1/attendance', '/teacher/course/c1/attendance'];
      const paths = [
        ...scanPages, '/', '/classroom', '/classroom/course', '/classroom-other',
        '/merchant/workspace/settings', '/course/c1', '/teacher/course/c1/gradebook', '/course/c1/attendance/report',
      ];
      for (const pathname of paths) {
        const effective = new Map<string, string>();
        for (const rule of rules) {
          if (getPathMatch(rule.source)(pathname)) {
            for (const header of rule.headers) effective.set(header.key, header.value);
          }
        }
        const classroom = pathname === '/classroom' || pathname.startsWith('/classroom/');
        expect(effective.get('Content-Security-Policy')?.includes('object-src blob:')).toBe(classroom);
        const permissions = effective.get('Permissions-Policy');
        const allowCamera = scanPages.includes(pathname) || (classroom && flag === 'true');
        expect(permissions).toContain(allowCamera ? 'camera=(self)' : 'camera=()');
        expect(permissions).toContain(pathname === '/' ? 'microphone=(self)' : 'microphone=()');
      }
    }
  } finally {
    vi.unstubAllEnvs();
  }
});
