import { act, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import {
  TODAY_NOTIFY_EMPTY,
  TODAY_NOTIFY_ERROR,
  TODAY_NOTIFY_TITLE,
  TODAY_NOTIFY_UNSIGNED,
} from '@/lib/todayCourseWork';
import type { AccountNotification, NotificationFeed } from '@/lib/privateMessages';
import { TodayUnreadNotifications } from './TodayUnreadNotifications';

const state = vi.hoisted(() => ({
  uid: 'alice' as string | null,
  authLoading: false,
  schoolId: 'pu' as string | null,
  firebaseConfigured: true,
  watch: null as null | {
    receive: (feed: NotificationFeed) => void;
    fail: () => void;
  },
}));

vi.mock('next/link', () => ({
  default: (props: ComponentProps<'a'>) => <a data-client-navigation="true" {...props} />,
}));

vi.mock('@/components/AuthGuard', () => ({
  useAuth: () => ({
    user: state.uid ? { uid: state.uid } : null,
    loading: state.authLoading,
  }),
}));

vi.mock('@/components/SelectedSchoolProvider', () => ({
  useOptionalSelectedSchool: () =>
    state.schoolId
      ? {
          selectedSchool: { id: state.schoolId, name: '測試校' },
          selectedSchoolId: state.schoolId,
          loading: false,
        }
      : { selectedSchool: null, selectedSchoolId: null, loading: false },
}));

vi.mock('@/lib/firebase', () => ({
  isFirebaseConfigured: () => state.firebaseConfigured,
}));

vi.mock('@/lib/privateMessages', async (original) => {
  const actual = await original<typeof import('@/lib/privateMessages')>();
  return {
    ...actual,
    watchAccountNotifications: vi.fn((_session, receive, fail) => {
      state.watch = { receive, fail };
      return () => {
        state.watch = null;
      };
    }),
  };
});

function notice(patch: Partial<AccountNotification> = {}): AccountNotification {
  return {
    id: 'n1',
    source: 'user',
    title: '作業提醒',
    body: '資料庫作業將截止',
    type: 'assignment',
    read: false,
    createdAt: '2026-10-25T01:00:00.000Z',
    data: { courseId: 'cs-db', assignmentId: 'hw-1' },
    ...patch,
  };
}

beforeEach(() => {
  state.uid = 'alice';
  state.authLoading = false;
  state.schoolId = 'pu';
  state.firebaseConfigured = true;
  state.watch = null;
});

it('shows unsigned empty state without watching when unsigned', () => {
  render(<TodayUnreadNotifications unsigned />);
  expect(screen.getByRole('heading', { name: TODAY_NOTIFY_TITLE })).toBeTruthy();
  expect(screen.getByText(TODAY_NOTIFY_UNSIGNED)).toBeTruthy();
  expect(screen.getByRole('link', { name: '前往通知匣' }).getAttribute('href')).toBe('/messages');
  expect(state.watch).toBeNull();
});

it('asks to pick a campus when signed in but no school is selected', () => {
  state.schoolId = null;
  render(<TodayUnreadNotifications unsigned={false} />);
  expect(screen.getByText(/先選擇校園後/)).toBeTruthy();
  expect(screen.getByRole('link', { name: '前往通知匣' }).getAttribute('href')).toBe('/messages');
  expect(state.watch).toBeNull();
});

it('surfaces watch errors with retry and inbox escape', async () => {
  render(<TodayUnreadNotifications unsigned={false} />);
  expect(state.watch).toBeTruthy();
  await act(async () => {
    state.watch!.fail();
  });
  expect(screen.getByRole('alert').textContent).toContain(TODAY_NOTIFY_ERROR);
  expect(screen.getByRole('button', { name: '重試' })).toBeTruthy();
  expect(screen.getByRole('link', { name: '前往通知匣' }).getAttribute('href')).toBe('/messages');
});

it('links unread rows to their notification destination', async () => {
  render(<TodayUnreadNotifications unsigned={false} />);
  await act(async () => {
    state.watch!.receive({
      notifications: [
        notice(),
        notice({
          id: 'n2',
          title: '已讀不顯示',
          read: true,
          data: { courseId: 'cs-db', assignmentId: 'hw-2' },
        }),
        notice({
          id: 'n3',
          title: '系統公告',
          type: 'announcement',
          body: '校園公告',
          data: {},
        }),
      ],
      unscopedCount: 0,
    });
  });
  expect(screen.queryByText(TODAY_NOTIFY_EMPTY)).toBeNull();
  expect(screen.getByRole('link', { name: /作業提醒/ }).getAttribute('href')).toBe(
    '/course/cs-db#assignment-hw-1',
  );
  expect(screen.getByRole('link', { name: /系統公告/ }).getAttribute('href')).toBe(
    '/announcements',
  );
  expect(screen.getByRole('link', { name: /作業提醒/ }).getAttribute('data-client-navigation')).toBe('true');
  expect(screen.getByRole('link', { name: /系統公告/ }).getAttribute('data-client-navigation')).toBe('true');
  expect(screen.queryByText('已讀不顯示')).toBeNull();
});

it.each(['groupId', 'courseId'] as const)(
  'opens attendance with a full document navigation using %s',
  async (courseKey) => {
    render(<TodayUnreadNotifications unsigned={false} />);
    await act(async () => {
      state.watch!.receive({
        notifications: [notice({
          title: '課堂點名',
          type: 'live_session',
          data: { [courseKey]: 'cs-db', sessionId: 'session 1' },
        })],
        unscopedCount: 0,
      });
    });
    const link = screen.getByRole('link', { name: /課堂點名/ });
    expect(link.getAttribute('href')).toBe('/course/cs-db/attendance?sessionId=session%201');
    expect(link.getAttribute('data-client-navigation')).toBeNull();
  },
);

it.each(['account', 'school'] as const)(
  'hides the previous feed immediately when the %s changes and ignores its late callbacks',
  async (scope) => {
    const { container, rerender } = render(<TodayUnreadNotifications unsigned={false} />);
    const previousWatch = state.watch!;
    await act(async () => {
      previousWatch.receive({
        notifications: [notice({ title: '上一個範圍的私人通知' })],
        unscopedCount: 0,
      });
    });
    expect(screen.getByText('上一個範圍的私人通知')).toBeTruthy();

    if (scope === 'account') state.uid = 'bob';
    else state.schoolId = 'nthu';
    rerender(<TodayUnreadNotifications unsigned={false} />);
    const currentWatch = state.watch!;

    expect(screen.queryByText('上一個範圍的私人通知')).toBeNull();
    expect(container.querySelector('[aria-busy="true"]')).toBeTruthy();
    expect(currentWatch).not.toBe(previousWatch);

    await act(async () => {
      previousWatch.receive({
        notifications: [notice({ title: '延遲抵達的舊通知' })],
        unscopedCount: 0,
      });
      previousWatch.fail();
    });
    expect(screen.queryByText('延遲抵達的舊通知')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();

    await act(async () => {
      currentWatch.receive({
        notifications: [notice({ title: '目前範圍的通知' })],
        unscopedCount: 0,
      });
    });
    expect(screen.getByText('目前範圍的通知')).toBeTruthy();
    expect(container.querySelector('[aria-busy="true"]')).toBeNull();

    state.uid = 'alice';
    state.schoolId = 'pu';
    rerender(<TodayUnreadNotifications unsigned={false} />);
    expect(screen.queryByText('目前範圍的通知')).toBeNull();
    expect(screen.queryByText('上一個範圍的私人通知')).toBeNull();
    expect(container.querySelector('[aria-busy="true"]')).toBeTruthy();
  },
);

it.each(['authLoading', 'unsigned'] as const)(
  'waits for a fresh feed after %s resets for the same account and school',
  async (gate) => {
    let unsigned = false;
    const { container, rerender } = render(<TodayUnreadNotifications unsigned={unsigned} />);
    const previousWatch = state.watch!;
    await act(async () => {
      previousWatch.receive({
        notifications: [notice({ title: '重驗前的私人通知' })],
        unscopedCount: 0,
      });
    });
    expect(screen.getByText('重驗前的私人通知')).toBeTruthy();

    if (gate === 'authLoading') state.authLoading = true;
    else unsigned = true;
    rerender(<TodayUnreadNotifications unsigned={unsigned} />);
    expect(screen.queryByText('重驗前的私人通知')).toBeNull();
    expect(state.watch).toBeNull();

    state.authLoading = false;
    unsigned = false;
    rerender(<TodayUnreadNotifications unsigned={unsigned} />);
    const currentWatch = state.watch!;
    expect(currentWatch).toBeTruthy();
    expect(currentWatch).not.toBe(previousWatch);
    expect(screen.queryByText('重驗前的私人通知')).toBeNull();
    expect(container.querySelector('[aria-busy="true"]')).toBeTruthy();

    await act(async () => {
      currentWatch.receive({
        notifications: [notice({ title: '重驗後的新通知' })],
        unscopedCount: 0,
      });
    });
    expect(screen.getByText('重驗後的新通知')).toBeTruthy();
    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
  },
);
