// @vitest-environment node
import { describe, expect, it } from 'vitest';
import config from '../../next.config';

describe('photo PDF preview policy', () => {
  it('permits blob frames and PDF objects only within classroom pages', async () => {
    const rules = await config.headers!();
    const policy = (source: string) => rules.find((rule) => rule.source === source)!
      .headers.find((header) => header.key === 'Content-Security-Policy')!.value;
    expect(policy('/:path*')).toContain("object-src 'none'");
    expect(policy('/:path*')).not.toContain('frame-src');
    for (const source of ['/classroom', '/classroom/:path*']) {
      expect(policy(source)).toContain("object-src blob:; frame-src 'self' blob:");
      expect(policy(source)).toContain("default-src 'self'");
      expect(policy(source)).toContain("frame-ancestors 'none'");
    }
  });
});
