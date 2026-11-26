import { fireEvent, render, screen } from '@testing-library/react';
import type { AnchorHTMLAttributes } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DirectoryVisitProvider } from './DirectoryVisit';
import { ServiceDirectory } from './ServiceDirectory';
import { ServiceBreadcrumbs } from './ServiceBreadcrumbs';

vi.mock('next/navigation', () => ({
  usePathname: () => window.location.pathname,
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
vi.mock('next/link', () => ({
  default: ({ onClick, replace, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { replace?: boolean }) => (
    <a {...props} data-replace={replace || undefined} onClick={(event) => { onClick?.(event); event.preventDefault(); }} />
  ),
}));
vi.mock('./SelectedSchoolProvider', () => ({ useOptionalSelectedSchool: () => null }));

const source = '/life?campus=pu&q=%E5%85%AC%E8%BB%8A&session=private';
const target = '/bus?campus=pu';
function go(href: string) { window.history.replaceState(null, '', href); }
function Shell(props: { scope?: string | null }) {
  const scope = 'scope' in props ? props.scope : 'guest-pu';
  return (
    <DirectoryVisitProvider scope={scope}>
      {window.location.pathname === '/life' ? <ServiceDirectory journey="life" /> : <ServiceBreadcrumbs title="公車" />}
    </DirectoryVisitProvider>
  );
}
beforeEach(() => {
  go(source);
  vi.stubGlobal('navigation', undefined);
});
afterEach(() => { vi.unstubAllGlobals(); });

it('returns to the filtered results and focuses the chosen row without forwarding unrelated URL params', () => {
  const scroll = vi.fn();
  const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scroll });
  const view = render(<Shell />);
  fireEvent.click(screen.getByRole('link', { name: '公車' }));
  go(target);
  view.rerender(<Shell />);
  const back = screen.getByRole('link', { name: '返回生活目錄' });
  expect(back.getAttribute('data-replace')).toBe('true');
  expect(back.getAttribute('href')).toBe('/life?campus=pu&q=%E5%85%AC%E8%BB%8A');
  fireEvent.click(back);
  go(back.getAttribute('href')!);
  view.rerender(<Shell />);
  expect(screen.getByRole('searchbox')).toHaveProperty('value', '公車');
  expect(document.activeElement).toBe(screen.getByRole('link', { name: '公車' }));
  expect(scroll).toHaveBeenCalled();
  if (original) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', original);
  else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
});

it('keeps ordinary breadcrumbs on a deep link, new-tab activation, or a different confirmed account or campus', () => {
  go(target);
  const view = render(<Shell />);
  expect(screen.getByRole('link', { name: '探索' }).getAttribute('href')).toBe('/explore?campus=pu');
  go(source);
  view.rerender(<Shell />);
  fireEvent.click(screen.getByRole('link', { name: '公車' }), { metaKey: true });
  go(target);
  view.rerender(<Shell />);
  expect(screen.queryByText('返回生活目錄')).toBeNull();
  go(source);
  view.rerender(<Shell />);
  fireEvent.click(screen.getByRole('link', { name: '公車' }));
  go(target);
  view.rerender(<Shell />);
  expect(screen.getByText('返回生活目錄')).toBeTruthy();
  view.rerender(<Shell scope={undefined} />);
  expect(screen.queryByText('返回生活目錄')).toBeNull();
  view.rerender(<Shell />);
  expect(screen.getByText('返回生活目錄')).toBeTruthy();
  view.rerender(<Shell scope={null} />);
  view.rerender(<Shell scope="second-account-pu" />);
  expect(screen.queryByText('返回生活目錄')).toBeNull();
  view.rerender(<Shell scope="guest-pu" />);
  expect(screen.queryByText('返回生活目錄')).toBeNull();
});

it('does not restore a prior account’s service row when an older directory history entry is revisited', () => {
  const view = render(<Shell />);
  fireEvent.click(screen.getByRole('link', { name: '公車' }));
  const originalEntry = window.history.state;
  expect(originalEntry.__campusServiceDirectoryReturn.ownerToken).toEqual(expect.any(String));
  go(target);
  view.rerender(<Shell />);
  view.rerender(<Shell scope="second-account-pu" />);
  window.history.replaceState(originalEntry, '', source);
  fireEvent.popState(window, { state: originalEntry });
  view.rerender(<Shell scope="second-account-pu" />);
  expect(document.activeElement).not.toBe(screen.getByRole('link', { name: '公車' }));
});
