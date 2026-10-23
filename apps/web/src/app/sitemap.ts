import type { MetadataRoute } from 'next';
import { publicSitemapEntries } from '@/lib/publicSitemap';

export default function sitemap(): MetadataRoute.Sitemap {
  return publicSitemapEntries();
}
