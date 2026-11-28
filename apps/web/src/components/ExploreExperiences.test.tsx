import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ExploreExperiences } from './ExploreExperiences';

const navigation = vi.hoisted(() => ({ search: 'campus=pu' }));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(navigation.search),
}));
vi.mock('./SelectedSchoolProvider', () => ({ useOptionalSelectedSchool: () => null }));
vi.mock('next/link', () => ({
  default: (props: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props} />,
}));

beforeEach(() => {
  navigation.search = 'campus=pu';
  window.history.replaceState({ preserved: true }, '', '/explore?campus=pu');
});
afterEach(() => cleanup());

it('opens a supported question as a draft while keeping the campus and direct service available', () => {
  render(<ExploreExperiences />);
  const card = screen.getByRole('article', { name: '下一堂課，從容出發' });
  const ask = within(card).getByRole('link', { name: '試著問 nuni：下一堂課，從容出發' });
  const url = new URL(ask.getAttribute('href')!, 'https://nuni.tw');
  expect(url.pathname).toBe('/ai-assistant');
  expect(url.searchParams.get('q')).toBe('下一堂課在哪，幾點');
  expect(url.searchParams.get('taskProfile')).toBe('student');
  expect(url.searchParams.get('campus')).toBe('pu');
  expect([...url.searchParams.keys()].sort()).toEqual(['campus', 'q', 'taskProfile']);
  expect(
    within(card)
      .getByRole('link', { name: /開啟相關服務/ })
      .getAttribute('href'),
  ).toBe('/timetable?campus=pu');
});

it('keeps public experiences available for a chosen role and carries that role into its question', () => {
  render(<ExploreExperiences />);
  fireEvent.change(screen.getByRole('combobox', { name: '工作情境' }), {
    target: { value: 'teacher' },
  });
  expect(screen.queryByRole('article', { name: '下一堂課，從容出發' })).toBeNull();
  expect(screen.queryByRole('article', { name: '掌握今天的門市' })).toBeNull();
  expect(screen.getByRole('article', { name: '掌握授課進度' })).toBeTruthy();
  const publicCard = screen.getByRole('article', { name: '先找到地方，再出發' });
  const url = new URL(
    within(publicCard)
      .getByRole('link', { name: /試著問 nuni/ })
      .getAttribute('href')!,
    'https://nuni.tw',
  );
  expect(url.searchParams.get('taskProfile')).toBe('teacher');
  expect(url.searchParams.get('campus')).toBe('pu');
  expect(window.history.state).toEqual({ preserved: true });
  expect(new URL(window.location.href).searchParams.get('workContext')).toBe('teacher');
});

it('finds a task across categories and resets an empty result without losing campus or focus', () => {
  render(<ExploreExperiences />);
  const search = screen.getByRole<HTMLInputElement>('searchbox', { name: '尋找想做的事' });
  fireEvent.change(search, { target: { value: '午餐' } });
  expect(screen.getAllByRole('article')).toHaveLength(1);
  expect(screen.getByRole('article', { name: '午餐，換一個選擇' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '處理課業' }));
  expect(screen.getByRole('heading', { name: '換個關鍵字試試看' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '清除篩選' }));
  expect(search.value).toBe('');
  expect(screen.getAllByRole('article').length).toBeGreaterThan(1);
  expect(document.activeElement).toBe(search);
  expect(window.location.search).toBe('?campus=pu');
});

it('restores URL filters on a history return and maps staff and operator to actual task profiles', () => {
  render(<ExploreExperiences />);
  window.history.replaceState({}, '', '/explore?campus=ncku&category=work&workContext=staff');
  act(() => window.dispatchEvent(new PopStateEvent('popstate')));
  expect(screen.getByRole<HTMLSelectElement>('combobox', { name: '工作情境' }).value).toBe('staff');
  const staff = screen.getByRole('article', { name: '找到校務的下一個窗口' });
  expect(
    new URL(
      within(staff)
        .getByRole('link', { name: /試著問 nuni/ })
        .getAttribute('href')!,
      'https://nuni.tw',
    ).searchParams.get('taskProfile'),
  ).toBe('school');
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'operator' } });
  const operator = screen.getByRole('article', { name: '從公開服務檢視平台' });
  expect(
    new URL(
      within(operator)
        .getByRole('link', { name: /試著問 nuni/ })
        .getAttribute('href')!,
      'https://nuni.tw',
    ).searchParams.get('taskProfile'),
  ).toBe('platform');
});
