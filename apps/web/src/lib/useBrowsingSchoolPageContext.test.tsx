import { render, screen } from '@testing-library/react';
import { vi, expect, it } from 'vitest';
import { useBrowsingSchoolPageContext } from './useBrowsingSchoolPageContext';

const browsing = vi.hoisted(() => ({
  id: 'pu' as string | null,
  name: '靜宜大學',
  loading: false,
}));
vi.mock('@/components/SelectedSchoolProvider', () => ({
  useOptionalSelectedSchool: () => ({
    selectedSchoolId: browsing.id,
    selectedSchool: browsing.id ? { id: browsing.id, name: browsing.name } : null,
    loading: browsing.loading,
    catalogStatus: 'ready',
  }),
}));
function Probe({ explicit, all }: { explicit?: string; all?: boolean }) {
  const result = useBrowsingSchoolPageContext(all ? { campus: 'all' } : explicit ? { schoolId: explicit } : undefined);
  return <output>{result.ready ? result.schoolId : result.scopeStatus}</output>;
}
it('updates scoped public data after a school switch', () => {
  browsing.id = 'pu';
  browsing.name = '靜宜大學';
  const view = render(<Probe />);
  expect(screen.getByText('pu')).toBeTruthy();
  browsing.id = 'nthu';
  browsing.name = '國立清華大學';
  view.rerender(<Probe />);
  expect(screen.getByText('nthu')).toBeTruthy();
  view.unmount();
});
it('follows an explicit deep link instead of browser preference', () => {
  browsing.id = 'pu';
  const view = render(<Probe explicit="nccu" />);
  expect(screen.getByText('nccu')).toBeTruthy();
  view.unmount();
});
it('blocks rendering school-specific content during preference hydration', () => {
  browsing.loading = true;
  const view = render(<Probe />);
  expect(screen.getByText('loading')).toBeTruthy();
  browsing.loading = false;
  view.unmount();
});

it('does not confuse a campus in the live directory with the default bundled campus', () => {
  browsing.id = 'tw-new-university';
  browsing.name = '某所新設大學';
  const view = render(<Probe />);
  expect(screen.getByText('tw-new-university')).toBeTruthy();
  view.unmount();
});

it('requires a school choice rather than returning Providence data for all-campus browsing', () => {
  browsing.id = null;
  browsing.loading = false;
  const view = render(<Probe all />);
  expect(screen.getByText('choose-school')).toBeTruthy();
  view.unmount();
});
