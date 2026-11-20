// @vitest-environment node
import { expect, it } from 'vitest';
import { buildOfficialLibraryCatalogUrl, officialLibraryDirectory } from '@campus/shared/src/officialLibraries';
import nextConfig from '../../../next.config';

async function directives() {
  const headers = await nextConfig.headers?.();
  const csp = headers?.find((entry) => entry.source === '/:path*')?.headers.find(
    (header) => header.key === 'Content-Security-Policy',
  )?.value;
  expect(csp).toBeTruthy();
  return new Map(csp!.split(';').map((part) => {
    const [name, ...values] = part.trim().split(/\s+/);
    return [name, values];
  }));
}

it.each([
  ['pu', 'https://webpacx.lib.pu.edu.tw'],
  ['nthu', 'https://nthu.primo.exlibrisgroup.com'],
  ['ncue', 'https://webpacx.ncue.edu.tw'],
  ['fju', 'https://library.lib.fju.edu.tw:444'],
])('permits %s catalog GET forms at their exact official origin', async (schoolId, origin) => {
  const policy = await directives();
  const url = new URL(buildOfficialLibraryCatalogUrl(schoolId, '資料庫 & SQL', 'Title')!);
  expect(url.origin).toBe(origin);
  expect(policy.get('form-action')).toContain(url.origin);
});

it('restricts external catalog submissions to verified HTTPS search origins', async () => {
  const policy = await directives();
  const destinations = policy.get('form-action')!;
  expect(destinations).toContain("'self'");
  expect(destinations).toContain('https://accounts.google.com');
  const catalogOrigins = destinations.filter((value) => !["'self'", 'https://accounts.google.com'].includes(value));
  const verified = Object.values(officialLibraryDirectory)
    .filter((library) => library.catalogSearch)
    .map((library) => new URL(library.catalogUrl).origin);
  expect([...new Set(catalogOrigins)].sort()).toEqual([...new Set(verified)].sort());
  for (const origin of catalogOrigins) {
    expect(origin).toMatch(/^https:\/\/[a-z0-9.-]+(?::\d+)?$/);
    expect(origin).not.toContain('*');
  }
  expect(destinations).not.toContain('https://web20.lib.cgu.edu.tw');
  expect(policy.get('default-src')).toEqual(["'self'"]);
  expect(policy.get('object-src')).toEqual(["'none'"]);
  expect(policy.get('frame-ancestors')).toEqual(["'none'"]);
  expect(policy.get('base-uri')).toEqual(["'self'"]);
});
