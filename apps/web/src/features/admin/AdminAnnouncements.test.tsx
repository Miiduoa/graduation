import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { AdminAnnouncements } from './AdminAnnouncements';

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

it('links platform operators to the school announcement editor', () => {
  render(<AdminAnnouncements schoolId="pu" />);
  expect(screen.getByRole('heading', { name: '校園公告發佈' })).toBeTruthy();
  expect(screen.getByRole('link', { name: '開啟校園公告編輯' }).getAttribute('href')).toBe(
    '/admin/announcements?schoolId=pu&campus=pu',
  );
});

it('keeps the editor entry available without a selected school', () => {
  render(<AdminAnnouncements schoolId={null} />);
  expect(screen.getByRole('link', { name: '開啟校園公告編輯' }).getAttribute('href')).toBe(
    '/admin/announcements',
  );
});
