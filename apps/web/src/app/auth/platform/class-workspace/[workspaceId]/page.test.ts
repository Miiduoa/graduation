import { beforeEach, expect, it, vi } from 'vitest';
import ClassWorkspacePage from './page';

const redirect = vi.hoisted(() =>
  vi.fn((destination: string) => {
    throw new Error(`redirect:${destination}`);
  }),
);
vi.mock('next/navigation', () => ({ redirect }));

const workspaceId = 'cw_11111111-1111-4111-8111-111111111111';
beforeEach(() => {
  redirect.mockClear();
});

it('redirects the old workspace page directly to the same course attendance panel', async () => {
  await expect(
    ClassWorkspacePage({
      params: Promise.resolve({ workspaceId }),
      searchParams: Promise.resolve({}),
    }),
  ).rejects.toThrow(`redirect:/classroom/course/${workspaceId}?view=attendance`);
});

it.each([
  ['course', 'outline'],
  ['members', 'members'],
  ['affiliation', 'members'],
  ['session', 'attendance'],
])('preserves the course ID and maps the old %s tab', async (tab, view) => {
  await expect(
    ClassWorkspacePage({
      params: Promise.resolve({ workspaceId }),
      searchParams: Promise.resolve({ tab, invite: 'NEW123', campus: 'tw-pu', q: '設計 專題' }),
    }),
  ).rejects.toThrow('redirect:');
  const url = new URL(redirect.mock.calls[0][0], 'https://campus.local');
  expect(url.pathname).toBe(`/classroom/course/${workspaceId}`);
  expect(Object.fromEntries(url.searchParams)).toEqual({
    tab,
    invite: 'NEW123',
    campus: 'tw-pu',
    q: '設計 專題',
    view,
  });
});

it('preserves an explicit course panel and repeated query values', async () => {
  await expect(
    ClassWorkspacePage({
      params: Promise.resolve({ workspaceId }),
      searchParams: Promise.resolve({ view: 'assignments', tag: ['one', 'two'] }),
    }),
  ).rejects.toThrow('redirect:');
  const url = new URL(redirect.mock.calls[0][0], 'https://campus.local');
  expect(url.searchParams.get('view')).toBe('assignments');
  expect(url.searchParams.getAll('tag')).toEqual(['one', 'two']);
});
