import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import DormStaffPage from './page';

vi.mock('@/components/AuthGuard', () => ({ useAuth: () => ({ user: { uid: 'student' } }) }));
vi.mock('@/components/SiteShell', () => ({
  SiteShell: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));
vi.mock('@/lib/useCampusBrowseContext', () => ({
  useCampusBrowseContext: () => ({ schoolId: 'pu', schoolName: '靜宜大學' }),
}));
vi.mock('@/components/dorm/DormWorkflow', () => ({ DormWorkflow: () => null }));
afterEach(cleanup);

it('提供前往所選學校宿舍頁的清楚入口', () => {
  render(<DormStaffPage />);
  expect(screen.getByRole('link', { name: '需要服務請到宿舍頁' }).getAttribute('href')).toBe('/dormitory?schoolId=pu');
});
