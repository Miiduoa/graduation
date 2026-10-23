import { expect, it } from 'vitest';
import robots from '../app/robots';
import sitemap from '../app/sitemap';
import { SITEMAP_URL } from './publicSitemap';

it('把 nuni.tw 首頁列進 sitemap', () => {
  const urls = sitemap().map((entry) => entry.url);
  expect(urls).toContain('https://nuni.tw/');
});

it('robots 指向 sitemap', () => {
  expect(robots().sitemap).toBe(SITEMAP_URL);
  expect(robots().sitemap).toBe('https://nuni.tw/sitemap.xml');
});
