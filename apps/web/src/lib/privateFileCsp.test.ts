// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

it.each([
  ['https://private.supabase.co/storage/v1', 'https://public.supabase.co', 'https://private.supabase.co'],
  ['', 'https://public.supabase.co', 'https://public.supabase.co'],
  ['', '', 'https://*.supabase.co'],
  ['invalid', 'http://unsafe.example', 'https://*.supabase.co'],
])('limits storage connections using build configuration (%s)', async (serverUrl, publicUrl, origin) => {
  vi.stubEnv('SUPABASE_URL', serverUrl);
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', publicUrl);
  vi.resetModules();
  const { default: config } = await import('../../next.config');
  const rules = await config.headers!();
  for (const rule of rules) {
    const csp = rule.headers.find((header) => header.key === 'Content-Security-Policy')?.value;
    if (!csp) continue;
    const directives = csp.split('; ').map((part) => part.trim());
    expect(directives.find((part) => part.startsWith('connect-src '))).toContain(` ${origin}`);
    expect(csp).not.toContain('r2.cloudflarestorage.com');
    expect(directives).toContain("media-src 'self' blob:");
    expect(directives).toContain("img-src 'self' data: blob: https:");
    expect(directives).toContain("default-src 'self'");
  }
});
