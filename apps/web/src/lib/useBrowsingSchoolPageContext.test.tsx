import { render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { useBrowsingSchoolPageContext } from './useBrowsingSchoolPageContext';

const browsing = vi.hoisted(() => ({
  id: 'pu' as string | null,
  name: '靜宜大學',
  code: 'PU' as string | undefined,
  loading: false,
  catalogStatus: 'ready' as 'ready' | 'loading' | 'error',
  requestedUnavailable: false,
  present: true,
}));
vi.mock('@/components/SelectedSchoolProvider', () => ({
  useOptionalSelectedSchool: () =>
    browsing.present
      ? {
          selectedSchoolId: browsing.id,
          selectedSchool: browsing.id
            ? { id: browsing.id, name: browsing.name, code: browsing.code }
            : null,
          loading: browsing.loading,
          catalogStatus: browsing.catalogStatus,
          requestedUnavailable: browsing.requestedUnavailable,
          selectionError: browsing.requestedUnavailable
            ? '先前選擇的校園不在目前目錄，請重新選擇。'
            : null,
        }
      : null,
}));

function Probe({
  explicit,
  all,
  school,
}: {
  explicit?: string;
  all?: boolean;
  school?: string;
}) {
  const result = useBrowsingSchoolPageContext(
    all
      ? { campus: 'all' }
      : explicit
        ? { schoolId: explicit }
        : school
          ? { school }
          : undefined,
  );
  return (
    <output>
      {result.ready ? result.schoolId : result.scopeStatus}:{result.schoolName}
    </output>
  );
}

beforeEach(() => {
  browsing.id = 'pu';
  browsing.name = '靜宜大學';
  browsing.code = 'PU';
  browsing.loading = false;
  browsing.catalogStatus = 'ready';
  browsing.requestedUnavailable = false;
  browsing.present = true;
});

it('updates scoped public data after a school switch', () => {
  const view = render(<Probe />);
  expect(screen.getByText('pu:靜宜大學')).toBeTruthy();
  browsing.id = 'nthu';
  browsing.name = '國立清華大學';
  browsing.code = 'NTHU';
  view.rerender(<Probe />);
  expect(screen.getByText('nthu:國立清華大學')).toBeTruthy();
  view.unmount();
});

it('with a provider, follows provider identity even when page params name another campus', () => {
  browsing.id = 'pu';
  const view = render(<Probe explicit="nccu" />);
  expect(screen.getByText('pu:靜宜大學')).toBeTruthy();
  view.unmount();
});

it('blocks rendering school-specific content during preference hydration', () => {
  browsing.loading = true;
  const view = render(<Probe />);
  expect(screen.getByText(/^loading:/)).toBeTruthy();
  view.unmount();
});

it('does not confuse a campus in the live directory with the default bundled campus', () => {
  browsing.id = 'tw-new-university';
  browsing.name = '某所新設大學';
  browsing.code = undefined;
  const view = render(<Probe />);
  expect(screen.getByText('tw-new-university:某所新設大學')).toBeTruthy();
  view.unmount();
});

it('requires a school choice rather than returning Providence data for all-campus browsing', () => {
  browsing.id = null;
  browsing.requestedUnavailable = false;
  const view = render(<Probe all />);
  expect(screen.getByText(/^choose-school:/)).toBeTruthy();
  view.unmount();
});

it('rejects a directory-missing schoolId from the provider instead of using the bundled catalog', () => {
  browsing.id = null;
  browsing.requestedUnavailable = true;
  const view = render(<Probe explicit="nthu" />);
  expect(screen.getByText(/^unavailable:/)).toBeTruthy();
  view.unmount();
});

it('falls back to the URL resolver only when SelectedSchoolProvider is absent', () => {
  browsing.present = false;
  const view = render(<Probe explicit="nthu" />);
  expect(screen.getByText('nthu:國立清華大學')).toBeTruthy();
  view.unmount();
});
