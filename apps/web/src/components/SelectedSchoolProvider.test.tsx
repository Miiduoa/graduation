import { act, fireEvent, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SchoolSelector } from './SchoolSelector';
import {
  SelectedSchoolProvider,
  schoolPreferenceKey,
  useSelectedSchool,
  type SelectedSchoolProviderProps,
} from './SelectedSchoolProvider';

const navigation = vi.hoisted(() => ({ pathname: '/community', search: '', replace: vi.fn() }));
vi.mock('next/navigation', () => ({
  usePathname: () => navigation.pathname,
  useSearchParams: () => new URLSearchParams(navigation.search),
  useRouter: () => ({ replace: navigation.replace }),
}));
const schools = [
  { id: 'school-a', name: '甲校', shortName: '甲', code: 'A' },
  { id: 'school-b', name: '乙校', shortName: '乙', code: 'B' },
];
const defaults = {
  ownerKey: 'platform:alice|firebase:one',
  loading: false,
  schools,
  catalogStatus: 'ready',
} as const;
let capturedSelection: ReturnType<typeof useSelectedSchool>;
function Probe() {
  const selection = useSelectedSchool();
  useEffect(() => {
    capturedSelection = selection;
  }, [selection]);
  return <span data-testid="selected-school">{selection.selectedSchool?.name ?? '不限校園'}</span>;
}
function View(props: Partial<Omit<SelectedSchoolProviderProps, 'children'>> = {}) {
  return (
    <SelectedSchoolProvider {...defaults} {...props}>
      <Probe />
      <SchoolSelector />
      <input aria-label="未儲存內容" defaultValue="" />
    </SelectedSchoolProvider>
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  navigation.pathname = '/community';
  navigation.search = '';
  navigation.replace.mockImplementation((href: string) => {
    navigation.search = new URL(href, 'https://campus.test').search;
  });
  window.history.replaceState({}, '', '/');
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('uses only the supplied directory, searches it, and treats selection as browsing preference', () => {
  render(<View />);
  expect(screen.getByLabelText('瀏覽校園')).toBeTruthy();
  expect(screen.getByText(/不會更換帳號或取得校務資料權限/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText('搜尋校園'), { target: { value: 'B' } });
  expect(screen.queryByRole('option', { name: '甲校' })).toBeNull();
  fireEvent.change(screen.getByLabelText('瀏覽校園'), { target: { value: 'school-b' } });
  expect(screen.getByTestId('selected-school').textContent).toBe('乙校');
  expect(JSON.parse(localStorage.getItem(schoolPreferenceKey(defaults.ownerKey))!)).toEqual({
    schoolId: 'school-b',
  });
  fireEvent.change(screen.getByLabelText('瀏覽校園'), { target: { value: '' } });
  expect(screen.getByTestId('selected-school').textContent).toBe('不限校園');
  expect(navigation.search).toBe('?campus=all');
});

it('changes only campus and preserves existing school authority, route, query and fragment', () => {
  navigation.pathname = '/teacher/course/course-a';
  navigation.search = 'school=PU&schoolId=pu&tab=grades';
  window.history.replaceState({}, '', '/#assignment-a');
  render(<View />);
  fireEvent.change(screen.getByLabelText('瀏覽校園'), { target: { value: 'school-b' } });
  const [href, options] = navigation.replace.mock.calls[0];
  const target = new URL(href, 'https://campus.test');
  expect(target.pathname).toBe('/teacher/course/course-a');
  expect(target.searchParams.get('school')).toBe('PU');
  expect(target.searchParams.get('schoolId')).toBe('pu');
  expect(target.searchParams.get('campus')).toBe('school-b');
  expect(target.searchParams.get('tab')).toBe('grades');
  expect(target.hash).toBe('#assignment-a');
  expect(options).toEqual({ scroll: false });
});

it('restores per-account preferences without copying an explicit URL choice into another account', () => {
  localStorage.setItem(
    schoolPreferenceKey(defaults.ownerKey),
    JSON.stringify({ schoolId: 'school-a' }),
  );
  const other = 'platform:bob|firebase:one';
  localStorage.setItem(schoolPreferenceKey(other), JSON.stringify({ schoolId: 'school-b' }));
  const view = render(<View />);
  expect(screen.getByTestId('selected-school').textContent).toBe('甲校');
  const staleSelect = capturedSelection.selectSchool;
  view.rerender(<View ownerKey={other} />);
  expect(screen.getByTestId('selected-school').textContent).toBe('乙校');
  act(() => staleSelect('school-a'));
  expect(navigation.replace).not.toHaveBeenCalled();
  navigation.search = '?campus=school-a';
  view.rerender(<View ownerKey={other} />);
  expect(screen.getByTestId('selected-school').textContent).toBe('甲校');
  expect(JSON.parse(localStorage.getItem(schoolPreferenceKey(other))!)).toEqual({
    schoolId: 'school-b',
  });
});

it('hides selection during identity loading and does not reuse account data for guests', () => {
  localStorage.setItem(
    schoolPreferenceKey(defaults.ownerKey),
    JSON.stringify({ schoolId: 'school-a' }),
  );
  const view = render(<View />);
  fireEvent.change(screen.getByLabelText('未儲存內容'), { target: { value: '我的筆記' } });
  expect(screen.getByTestId('selected-school').textContent).toBe('甲校');
  view.rerender(<View loading />);
  expect(screen.getByTestId('selected-school').textContent).toBe('不限校園');
  expect(screen.queryByLabelText('瀏覽校園')).toBeNull();
  view.rerender(<View />);
  expect(screen.getByTestId('selected-school').textContent).toBe('甲校');
  expect((screen.getByLabelText('未儲存內容') as HTMLInputElement).value).toBe('我的筆記');
  view.rerender(<View ownerKey={null} />);
  expect(screen.getByTestId('selected-school').textContent).toBe('不限校園');
  expect(localStorage.getItem(schoolPreferenceKey(null))).toBeNull();
  expect(schoolPreferenceKey(null)).not.toBe(schoolPreferenceKey('guest'));
  expect(schoolPreferenceKey('account/a')).not.toBe(schoolPreferenceKey('account-a'));
});

it('does not offer fabricated schools while the catalog is loading, empty or unavailable', () => {
  const retry = vi.fn();
  const view = render(<View schools={[]} catalogStatus="loading" />);
  expect(screen.getByRole('status').textContent).toContain('正在載入');
  expect(screen.queryByLabelText('瀏覽校園')).toBeNull();
  view.rerender(<View schools={[]} catalogStatus="ready" />);
  expect(screen.getByRole('status').textContent).toContain('目前沒有可選擇的校園');
  view.rerender(<View schools={[]} catalogStatus="error" onRetryCatalog={retry} />);
  expect(screen.getByRole('alert').textContent).toContain('無法讀取校園目錄');
  fireEvent.click(screen.getByRole('button', { name: '重新讀取目錄' }));
  expect(retry).toHaveBeenCalledOnce();
});

it('rejects unknown school selections and does not infer an authorized school from schoolId', () => {
  navigation.search = '?schoolId=school-b&campus=not-in-directory';
  render(<View />);
  expect(screen.getByTestId('selected-school').textContent).toBe('不限校園');
  expect(screen.getByRole('status').textContent).toContain('不在目前目錄');
  act(() => capturedSelection.selectSchool('unknown'));
  expect(navigation.replace).not.toHaveBeenCalled();
});

it('keeps URL selection usable when browser storage is blocked', () => {
  vi.stubGlobal('localStorage', {
    getItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {
      throw new Error('blocked');
    },
  });
  render(<View />);
  fireEvent.change(screen.getByLabelText('瀏覽校園'), { target: { value: 'school-b' } });
  expect(screen.getByTestId('selected-school').textContent).toBe('乙校');
  expect(screen.getByRole('status').textContent).toContain('無法儲存校園偏好');
});

it('ignores another account storage events and clears a removed own preference', () => {
  localStorage.setItem(
    schoolPreferenceKey(defaults.ownerKey),
    JSON.stringify({ schoolId: 'school-a' }),
  );
  render(<View />);
  act(() =>
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: schoolPreferenceKey('other'),
        newValue: JSON.stringify({ schoolId: 'school-b' }),
      }),
    ),
  );
  expect(screen.getByTestId('selected-school').textContent).toBe('甲校');
  act(() =>
    window.dispatchEvent(
      new StorageEvent('storage', { key: schoolPreferenceKey(defaults.ownerKey), newValue: null }),
    ),
  );
  expect(screen.getByTestId('selected-school').textContent).toBe('不限校園');
});

it('dismisses the compact chooser with Escape or a pointer outside it', () => {
  render(
    <SelectedSchoolProvider {...defaults}>
      <SchoolSelector compact />
      <button type="button">外部按鈕</button>
    </SelectedSchoolProvider>,
  );
  const summary = screen.getByText('瀏覽校園：不限校園');
  const details = summary.closest('details')!;
  details.open = true;
  fireEvent.keyDown(screen.getByLabelText('搜尋校園'), { key: 'Escape' });
  expect(details.open).toBe(false);
  expect(document.activeElement).toBe(summary);
  details.open = true;
  fireEvent.pointerDown(screen.getByRole('button', { name: '外部按鈕' }));
  expect(details.open).toBe(false);
});

it('distinguishes a listed campus from an opened school service', () => {
  render(<View schools={[{ ...schools[0], status: 'not-open' }]} />);
  expect(screen.getByRole('option', { name: '甲校（校務尚未開通）' })).toBeTruthy();
  fireEvent.change(screen.getByLabelText('瀏覽校園'), { target: { value: 'school-a' } });
  expect(screen.getByText(/此校目前可瀏覽公開交流，校務服務尚未開通/)).toBeTruthy();
  expect(navigation.search).toBe('?campus=school-a');
});
