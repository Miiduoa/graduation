import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ORAL_EXAM_STORAGE_KEY } from '@campus/shared/src/oralExamDemo';
import { OralExamPlayground } from './OralExamPlayground';

const navigation = vi.hoisted(() => ({ search: 'role=student' }));

vi.mock('@/components/SiteShell', () => ({
  SiteShell: ({
    title,
    children,
  }: {
    title?: string;
    children: ReactNode;
  }) => (
    <main>
      {title ? <h1>{title}</h1> : null}
      {children}
    </main>
  ),
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(navigation.search),
}));

beforeEach(() => {
  navigation.search = 'role=student';
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

it('lets a labelled demo student submit homework and check in without real credentials', () => {
  render(<OralExamPlayground />);
  expect(screen.getByRole('heading', { name: '口試示範工作區' })).toBeTruthy();
  expect(screen.getAllByText(/示範學生王小明/).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/DEMO1140001/).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/資料結構/).length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole('button', { name: '繳交鏈結串列作業' }));
  fireEvent.click(screen.getByRole('button', { name: '簽到' }));
  expect(screen.getAllByText(/已繳交/).length).toBeGreaterThan(0);
  expect(screen.getByText(/已簽到/)).toBeTruthy();
  expect(window.localStorage.getItem(ORAL_EXAM_STORAGE_KEY)).toMatch(/assignmentSubmitted/);
});

it('keeps teacher grading and leave review on the same labelled demo roster', () => {
  navigation.search = 'role=teacher';
  window.localStorage.setItem(
    ORAL_EXAM_STORAGE_KEY,
    JSON.stringify({
      assignmentSubmitted: true,
      attendanceCheckedIn: true,
      leaveRequested: true,
      leaveApproved: false,
      gradePublished: false,
      orderReady: false,
      announcementPosted: false,
      storyPosted: false,
      dmSent: false,
      lostFoundClaimed: false,
    }),
  );
  render(<OralExamPlayground />);
  expect(screen.getAllByText(/示範教師林佳蓉/).length).toBeGreaterThan(0);
  expect(screen.getByRole('heading', { name: '成績冊' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '發布王小明作業二成績 82 分' }));
  fireEvent.click(screen.getByRole('button', { name: '核准病假' }));
  expect(screen.getByText(/作業二已發布/)).toBeTruthy();
  expect(screen.getByText('已核准')).toBeTruthy();
});

it('shows merchant prepared orders without enabling live ordering', () => {
  navigation.search = 'role=merchant';
  render(<OralExamPlayground />);
  expect(screen.getAllByText(/示範店長黃阿英/).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/咖哩雞腿飯/).length).toBeGreaterThan(0);
  expect(screen.getByText(/正式環境未開放線上點餐/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '標為可取餐' }));
  expect(screen.getAllByText(/可取餐/).length).toBeGreaterThan(0);
});

it('limits school admin and ops views to the demo tenant', () => {
  navigation.search = 'role=school_admin';
  render(<OralExamPlayground />);
  expect(screen.getAllByText(/示範校務陳志明/).length).toBeGreaterThan(0);
  expect(screen.getByText(/只列出 nuni-oral-exam/)).toBeTruthy();
  cleanup();
  navigation.search = 'role=ops';
  render(<OralExamPlayground />);
  expect(screen.getAllByText(/示範營運吳平台/).length).toBeGreaterThan(0);
  expect(screen.getByText('其他租戶可見：否')).toBeTruthy();
  expect(screen.getByText('線上點餐：關')).toBeTruthy();
  expect(screen.getByText(/正式 \/admin\/ops 仍需平台營運帳號/)).toBeTruthy();
});

it('exposes every role entry on the hub', () => {
  render(<OralExamPlayground />);
  expect(screen.getByRole('link', { name: /學生 · 示範學生王小明/ }).getAttribute('href')).toBe(
    '/demo/oral-exam?role=student',
  );
  expect(screen.getByRole('link', { name: /教師 · 示範教師林佳蓉/ })).toBeTruthy();
  expect(screen.getByRole('link', { name: /校方管理員 · 示範校務陳志明/ })).toBeTruthy();
  expect(screen.getByRole('link', { name: /店家 · 示範店長黃阿英/ })).toBeTruthy();
  expect(screen.getByRole('link', { name: /平台營運 · 示範營運吳平台/ })).toBeTruthy();
});
