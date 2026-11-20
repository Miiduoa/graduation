import { fireEvent, render, screen } from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import DormStaffPage from './page';

const auth = vi.hoisted(() => ({
  user: { uid: 'staff-a' } as { uid: string } | null,
  loading: false,
}));
const campus = vi.hoisted(() => ({
  status: 'ready',
  schoolId: 'pu' as string | null,
  schoolName: '靜宜大學',
  schoolSearch: '?schoolId=pu&campus=pu',
}));
const workflow = vi.hoisted(() => vi.fn());
vi.mock('@/components/AuthGuard', () => ({ useAuth: () => auth }));
vi.mock('@/lib/useCampusBrowseContext', () => ({ useCampusBrowseContext: () => campus }));
vi.mock('@/features/nuni/Session', () => ({ useOptionalNuniSession: () => null }));
vi.mock('@/lib/signInOptions', () => ({
  useSignInOptions: () => ({ studentId: true, loading: false, error: false }),
}));
vi.mock('@/components/SiteShell', () => ({
  SiteShell: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));
vi.mock('@/components/SchoolScopePlaceholder', () => ({
  SchoolScopePlaceholder: () => <p role="status">請確認或重新選擇校園</p>,
}));
vi.mock('@/components/dorm/DormWorkflow', () => ({
  DormWorkflow: (props: { schoolId: string; uid: string; initialStaff: boolean }) => {
    workflow(props);
    const [note, setNote] = useState('');
    return (
      <label>
        處理備註
        <input value={note} onChange={(event) => setNote(event.target.value)} />
      </label>
    );
  },
}));

beforeEach(() => {
  workflow.mockClear();
  auth.user = { uid: 'staff-a' };
  auth.loading = false;
  Object.assign(campus, {
    status: 'ready',
    schoolId: 'pu',
    schoolName: '靜宜大學',
    schoolSearch: '?schoolId=pu&campus=pu',
  });
});

it('keeps the selected campus in login and resident-service return paths', () => {
  auth.user = null;
  render(<DormStaffPage />);
  const href = screen.getByRole('link', { name: '用學校帳號登入' }).getAttribute('href')!;
  expect(new URL(href, 'https://nuni.test').searchParams.get('returnUrl')).toBe(
    '/staff/dorm?schoolId=pu&campus=pu',
  );
  expect(screen.getByRole('link', { name: '需要服務請到宿舍頁' }).getAttribute('href')).toBe(
    '/dormitory?schoolId=pu&campus=pu',
  );
  expect(workflow).not.toHaveBeenCalled();
});

it.each(['loading', 'error', 'unselected'])(
  'resolves the campus before mounting a staff workspace (%s)',
  (status) => {
    campus.status = status;
    campus.schoolId = null;
    render(<DormStaffPage />);
    expect(screen.getByRole('status').textContent).toContain('確認或重新選擇校園');
    expect(workflow).not.toHaveBeenCalled();
  },
);

it('waits for authentication without flashing a signed-out action or loading work', () => {
  auth.loading = true;
  auth.user = null;
  render(<DormStaffPage />);
  expect(screen.getByRole('status').textContent).toBe('正在確認登入狀態…');
  expect(screen.queryByRole('link', { name: '用學校帳號登入' })).toBeNull();
  expect(workflow).not.toHaveBeenCalled();
});

it('remounts the authorized-workspace boundary when campus or staff account changes', () => {
  const view = render(<DormStaffPage />);
  expect(workflow).toHaveBeenLastCalledWith({ schoolId: 'pu', uid: 'staff-a', initialStaff: true });
  fireEvent.change(screen.getByLabelText('處理備註'), { target: { value: 'A 校值班記錄' } });
  Object.assign(campus, { schoolId: 'nthu', schoolSearch: '?schoolId=nthu&campus=nthu' });
  view.rerender(<DormStaffPage />);
  expect(screen.queryByDisplayValue('A 校值班記錄')).toBeNull();
  expect(workflow).toHaveBeenLastCalledWith({
    schoolId: 'nthu',
    uid: 'staff-a',
    initialStaff: true,
  });
  fireEvent.change(screen.getByLabelText('處理備註'), { target: { value: 'B 校值班記錄' } });
  auth.user = { uid: 'staff-b' };
  view.rerender(<DormStaffPage />);
  expect(screen.queryByDisplayValue('B 校值班記錄')).toBeNull();
  expect(workflow).toHaveBeenLastCalledWith({
    schoolId: 'nthu',
    uid: 'staff-b',
    initialStaff: true,
  });
});
