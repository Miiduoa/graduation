import { render, screen } from '@testing-library/react';
import { vi, expect, it } from 'vitest';
import { useBrowsingSchoolPageContext } from './useBrowsingSchoolPageContext';

const browsing = vi.hoisted(() => ({ id: 'pu' as string | null, loading: false }));
vi.mock('@/components/SelectedSchoolProvider', () => ({
  useOptionalSelectedSchool: () => ({
    selectedSchoolId: browsing.id,
    loading: browsing.loading,
    catalogStatus: 'ready',
  }),
}));
function Probe({ explicit }: { explicit?: string }) {
  const result = useBrowsingSchoolPageContext(explicit ? { schoolId: explicit } : undefined);
  return <output>{result.ready ? result.schoolId : 'loading'}</output>;
}
it('updates scoped public data after a school switch', () => {
  browsing.id = 'pu';
  const view = render(<Probe />);
  expect(screen.getByText('pu')).toBeTruthy();
  browsing.id = 'nthu';
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
