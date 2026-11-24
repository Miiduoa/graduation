import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { AnchorHTMLAttributes } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DirectoryVisitProvider } from './DirectoryVisit';
import { ExploreExperiences } from './ExploreExperiences';
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

const source = '/explore?campus=pu&category=work&workContext=teacher&q=%E6%8E%88%E8%AA%B2';
function go(href: string) { window.history.replaceState(null, '', href); }
function Fixture({ scope = 'alice-pu' }: { scope?: string }) {
  return <DirectoryVisitProvider scope={scope}>
    {window.location.pathname === '/explore' ? <ExploreExperiences /> : <ServiceBreadcrumbs title="課程與作業" />}
  </DirectoryVisitProvider>;
}
beforeEach(() => { go(source); vi.stubGlobal('navigation', undefined); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it.each(['breadcrumb', 'history'])('returns from a different service section with exploration filters and focus via %s', (mode) => {
  const view = render(<Fixture />);
  const service = screen.getByRole('link', { name: /開啟相關服務/ });
  const destination = service.getAttribute('href')!;
  expect(destination).toBe('/classroom?campus=pu');
  fireEvent.click(service);
  go(destination);
  view.rerender(<Fixture />);
  const back = screen.getByRole('link', { name: '返回探索' });
  expect(back.getAttribute('href')).toBe(source);
  if (mode === 'breadcrumb') fireEvent.click(back);
  go(source);
  view.rerender(<Fixture />);
  expect(screen.getByRole('searchbox')).toHaveProperty('value', '授課');
  expect(screen.getByRole('combobox')).toHaveProperty('value', 'teacher');
  expect(screen.getByRole('button', { name: '進入工作' }).getAttribute('aria-pressed')).toBe('true');
  expect(document.activeElement).toBe(screen.getByRole('link', { name: /開啟相關服務/ }));
});

it.each(['history', 'adjacent breadcrumb'])('restores the exact exploration row when %s returns to a different query order', (mode) => {
  const original = '/explore?campus=pu&workContext=teacher&q=%E6%8E%88%E8%AA%B2&category=work';
  go(original);
  const view = render(<Fixture />);
  const service = screen.getByRole('link', { name: /開啟相關服務/ });
  const destination = service.getAttribute('href')!;
  fireEvent.click(service);
  go(destination);
  view.rerender(<Fixture />);
  const back = screen.getByRole('link', { name: '返回探索' });
  expect(back.getAttribute('href')).toBe(source);
  if (mode === 'adjacent breadcrumb') {
    const historyBack = vi.spyOn(window.history, 'back').mockImplementation(() => {});
    vi.stubGlobal('navigation', { currentEntry: { index: 1 }, entries: () => [
      { url: window.location.origin + original }, { url: window.location.href },
    ] });
    fireEvent.click(back);
    expect(historyBack).toHaveBeenCalledOnce();
  }
  go(original);
  view.rerender(<Fixture />);
  expect(screen.getByRole('searchbox')).toHaveProperty('value', '授課');
  expect(screen.getByRole('combobox')).toHaveProperty('value', 'teacher');
  expect(screen.getByRole('button', { name: '進入工作' }).getAttribute('aria-pressed')).toBe('true');
  expect(document.activeElement).toBe(screen.getByRole('link', { name: /開啟相關服務/ }));
});

it('does not attach a return origin to modified clicks or carry it into another account', () => {
  const view = render(<Fixture />);
  fireEvent.click(screen.getByRole('link', { name: /開啟相關服務/ }), { metaKey: true });
  go('/classroom?campus=pu');
  view.rerender(<Fixture />);
  expect(screen.queryByRole('link', { name: '返回探索' })).toBeNull();
  go(source);
  view.rerender(<Fixture />);
  fireEvent.click(screen.getByRole('link', { name: /開啟相關服務/ }));
  go('/classroom?campus=pu');
  view.rerender(<Fixture />);
  expect(screen.getByRole('link', { name: '返回探索' })).toBeTruthy();
  view.rerender(<Fixture scope="bob-pu" />);
  expect(screen.queryByRole('link', { name: '返回探索' })).toBeNull();
  go(source);
  view.rerender(<Fixture scope="bob-pu" />);
  expect(document.activeElement).not.toBe(screen.getByRole('link', { name: /開啟相關服務/ }));
});
