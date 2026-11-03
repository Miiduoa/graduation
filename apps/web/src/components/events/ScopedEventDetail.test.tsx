import { act, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ScopedEventDetail } from './ScopedEventDetail';
import { SelectedSchoolProvider, schoolPreferenceKey } from '../SelectedSchoolProvider';
import { useCampusBrowseContext } from '@/lib/useCampusBrowseContext';
import type { CampusEvent } from '@/lib/campusEvents';

const loadCampusEvent = vi.hoisted(() => vi.fn());
vi.mock('@/lib/campusEvents', async (original) => ({
  ...(await original<typeof import('@/lib/campusEvents')>()),
  loadCampusEvent,
}));
vi.mock('./EventRegistrationPanel', () => ({ EventRegistrationPanel: () => null }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/events/same',
  useSearchParams: () => new URLSearchParams('source=school-events'),
  useRouter: () => ({ replace: vi.fn() }),
}));

it('does not read the same event id in another campus after identity reload', async () => {
  let finish!: (event: CampusEvent) => void;
  loadCampusEvent.mockReset();
  loadCampusEvent.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const filters = { q: '', view: 'all' } as const;
  const contextA = { status: 'ready', schoolId: 'school-a', schoolName: '甲校', schoolSearch: '?schoolId=school-a&campus=school-a' } as const;
  const contextB = { status: 'ready', schoolId: 'school-b', schoolName: '乙校', schoolSearch: '?schoolId=school-b&campus=school-b' } as const;
  const view = render(<ScopedEventDetail context={contextA} eventId="same" source="school-events" filters={filters} />);
  await waitFor(() => expect(loadCampusEvent).toHaveBeenCalledWith('school-a', 'same', 'school-events'));
  view.rerender(<ScopedEventDetail context={{ ...contextA, status: 'loading', schoolId: null }} eventId="same" source="school-events" filters={filters} />);
  view.rerender(<ScopedEventDetail context={contextB} eventId="same" source="school-events" filters={filters} />);
  expect(screen.getByRole('heading', { name: '瀏覽校園已變更' })).toBeTruthy();
  expect(screen.getByRole('link', { name: '前往活動列表' }).getAttribute('href')).toBe('/events?schoolId=school-b&campus=school-b');
  expect(loadCampusEvent).toHaveBeenCalledTimes(1);
  await act(async () => finish({ id: 'same', schoolId: 'school-a', title: '甲校舊活動', description: '', startsAt: '', appRegistrationConfigured: false, source: 'school-events' }));
  expect(screen.queryByText('甲校舊活動')).toBeNull();
  expect(loadCampusEvent).toHaveBeenCalledTimes(1);
});

it('keeps an account change from opening the old event id in the next account campus', async () => {
  const alice = 'platform:alice';
  const bob = 'platform:bob';
  localStorage.setItem(schoolPreferenceKey(alice), JSON.stringify({ schoolId: 'school-a' }));
  localStorage.setItem(schoolPreferenceKey(bob), JSON.stringify({ schoolId: 'school-b' }));
  let finish!: (event: CampusEvent) => void;
  loadCampusEvent.mockReset();
  loadCampusEvent.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  function Detail() {
    const context = useCampusBrowseContext();
    return <ScopedEventDetail context={context} eventId="same" source="school-events" filters={{ q: '', view: 'all' }} />;
  }
  function View({ ownerKey, loading = false }: { ownerKey: string; loading?: boolean }) {
    return <SelectedSchoolProvider ownerKey={ownerKey} loading={loading} catalogStatus="ready" schools={[{ id: 'school-a', name: '甲校' }, { id: 'school-b', name: '乙校' }]}><Detail /></SelectedSchoolProvider>;
  }
  const view = render(<View ownerKey={alice} />);
  await waitFor(() => expect(loadCampusEvent).toHaveBeenCalledWith('school-a', 'same', 'school-events'));
  view.rerender(<View ownerKey={bob} loading />);
  view.rerender(<View ownerKey={bob} />);
  expect(await screen.findByRole('heading', { name: '瀏覽校園已變更' })).toBeTruthy();
  expect(loadCampusEvent).toHaveBeenCalledTimes(1);
  await act(async () => finish({ id: 'same', schoolId: 'school-a', title: '甲校舊活動', description: '', startsAt: '', appRegistrationConfigured: false, source: 'school-events' }));
  expect(screen.queryByText('甲校舊活動')).toBeNull();
  expect(screen.getByRole('link', { name: '前往活動列表' }).getAttribute('href')).toContain('schoolId=school-b');
});

it('prevents another tab changing a preference from opening the old id in another campus', async () => {
  const ownerKey = 'platform:alice';
  const key = schoolPreferenceKey(ownerKey);
  localStorage.setItem(key, JSON.stringify({ schoolId: 'school-a' }));
  loadCampusEvent.mockReset();
  loadCampusEvent.mockResolvedValue({ id: 'same', schoolId: 'school-a', title: '甲校活動', description: '', startsAt: '', appRegistrationConfigured: false, source: 'school-events' });
  function Detail() {
    return <ScopedEventDetail context={useCampusBrowseContext()} eventId="same" source="school-events" filters={{ q: '', view: 'all' }} />;
  }
  render(<SelectedSchoolProvider ownerKey={ownerKey} loading={false} catalogStatus="ready" schools={[{ id: 'school-a', name: '甲校' }, { id: 'school-b', name: '乙校' }]}><Detail /></SelectedSchoolProvider>);
  expect(await screen.findByRole('heading', { name: '甲校活動' })).toBeTruthy();
  act(() => window.dispatchEvent(new StorageEvent('storage', { key, newValue: JSON.stringify({ schoolId: 'school-b' }) })));
  expect(screen.getByRole('heading', { name: '瀏覽校園已變更' })).toBeTruthy();
  expect(screen.queryByText('甲校活動')).toBeNull();
  expect(loadCampusEvent).toHaveBeenCalledTimes(1);
});
