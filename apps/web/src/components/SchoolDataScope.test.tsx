import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { SchoolDataScope } from './SchoolDataScope';
const state = vi.hoisted(() => ({ school: null as null | { id: string; name: string } }));
vi.mock('./SelectedSchoolProvider', () => ({
  useOptionalSelectedSchool: () => ({ selectedSchool: state.school }),
}));
it('names the actual source instead of relabeling another campus data', () => {
  state.school = { id: 'other-school', name: '另一所大學' };
  render(<SchoolDataScope schoolName="靜宜大學" />);
  expect(screen.getByLabelText('目前校園資料範圍').textContent).toContain(
    '此頁目前提供靜宜大學的資料',
  );
  expect(screen.getByRole('link').getAttribute('href')).toBe('/social?campus=other-school');
});
it('does not show a mismatch for the source campus or no browsing preference', () => {
  state.school = { id: 'pu', name: '靜宜大學' };
  const view = render(<SchoolDataScope schoolName="靜宜大學" />);
  expect(screen.queryByRole('complementary')).toBeNull();
  state.school = null;
  view.rerender(<SchoolDataScope schoolName="靜宜大學" />);
  expect(screen.queryByRole('complementary')).toBeNull();
});
