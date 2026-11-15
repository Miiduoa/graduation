import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { PersonalImportRecord } from '@campus/shared';
import { createDefaultCampusPreferences } from '@campus/shared/src/campusPersonalization';
import { campusPreferencesStorageKey, writeCampusPreferences } from '@/lib/campusPreferences';
import { CampusPersonalizationSection } from './CampusPersonalizationSection';

const identity = vi.hoisted(() => ({
  user: null as { uid: string } | null,
  authLoading: false,
  authError: '',
  session: { platformAccountId: 'alice' } as { platformAccountId: string } | null,
  loading: false,
  pendingLogout: false,
  error: '',
}));
vi.mock('@/components/AuthGuard', () => ({
  useAuth: () => ({
    user: identity.user,
    loading: identity.authLoading,
    error: identity.authError,
  }),
}));
vi.mock('@/features/nuni/Session', () => ({ useOptionalNuniSession: () => identity }));

const scope = { owner: 'platform:alice', schoolId: 'pu' };
const now = new Date('2026-11-13T10:00:00+08:00');
const exam = {
  id: 'exam',
  kind: 'events',
  schoolId: 'pu',
  title: '資料庫期中考',
  date: '2026-11-18',
  startTime: '10:00',
  endTime: '11:00',
} as PersonalImportRecord;
function section(overrides: Partial<Parameters<typeof CampusPersonalizationSection>[0]> = {}) {
  return (
    <CampusPersonalizationSection
      scope={scope}
      now={now}
      events={[exam]}
      eventsReady
      schoolName="靜宜大學"
      {...overrides}
    />
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  Object.assign(identity, {
    user: null,
    authLoading: false,
    authError: '',
    session: { platformAccountId: 'alice' },
    loading: false,
    pendingLogout: false,
    error: '',
  });
});

it('lets a Google account configure its homepage and read its own dated exam without school login', () => {
  render(section());
  fireEvent.change(screen.getByLabelText('你目前的階段'), { target: { value: 'year-4' } });
  fireEvent.click(screen.getByLabelText('生活優先'));
  fireEvent.click(screen.getByRole('button', { name: '套用首頁安排' }));
  expect(screen.getByRole('heading', { name: '期中準備' })).toBeTruthy();
  expect(screen.getAllByText(/資料庫期中考/).length).toBeGreaterThan(0);
  expect(JSON.parse(localStorage.getItem(campusPreferencesStorageKey(scope))!).stage).toBe(
    'year-4',
  );
  expect(
    screen.getByRole('list', { name: '為你推薦的下一步' }).children.length,
  ).toBeLessThanOrEqual(3);
});

it('withdraws private preferences and exam details during revalidation, failed logout, and session errors', () => {
  writeCampusPreferences(scope, {
    ...createDefaultCampusPreferences(),
    stage: 'year-4',
    configured: true,
  });
  const { rerender, container } = render(section());
  expect(screen.getAllByText(/資料庫期中考/).length).toBeGreaterThan(0);
  for (const key of ['loading', 'pendingLogout', 'error'] as const) {
    Object.assign(identity, {
      loading: false,
      pendingLogout: false,
      error: '',
      [key]: key === 'error' ? 'offline' : true,
    });
    rerender(section());
    expect(container.textContent).toBe('');
  }
});

it('hides old-account data immediately even if its caller briefly retains the previous import scope', () => {
  writeCampusPreferences(scope, {
    ...createDefaultCampusPreferences(),
    stage: 'year-4',
    configured: true,
  });
  const { rerender, container } = render(section());
  identity.session = { platformAccountId: 'bob' };
  rerender(section());
  expect(container.textContent).toBe('');
  rerender(section({ scope: { ...scope, owner: 'platform:bob' }, events: [] }));
  expect(screen.getByRole('heading', { name: '讓首頁更適合你' })).toBeTruthy();
  expect(screen.queryByText(/資料庫期中考/)).toBeNull();
  expect((screen.getByLabelText('你目前的階段') as HTMLSelectElement).value).toBe('unspecified');
});

it('never uses event data from a failed or still loading read as current evidence', () => {
  writeCampusPreferences(scope, { ...createDefaultCampusPreferences(), configured: true });
  const { rerender } = render(section({ eventsError: 'unavailable' }));
  expect(screen.getByRole('heading', { name: '日常安排' })).toBeTruthy();
  expect(screen.getByText(/個人行程暫時讀不到/)).toBeTruthy();
  expect(screen.queryByText(/資料庫期中考/)).toBeNull();
  rerender(section({ eventsReady: false }));
  expect(screen.queryByText(/資料庫期中考/)).toBeNull();
  expect(screen.getByText(/正在確認個人行程/)).toBeTruthy();
  rerender(section());
  expect(screen.getByRole('heading', { name: '期中準備' })).toBeTruthy();
});

it('removes a previous campus draft and ignores events from that campus on a switch', () => {
  const { rerender } = render(section());
  fireEvent.change(screen.getByLabelText('你目前的階段'), { target: { value: 'year-4' } });
  rerender(section({ scope: { ...scope, schoolId: 'nthu' }, schoolName: '清華大學' }));
  expect((screen.getByLabelText('你目前的階段') as HTMLSelectElement).value).toBe('unspecified');
  fireEvent.click(screen.getByRole('button', { name: '先略過' }));
  expect(screen.getByRole('heading', { name: '日常安排' })).toBeTruthy();
  expect(screen.queryByText(/資料庫期中考/)).toBeNull();
});

it('allows a confirmed school account and keeps guest preferences in a separate scope', () => {
  identity.session = null;
  identity.user = { uid: 'school-alice' };
  const schoolScope = { owner: 'school:school-alice', schoolId: 'pu' };
  const { rerender } = render(section({ scope: schoolScope, events: [] }));
  fireEvent.change(screen.getByLabelText('你目前的階段'), { target: { value: 'year-1' } });
  fireEvent.click(screen.getByRole('button', { name: '套用首頁安排' }));
  expect(JSON.parse(localStorage.getItem(campusPreferencesStorageKey(schoolScope))!).stage).toBe(
    'year-1',
  );
  identity.user = null;
  act(() => rerender(section({ scope: { owner: 'guest', schoolId: 'pu' }, events: [] })));
  expect((screen.getByLabelText('你目前的階段') as HTMLSelectElement).value).toBe('unspecified');
});
