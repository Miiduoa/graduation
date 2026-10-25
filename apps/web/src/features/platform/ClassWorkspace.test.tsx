import { render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { ClassWorkspace } from './ClassWorkspace';

const mocks = vi.hoisted(() => ({
  session: null as null | { platformAccountId: string; context: string; isPlatformOperator: boolean },
  loading: false,
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/components/SiteShell', () => ({
  SiteShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
vi.mock('@/components/AppHeader', () => ({ AppHeader: () => <header>Campus One</header> }));
vi.mock('@/features/nuni/Session', () => ({
  useNuniSession: () => ({
    session: mocks.session,
    loading: mocks.loading,
    error: '',
    pendingLogout: false,
    refresh: vi.fn(),
    logout: vi.fn(),
  }),
}));
vi.mock('@/features/nuni/CourseUI', () => ({
  useClasses: () => ({
    get: vi.fn(),
    assignments: vi.fn(),
    units: vi.fn(),
  }),
  CourseAccessBoundary: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('@/features/nuni/CourseAssignments', () => ({ CourseAssignments: () => null }));
vi.mock('@/features/nuni/CourseLearningPath', () => ({ CourseLearningPath: () => null }));
vi.mock('@/features/nuni/CourseMaterials', () => ({ CourseMaterials: () => null }));
vi.mock('@/features/nuni/CourseQuizzes', () => ({ CourseQuizzes: () => null }));

beforeEach(() => {
  mocks.session = null;
  mocks.loading = false;
});

it('rejects an unknown workspace id without calling APIs', () => {
  render(<ClassWorkspace workspaceId="not-a-workspace" />);
  expect(screen.getByRole('heading', { name: '找不到課班' })).toBeTruthy();
  expect(screen.getByRole('link', { name: '回到加入課班' })).toBeTruthy();
});

it('asks guests to sign in before opening a workspace', () => {
  render(<ClassWorkspace workspaceId="cw_11111111-1111-4111-8111-111111111111" />);
  expect(screen.getByRole('heading', { name: '請先登入' })).toBeTruthy();
});
