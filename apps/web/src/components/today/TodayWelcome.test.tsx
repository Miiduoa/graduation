import { render, screen, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import { TodayWelcome } from './TodayWelcome';

const importHref = '/import?kind=timetable&campus=ntu';
const timetableHref = '/timetable?campus=ntu';

it('starts with the actual timetable task and keeps four campus services navigable', () => {
  const { container } = render(
    <TodayWelcome importHref={importHref} timetableHref={timetableHref} />,
  );
  const hero = screen.getByRole('region', { name: '建立第一份課表' });
  expect(within(hero).getByRole('heading', { level: 2 }).textContent).toBe('建立第一份課表');
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
  render(<TodayWelcome hasTimetable importHref={importHref} timetableHref={timetableHref} />);
  expect(screen.getByRole('heading', { name: '本週課表' })).toBeTruthy();
  expect(screen.getByRole('link', { name: '查看這週課表' }).getAttribute('href')).toBe(
    timetableHref,
  );
  expect(screen.getByRole('link', { name: '更新匯入紀錄' }).getAttribute('href')).toBe(importHref);
  expect(screen.queryByRole('link', { name: '匯入我的課表' })).toBeNull();
});

it('guides an unselected guest to choose a campus while keeping public services available', () => {
  render(
    <TodayWelcome
      needsSchool
      importHref="/import?kind=timetable&campus=all"
      timetableHref="/timetable?campus=all"
    />,
  );
  expect(screen.getByRole('heading', { name: '選擇課表所屬校園' })).toBeTruthy();
  expect(screen.getByRole('link', { name: '選校園、整理課表' }).getAttribute('href')).toBe(
    '/timetable?campus=all',
  );
  expect(screen.getByRole('link', { name: '先看生活服務' }).getAttribute('href')).toBe(
    '/life?campus=all',
  );
  expect(screen.getByRole('link', { name: /找教室/ }).getAttribute('href')).toBe(
    '/map?campus=all',
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
  const login = screen.getByRole('link', { name: '登入查看作業與通知' });
  const url = new URL(login.getAttribute('href')!, 'https://fixture.invalid');
  expect(url.pathname).toBe('/login');
  expect(url.searchParams.get('returnUrl')).toBe('/?school=NTU&schoolId=ntu&campus=ntu');
});

it('gives a signed-in account a course entry without asking it to sign in again', () => {
  const { rerender } = render(
    <TodayWelcome
      unsigned={false}
      needsCourse
      importHref={importHref}
      timetableHref={timetableHref}
    />,
  );
  expect(screen.queryByRole('link', { name: /登入/ })).toBeNull();
  expect(screen.getByRole('link', { name: '加入 nuni 課程' }).getAttribute('href')).toBe(
    '/classroom?campus=ntu',
  );
  rerender(
    <TodayWelcome unsigned={false} importHref={importHref} timetableHref={timetableHref} />,
  );
  expect(screen.queryByRole('link', { name: '加入 nuni 課程' })).toBeNull();
});

it('keeps timetable destinations separate from the browsing campus used by public services', () => {
  render(
    <TodayWelcome
      unsigned={false}
      needsCourse
      importHref={importHref}
      timetableHref={timetableHref}
      campusSearch="school=NCHU&schoolId=nchu&campus=nchu"
    />,
  );
  expect(screen.getByRole('link', { name: '匯入我的課表' }).getAttribute('href')).toBe(importHref);
  const navigation = screen.getByRole('navigation', { name: '常用校園服務' });
  for (const link of [
    ...within(navigation).getAllByRole('link'),
    screen.getByRole('link', { name: '加入 nuni 課程' }),
  ]) {
    const destination = new URL(link.getAttribute('href')!, 'https://fixture.invalid');
    expect(destination.searchParams.get('campus')).toBe('nchu');
    expect(destination.searchParams.get('schoolId')).toBe('nchu');
    expect(destination.searchParams.get('school')).toBe('NCHU');
  }
});
