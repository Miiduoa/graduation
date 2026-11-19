import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import LifePage from './page';

const selectedSchool = vi.hoisted(() => vi.fn());
const navigation = vi.hoisted(() => ({
  search: '',
  suspend: false,
}));

vi.mock('@/components/SiteShell', () => ({
  SiteShell: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));

vi.mock('@/components/SelectedSchoolProvider', () => ({
  useOptionalSelectedSchool: selectedSchool,
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => {
    if (navigation.suspend) {
      throw new Promise(() => {});
    }
    return new URLSearchParams(navigation.search);
  },
}));

beforeEach(() => {
  selectedSchool.mockReturnValue(null);
  window.history.replaceState(null, '', '/life');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  selectedSchool.mockReset();
  navigation.search = '';
  navigation.suspend = false;
});

it('搜尋與分類留在目前網址，保留校園與學期，但不滲入服務連結', () => {
  const state = { __NA: true, preserved: 'router-state' };
  window.history.replaceState(
    state,
    '',
    '/life?school=PU&schoolId=pu&campus=pu&term=115-1#services',
  );
  navigation.search = window.location.search;
  const replace = vi.spyOn(window.history, 'replaceState');
  const push = vi.spyOn(window.history, 'pushState');
  render(<LifePage />);
  const search = screen.getByRole('searchbox', { name: '快速找服務' });
  search.focus();
  fireEvent.change(search, { target: { value: '借書' } });
  fireEvent.click(screen.getByRole('checkbox', { name: '只看免登入服務' }));

  const current = new URL(window.location.href);
  expect(current.pathname).toBe('/life');
  expect(current.hash).toBe('#services');
  expect(current.searchParams.get('q')).toBe('借書');
  expect(current.searchParams.get('access')).toBe('public');
  expect(current.searchParams.get('term')).toBe('115-1');
  expect(current.searchParams.get('schoolId')).toBe('pu');
  expect(replace).toHaveBeenCalledTimes(2);
  expect(replace.mock.calls.every(([data]) => !data?.__NA && !data?._N)).toBe(true);
  expect(push).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(search);

  const destination = new URL(
    screen.getByRole('link', { name: /圖書館/ }).getAttribute('href')!,
    window.location.href,
  );
  expect(destination.pathname).toBe('/library');
  expect(destination.searchParams.get('school')).toBe('PU');
  expect(destination.searchParams.get('schoolId')).toBe('pu');
  expect(destination.searchParams.get('campus')).toBe('pu');
  expect(destination.searchParams.has('q')).toBe(false);
  expect(destination.searchParams.has('category')).toBe(false);
});

it('重新開啟網址即可還原原本搜尋，返回與前進的參數更新也不搶焦點', () => {
  const first = render(<LifePage />);
  fireEvent.change(screen.getByRole('searchbox', { name: '快速找服務' }), {
    target: { value: '借書' },
  });
  fireEvent.click(screen.getByRole('checkbox', { name: '只看免登入服務' }));
  const savedUrl = window.location.href;
  first.unmount();

  navigation.search = new URL(savedUrl).search;
  const restored = render(<LifePage />);
  const search = screen.getByRole('searchbox', { name: '快速找服務' });
  expect((search as HTMLInputElement).value).toBe('借書');
  expect(String((screen.getByRole('checkbox', { name: '只看免登入服務' }) as HTMLInputElement).checked)).toBe('true');
  expect(screen.getAllByRole('link')).toHaveLength(1);
  const publicFilter = screen.getByRole('checkbox', { name: '只看免登入服務' });
  publicFilter.focus();

  navigation.search = '?q=公車&group=travel&campus=nthu';
  window.history.replaceState(window.history.state, '', `/life${navigation.search}`);
  restored.rerender(<LifePage />);
  expect((search as HTMLInputElement).value).toBe('公車');
  expect(screen.getByRole('button', { name: '出門與交通' }).getAttribute('aria-pressed')).toBe(
    'true',
  );
  expect(screen.getByRole('link', { name: /公車/ }).getAttribute('href')).toBe(
    '/bus?campus=nthu',
  );
  expect(document.activeElement).toBe(publicFilter);

  navigation.search = new URL(savedUrl).search;
  window.history.replaceState(window.history.state, '', savedUrl);
  restored.rerender(<LifePage />);
  expect((search as HTMLInputElement).value).toBe('借書');
  expect(String((screen.getByRole('checkbox', { name: '只看免登入服務' }) as HTMLInputElement).checked)).toBe('true');
  expect(document.activeElement).toBe(publicFilter);
});

it('網址中的分類只接受生活頁分類，過長查詢與控制字元會被安全限制', () => {
  navigation.search = `?q=${encodeURIComponent('\u0000' + '書'.repeat(100))}&category=admin`;
  window.history.replaceState(null, '', `/life${navigation.search}`);
  render(<LifePage />);
  const search = screen.getByRole('searchbox', { name: '快速找服務' });
  expect((search as HTMLInputElement).value).toBe('書'.repeat(80));
  expect(screen.getByRole('button', { name: '全部' }).getAttribute('aria-pressed')).toBe('true');

  fireEvent.click(screen.getByRole('button', { name: '顯示全部服務' }));
  const current = new URL(window.location.href);
  expect(current.searchParams.has('q')).toBe(false);
  expect(current.searchParams.has('category')).toBe(false);
  expect(screen.getAllByRole('link')).toHaveLength(11);
  expect(document.activeElement).toBe(search);
});

it('組字期間保留輸入與焦點，完成後才更新網址，Escape 不會刪除組字', () => {
  render(<LifePage />);
  const search = screen.getByRole('searchbox', { name: '快速找服務' });
  const replace = vi.spyOn(window.history, 'replaceState');
  search.focus();
  fireEvent.compositionStart(search);
  fireEvent.change(search, { target: { value: '借' } });
  fireEvent.keyDown(search, { key: 'Escape' });
  expect((search as HTMLInputElement).value).toBe('借');
  expect(replace).not.toHaveBeenCalled();
  fireEvent.change(search, { target: { value: '  借書  ' } });
  fireEvent.compositionEnd(search);
  expect((search as HTMLInputElement).value).toBe('  借書  ');
  expect(new URL(window.location.href).searchParams.get('q')).toBe('  借書  ');
  expect(replace).toHaveBeenCalledTimes(1);
  expect(screen.getAllByRole('link')).toHaveLength(1);
  expect(document.activeElement).toBe(search);
});

it('較早的網址回報晚到時不覆蓋正在組字的草稿，完成後以最後輸入為準', () => {
  const view = render(<LifePage />);
  const search = screen.getByRole('searchbox', { name: '快速找服務' });
  search.focus();
  fireEvent.change(search, { target: { value: '借' } });
  const firstUrl = window.location.search;
  fireEvent.change(search, { target: { value: '借書' } });
  const secondUrl = window.location.search;
  fireEvent.compositionStart(search);
  fireEvent.change(search, { target: { value: '借書館' } });

  // Next's transition can acknowledge earlier replaceState calls after the draft changed.
  navigation.search = firstUrl;
  view.rerender(<LifePage />);
  expect((search as HTMLInputElement).value).toBe('借書館');
  navigation.search = secondUrl;
  view.rerender(<LifePage />);
  expect((search as HTMLInputElement).value).toBe('借書館');
  expect(document.activeElement).toBe(search);

  fireEvent.compositionEnd(search);
  expect(new URL(window.location.href).searchParams.get('q')).toBe('借書館');
  navigation.search = window.location.search;
  view.rerender(<LifePage />);
  expect((search as HTMLInputElement).value).toBe('借書館');

  // Once acknowledged, an earlier URL is a genuine external change, not a pending echo.
  navigation.search = firstUrl;
  window.history.replaceState(null, '', `/life${firstUrl}`);
  view.rerender(<LifePage />);
  expect((search as HTMLInputElement).value).toBe('借');
});

it('真實返回會清除尚未回報的寫入，即使目的網址與待確認查詢相同', () => {
  const view = render(<LifePage />);
  const search = screen.getByRole('searchbox', { name: '快速找服務' });
  fireEvent.change(search, { target: { value: '借' } });
  fireEvent.compositionStart(search);
  fireEvent.change(search, { target: { value: '借書' } });
  expect((search as HTMLInputElement).value).toBe('借書');

  // Another history entry may carry the same URL as our pending replaceState.
  fireEvent.popState(window);
  expect((search as HTMLInputElement).value).toBe('借');
  navigation.search = window.location.search;
  view.rerender(<LifePage />);
  expect((search as HTMLInputElement).value).toBe('借');
});

it('組字期間收到真正的校園網址切換時，採用新校園的查詢與服務目的地', () => {
  const view = render(<LifePage />);
  const search = screen.getByRole('searchbox', { name: '快速找服務' });
  fireEvent.change(search, { target: { value: '借' } });
  fireEvent.compositionStart(search);
  fireEvent.change(search, { target: { value: '借書' } });

  navigation.search = '?q=搭車&category=public&campus=nchu&schoolId=nchu';
  window.history.replaceState(null, '', `/life${navigation.search}`);
  view.rerender(<LifePage />);
  expect((search as HTMLInputElement).value).toBe('搭車');
  expect(String((screen.getByRole('checkbox', { name: '只看免登入服務' }) as HTMLInputElement).checked)).toBe('true');
  const destination = new URL(
    screen.getByRole('link', { name: /公車/ }).getAttribute('href')!,
    window.location.href,
  );
  expect(destination.searchParams.get('schoolId')).toBe('nchu');
  expect(destination.searchParams.get('campus')).toBe('nchu');
  expect(destination.searchParams.has('q')).toBe(false);
});

it('瀏覽器拒絕更新網址時仍能搜尋與清除', () => {
  render(<LifePage />);
  vi.spyOn(window.history, 'replaceState').mockImplementation(() => {
    throw new DOMException('History unavailable', 'SecurityError');
  });
  const search = screen.getByRole('searchbox', { name: '快速找服務' });
  fireEvent.change(search, { target: { value: '借書' } });
  expect((search as HTMLInputElement).value).toBe('借書');
  expect(screen.getAllByRole('link')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: '清除搜尋' }));
  expect((search as HTMLInputElement).value).toBe('');
  expect(screen.getAllByRole('link')).toHaveLength(11);
});
