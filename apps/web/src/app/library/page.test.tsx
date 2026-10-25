import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import LibraryPage from './page';
const context = vi.hoisted(() => ({
  status: 'ready' as 'ready' | 'loading' | 'error' | 'unselected',
  schoolId: 'pu' as string | null,
  schoolName: '靜宜大學',
  schoolSearch: '?schoolId=pu&campus=pu',
}));
vi.mock('@/lib/useCampusBrowseContext', () => ({
  useCampusBrowseContext: () => context,
}));
vi.mock('@/components/SiteShell', () => ({
  SiteShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
beforeEach(() => {
  context.status = 'ready';
  context.schoolId = 'pu';
  context.schoolName = '靜宜大學';
  context.schoolSearch = '?schoolId=pu&campus=pu';
});
afterEach(cleanup);
it('searches the official catalog with the chosen field and user input', () => {
  render(<LibraryPage />);
  const input = screen.getByLabelText('關鍵字') as HTMLInputElement;
  const button = screen.getByRole('button', { name: '搜尋學校館藏 ↗' }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  fireEvent.change(input, { target: { value: '資料庫 & SQL' } });
  fireEvent.change(screen.getByLabelText('搜尋範圍'), { target: { value: 'Title' } });
  expect(button.disabled).toBe(false);
  const form = button.closest('form')!;
  expect(form.action).toBe('https://webpacx.lib.pu.edu.tw/search');
  expect(form.method).toBe('get');
  expect(form.target).toBe('_blank');
  expect(form.getAttribute('rel')).toBe('noopener noreferrer');
  expect(new FormData(form).get('searchInput')).toBe('資料庫 & SQL');
  expect(new FormData(form).get('searchField')).toBe('Title');
});
it('sends personal borrowing actions to the library instead of reporting local success', () => {
  render(<LibraryPage />);
  expect(screen.getByRole('link', { name: '前往我的借閱紀錄 ↗' }).getAttribute('href')).toBe(
    'https://webpacx.lib.pu.edu.tw/personal/',
  );
  expect(screen.queryByRole('button', { name: /續借/ })).toBeNull();
  expect(screen.queryByText(/^(已借閱|續借成功|逾期罰款)/)).toBeNull();
});
it('does not show another school’s library for an unsupported school', () => {
  context.schoolId = 'other';
  render(<LibraryPage />);
  expect(screen.getByText('尚未提供這所學校的圖書館入口')).toBeTruthy();
  expect(screen.queryByRole('link')).toBeNull();
});
it('clears search input when the selected school changes', () => {
  const { rerender } = render(<LibraryPage />);
  fireEvent.change(screen.getByLabelText('關鍵字'), { target: { value: 'private query' } });
  context.schoolId = 'other';
  rerender(<LibraryPage />);
  context.schoolId = 'pu';
  rerender(<LibraryPage />);
  expect((screen.getByLabelText('關鍵字') as HTMLInputElement).value).toBe('');
});

it('opens the chosen university library without showing Providence links or a simulated catalog', () => {
  context.schoolId = 'nthu';
  context.schoolName = '國立清華大學';
  render(<LibraryPage />);
  expect(screen.getByText('國立清華大學圖書館')).toBeTruthy();
  expect(screen.getByRole('link', { name: '前往官方館藏入口 ↗' }).getAttribute('href')).toBe(
    'https://nthu.primo.exlibrisgroup.com/discovery/search?vid=886UST_NTHU:886UST_NTHU',
  );
  expect(screen.getByRole('link', { name: '前往我的借閱紀錄 ↗' }).getAttribute('href')).toBe(
    'https://nthu.primo.exlibrisgroup.com/discovery/account?section=overview&vid=886UST_NTHU:886UST_NTHU',
  );
  expect(screen.queryByRole('button', { name: '搜尋學校館藏 ↗' })).toBeNull();
  expect(screen.queryByText('蓋夏圖書館')).toBeNull();
});

it('searches NCUE WebPACX directly with translated fields and no clipboard detour', () => {
  context.schoolId = 'ncue';
  context.schoolName = '國立彰化師範大學';
  render(<LibraryPage />);
  expect(screen.getByRole('link', { name: '前往官方館藏入口 ↗' }).getAttribute('href')).toBe(
    'https://webpacx.ncue.edu.tw/',
  );
  fireEvent.change(screen.getByLabelText('想找的書或關鍵字'), {
    target: { value: '資料庫 & SQL' },
  });
  fireEvent.change(screen.getByLabelText('搜尋範圍'), { target: { value: 'Title' } });
  const url = new URL(screen.getByRole('link', { name: '直接搜尋本校館藏 ↗' }).getAttribute('href')!);
  expect(url.hostname).toBe('webpacx.ncue.edu.tw');
  expect(url.pathname).toBe('/search');
  expect(url.searchParams.get('searchField')).toBe('TI');
  expect(url.searchParams.get('searchInput')).toBe('資料庫 & SQL');
  expect(screen.queryByRole('button', { name: '複製關鍵字' })).toBeNull();
  expect(screen.queryByRole('button', { name: '搜尋學校館藏 ↗' })).toBeNull();
});

it('keeps clipboard handoff for schools without a verified search format', () => {
  context.schoolId = 'cgu';
  context.schoolName = '長庚大學';
  render(<LibraryPage />);
  fireEvent.change(screen.getByLabelText('想找的書或關鍵字'), {
    target: { value: '護理' },
  });
  expect(screen.getByRole('link', { name: '前往官方館藏入口 ↗' }).getAttribute('href')).toBe(
    'https://web20.lib.cgu.edu.tw/',
  );
  expect((screen.getByRole('button', { name: '複製關鍵字' }) as HTMLButtonElement).disabled).toBe(false);
});

it('opens Fu Jen Sierra results with the official 75-character limit', () => {
  context.schoolId = 'fju';
  context.schoolName = '輔仁大學';
  render(<LibraryPage />);
  const input = screen.getByLabelText('想找的書或關鍵字') as HTMLInputElement;
  expect(input.maxLength).toBe(75);
  expect(screen.getByText('此校官方館藏關鍵字上限為 75 字。')).toBeTruthy();
  fireEvent.change(input, { target: { value: '資料庫' } });
  const url = new URL(screen.getByRole('link', { name: '直接搜尋本校館藏 ↗' }).getAttribute('href')!);
  expect(url.origin).toBe('https://library.lib.fju.edu.tw:444');
  expect(url.pathname).toBe('/search~S0*cht/');
  expect(url.searchParams.get('searchtype')).toBe('Y');
  expect(url.searchParams.get('searcharg')).toBe('資料庫');
  expect(screen.getByRole('link', { name: '前往我的借閱紀錄 ↗' }).getAttribute('href')).toBe(
    'https://library.lib.fju.edu.tw:444/patroninfo*cht',
  );
  expect(screen.queryByRole('button', { name: '複製關鍵字' })).toBeNull();
});


it('searches the selected university catalog directly without carrying another campus view', () => {
  context.schoolId = 'nthu';
  context.schoolName = '國立清華大學';
  const { rerender } = render(<LibraryPage />);
  fireEvent.change(screen.getByLabelText('想找的書或關鍵字'), {
    target: { value: '分散式系統 & AI' },
  });
  const catalog = screen.getByRole('link', { name: '直接搜尋本校館藏 ↗' });
  const url = new URL(catalog.getAttribute('href')!);
  expect(url.hostname).toBe('nthu.primo.exlibrisgroup.com');
  expect(url.searchParams.get('vid')).toBe('886UST_NTHU:886UST_NTHU');
  expect(url.searchParams.get('query')).toBe('any,contains,分散式系統 & AI');
  expect(screen.queryByRole('button', { name: '複製關鍵字' })).toBeNull();

  context.schoolId = 'ncku';
  context.schoolName = '國立成功大學';
  rerender(<LibraryPage />);
  const switched = screen.getByRole('link', { name: '前往官方館藏入口 ↗' });
  expect(switched.getAttribute('href')).toContain('ncku.primo.exlibrisgroup.com');
  expect(switched.getAttribute('href')).not.toContain('分散式系統');
  expect(screen.getByRole('link', { name: '前往我的借閱紀錄 ↗' }).getAttribute('href')).toContain(
    'ncku.primo.exlibrisgroup.com',
  );
  expect(screen.queryByText('國立清華大學圖書館')).toBeNull();
});


it('uses Soochow Primo with the university view and never opens the previous campus', () => {
  context.schoolId = 'scu';
  context.schoolName = '東吳大學';
  render(<LibraryPage />);
  fireEvent.change(screen.getByLabelText('想找的書或關鍵字'), {
    target: { value: '現代文學' },
  });
  const url = new URL(screen.getByRole('link', { name: '直接搜尋本校館藏 ↗' }).getAttribute('href')!);
  expect(url.hostname).toBe('uco-scu.primo.exlibrisgroup.com');
  expect(url.searchParams.get('vid')).toBe('886UCO_SCU:886SCU_INST');
  expect(url.searchParams.get('query')).toBe('any,contains,現代文學');
  expect(screen.queryByText('蓋夏圖書館')).toBeNull();
});

it('provides Chiayi University official catalog and opening hours as separate links', () => {
  context.schoolId = 'ncyu';
  context.schoolName = '國立嘉義大學';
  render(<LibraryPage />);
  expect(screen.getByRole('link', { name: '前往官方館藏入口 ↗' }).getAttribute('href'))
    .toBe('https://libaleph.ncyu.edu.tw/F');
  expect(screen.getByRole('link', { name: '開館時間 ↗' }).getAttribute('href'))
    .toBe('https://www.ncyu.edu.tw/lib/Contents?nodeId=41764');
});


it('shows Taipei University official catalog, reader services and room booking without PU links', () => {
  context.schoolId = 'ntpu';
  context.schoolName = '國立臺北大學';
  render(<LibraryPage />);
  expect(screen.getByRole('link', { name: '前往官方館藏入口 ↗' }).getAttribute('href'))
    .toBe('https://wpac.lib.ntpu.edu.tw/webpac/search.cfm');
  expect(screen.getByRole('link', { name: '前往我的借閱紀錄 ↗' }).getAttribute('href'))
    .toBe('https://wpac.lib.ntpu.edu.tw/webpac/search.cfm?type=shelf_user');
  expect(screen.getByRole('link', { name: '空間與設備預約 ↗' }).getAttribute('href'))
    .toBe('https://ireserve.lib.ntpu.edu.tw/sm/home_web.do');
  expect(screen.queryByText('蓋夏圖書館')).toBeNull();
});

it('shows TMU verified catalog and electronic resources without fabricating personal account access', () => {
  context.schoolId = 'tmu';
  context.schoolName = '臺北醫學大學';
  render(<LibraryPage />);
  expect(screen.getByRole('link', { name: '前往官方館藏入口 ↗' }).getAttribute('href'))
    .toBe('https://libelis.tmu.edu.tw/webpacIndex.jsp');
  expect(screen.getByRole('link', { name: '電子資源 ↗' }).getAttribute('href'))
    .toBe('https://jumper.tmu.edu.tw/');
  expect(screen.queryByRole('link', { name: '前往我的借閱紀錄 ↗' })).toBeNull();
});
