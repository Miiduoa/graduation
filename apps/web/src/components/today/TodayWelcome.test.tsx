import { render, screen, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import { TodayWelcome } from './TodayWelcome';

const importHref = '/import?kind=timetable&campus=ntu';
const timetableHref = '/timetable?campus=ntu';

it('starts with the actual timetable task and keeps four campus services navigable', () => {
  const { container } = render(
    <TodayWelcome importHref={importHref} timetableHref={timetableHref} />,
  );
  const hero = screen.getByRole('region', { name: '先把課表放進來。' });
  expect(within(hero).getByRole('heading', { level: 2 }).textContent).toBe('先把課表放進來。');
  expect(screen.queryByText('你的校園日常')).toBeNull();
  expect(screen.queryByText('免登入')).toBeNull();
  expect(within(hero).getByRole('link', { name: '匯入我的課表' }).getAttribute('href')).toBe(
    importHref,
  );
  expect(within(hero).getByRole('link', { name: '手動建立課表' }).getAttribute('href')).toBe(
    timetableHref,
  );
  const shortcuts = within(hero).getByRole('navigation', { name: '常用校園服務' });
  const anchors = within(shortcuts).getAllByRole('link');
  expect(anchors.map((anchor) => anchor.getAttribute('href'))).toEqual([
    '/map?campus=ntu',
    '/bus?campus=ntu',
    '/cafeteria?campus=ntu',
    '/library?campus=ntu',
  ]);
  expect(container.querySelectorAll('a a').length).toBe(0);
  anchors[0]?.focus();
  expect(document.activeElement).toBe(anchors[0]);
});

it('opens an existing timetable instead of starting setup again', () => {
  render(
    <TodayWelcome hasTimetable importHref={importHref} timetableHref={timetableHref} />,
  );
  expect(screen.getByRole('heading', { name: '課表準備好了。' })).toBeTruthy();
  expect(screen.getByRole('link', { name: '查看這週課表' }).getAttribute('href')).toBe(
    timetableHref,
  );
  expect(screen.getByRole('link', { name: '更新匯入紀錄' }).getAttribute('href')).toBe(
    importHref,
  );
  expect(screen.queryByRole('link', { name: '匯入我的課表' })).toBeNull();
});

it('preserves explicit school context in guest shortcuts and login return URL', () => {
  render(
    <TodayWelcome
      importHref="/import?kind=timetable&school=NTU&schoolId=ntu&campus=ntu"
      timetableHref="/timetable?school=NTU&schoolId=ntu&campus=ntu"
    />,
  );
  const nav = screen.getByRole('navigation', { name: '常用校園服務' });
  for (const anchor of within(nav).getAllByRole('link')) {
    const target = new URL(anchor.getAttribute('href')!, 'https://fixture.invalid');
    expect(target.searchParams.get('school')).toBe('NTU');
    expect(target.searchParams.get('schoolId')).toBe('ntu');
    expect(target.searchParams.get('campus')).toBe('ntu');
  }
  const login = screen.getByRole('link', { name: '登入看課程待辦' });
  const url = new URL(login.getAttribute('href')!, 'https://fixture.invalid');
  expect(url.pathname).toBe('/login');
  expect(url.searchParams.get('returnUrl')).toBe('/?school=NTU&schoolId=ntu&campus=ntu');
});
