import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SelectedSchoolProvider } from '@/components/SelectedSchoolProvider';
import { useCampusBrowseContext } from './useCampusBrowseContext';

const navigation = vi.hoisted(() => ({ search: '', replace: vi.fn() }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/library',
  useSearchParams: () => new URLSearchParams(navigation.search),
  useRouter: () => ({ replace: navigation.replace }),
}));

function Probe() {
  const scope = useCampusBrowseContext({ schoolId: 'pu' });
  return (
    <output data-testid="campus-scope">
      {JSON.stringify({ id: scope.schoolId, name: scope.schoolName, status: scope.status })}
    </output>
  );
}

function Directory({ status = 'ready' }: { status?: 'ready' | 'error' | 'loading' }) {
  return (
    <SelectedSchoolProvider
      ownerKey={null}
      loading={false}
      schools={[
        { id: 'pu', name: '靜宜大學' },
        { id: 'nthu', name: '國立清華大學' },
        { id: 'ntu', name: '國立臺灣大學' },
      ]}
      catalogStatus={status}
    >
      <Probe />
    </SelectedSchoolProvider>
  );
}

beforeEach(() => {
  navigation.search = '';
  localStorage.clear();
  vi.clearAllMocks();
});
afterEach(cleanup);

it('uses the selected campus rather than a stale schoolId on the page', () => {
  navigation.search = 'campus=nthu&schoolId=pu';
  const view = render(<Directory />);
  expect(JSON.parse(screen.getByTestId('campus-scope').textContent || '{}')).toEqual({
    id: 'nthu',
    name: '國立清華大學',
    status: 'ready',
  });
  navigation.search = 'campus=ntu&schoolId=pu';
  view.rerender(<Directory />);
  expect(JSON.parse(screen.getByTestId('campus-scope').textContent || '{}')).toEqual({
    id: 'ntu',
    name: '國立臺灣大學',
    status: 'ready',
  });
});

it('defaults to Providence when the person has not chosen a campus yet', () => {
  render(<Directory />);
  expect(JSON.parse(screen.getByTestId('campus-scope').textContent || '{}')).toEqual({
    id: 'pu',
    name: '靜宜大學',
    status: 'ready',
  });
});

it('does not silently replace an explicit all-campus or unavailable selection with Providence', () => {
  navigation.search = 'campus=all';
  const view = render(<Directory />);
  expect(JSON.parse(screen.getByTestId('campus-scope').textContent || '{}')).toMatchObject({
    id: null,
    status: 'unselected',
  });
  navigation.search = 'campus=unknown';
  view.rerender(<Directory />);
  expect(JSON.parse(screen.getByTestId('campus-scope').textContent || '{}')).toMatchObject({
    id: null,
    status: 'unselected',
  });
  view.rerender(<Directory status="error" />);
  expect(JSON.parse(screen.getByTestId('campus-scope').textContent || '{}')).toMatchObject({
    id: null,
    status: 'error',
  });
});
