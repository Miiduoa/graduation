import { afterEach, expect, it, vi } from 'vitest';
import Page from './page';
import DetailPage from './homework/[courseId]/[homeworkId]/page';
import Layout from './layout';

vi.mock('next/navigation', () => ({
  redirect: (path: string) => { throw new Error(`redirect:${path}`); },
}));
vi.mock('./LmsPageClient', () => ({ default: () => null }));
vi.mock('./homework/[courseId]/[homeworkId]/LmsPageClient', () => ({ default: () => null }));
afterEach(() => vi.unstubAllEnvs());

it.each([undefined, '', 'false', 'TRUE', '1', ' true '])('redirects all server entry points when the value is %s', (value) => {
  vi.stubEnv('SCHOOL_LMS_READONLY_ENABLED', value);
  expect(() => Page()).toThrow('redirect:/classroom');
  expect(() => DetailPage()).toThrow('redirect:/classroom');
  expect(() => Layout({ children: 'child' })).toThrow('redirect:/classroom');
});

it('preserves pages and nested children only with explicit true', () => {
  vi.stubEnv('SCHOOL_LMS_READONLY_ENABLED', 'true');
  expect(Page()).toBeTruthy();
  expect(DetailPage()).toBeTruthy();
  expect(Layout({ children: 'child' })).toBe('child');
});
