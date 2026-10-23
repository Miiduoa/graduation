import type { MetadataRoute } from 'next';
import { publicRobotsConfig } from '@/lib/publicSitemap';

export default function robots(): MetadataRoute.Robots {
  return publicRobotsConfig();
}
