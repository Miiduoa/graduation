import { render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { usePublicSchoolContext } from './usePublicSchoolContext';

const state = vi.hoisted(() => ({
  selected: null as null | Record<string, unknown>,
}));
vi.mock('@/components/SelectedSchoolProvider', () => ({
  useOptionalSelectedSchool: () => state.selected,
}));
vi.mock('./pageContext', () => ({
  resolveSchoolPageContext: () => ({
    school: { id: 'pu', name: '靜宜大學', code: 'PU' },
    schoolId: 'pu',
    schoolCode: 'PU',
    schoolName: '靜宜大學',
    schoolSearch: '?school=PU&schoolId=pu',
    schoolContext: { id: 'pu', code: 'PU' },
  }),
}));

function Probe({ params }: { params?: { campus?: string; schoolId?: string } }) {
  const context = usePublicSchoolContext(params);
  return (
    <output data-testid="current-campus">
      {JSON.stringify({
        id: context.schoolId,
        name: context.schoolName,
        status: context.status,
      })}
    </output>
  );
}

function value() {
  return JSON.parse(screen.getByTestId('current-campus').textContent || '{}');
}

beforeEach(() => {
  state.selected = null;
});

it('keeps legacy screens working when no browsing provider is mounted', () => {
  render(<Probe />);
  expect(value()).toEqual({ id: 'pu', name: '靜宜大學', status: 'ready' });
});

it('uses the selected campus rather than a stale URL campus', () => {
  state.selected = {
    loading: false,
    catalogStatus: 'ready',
    selectedSchool: { id: 'nthu', name: '國立清華大學' },
  };
  render(<Probe params={{ schoolId: 'pu' }} />);
  expect(value()).toEqual({ id: 'nthu', name: '國立清華大學', status: 'ready' });
});

it('does not show Providence when no campus was selected or an ID is unknown', () => {
  state.selected = { loading: false, catalogStatus: 'ready', selectedSchool: null };
  const view = render(<Probe />);
  expect(value()).toMatchObject({ id: '', status: 'choose' });
  view.rerender(<Probe params={{ schoolId: 'not-in-directory' }} />);
  expect(value()).toMatchObject({ id: '', status: 'unknown' });
});

it('does not expose previous school content while the directory loads or fails', () => {
  state.selected = { loading: true, catalogStatus: 'loading', selectedSchool: null };
  const view = render(<Probe params={{ schoolId: 'pu' }} />);
  expect(value()).toMatchObject({ id: '', status: 'loading' });
  state.selected = { loading: false, catalogStatus: 'error', selectedSchool: null };
  view.rerender(<Probe params={{ schoolId: 'pu' }} />);
  expect(value()).toMatchObject({ id: '', status: 'error' });
});
