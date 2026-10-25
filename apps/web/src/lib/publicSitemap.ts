export const SITE_ORIGIN = 'https://nuni.tw';
export const SITEMAP_URL = `${SITE_ORIGIN}/sitemap.xml`;

/** 免登入、可供檢索的公開頁。首頁必須列在 sitemap。 */
export const PUBLIC_SITEMAP_PATHS = [
  '/',
  '/privacy',
  '/terms',
  '/support',
  '/account-deletion',
  '/account-deletion/status',
] as const;

export function publicSitemapUrls(origin: string = SITE_ORIGIN): string[] {
  return PUBLIC_SITEMAP_PATHS.map((path) => new URL(path, `${origin}/`).toString());
}

export function publicSitemapEntries(origin: string = SITE_ORIGIN) {
  return publicSitemapUrls(origin).map((url) => ({ url }));
}

export function publicRobotsConfig() {
  return {
    rules: {
      userAgent: '*',
      allow: [
        '/$',
        '/privacy',
        '/terms',
        '/support',
        '/account-deletion',
        '/account-deletion/status',
        '/robots.txt',
        '/sitemap.xml',
      ],
      disallow: '/',
    },
    sitemap: SITEMAP_URL,
    host: SITE_ORIGIN,
  };
}
