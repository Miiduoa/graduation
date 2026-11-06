import { act, render, screen } from '@testing-library/react';
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
  expect(screen.queryByText('已讀不顯示')).toBeNull();
});

it('omits the school-only summary for an already signed-in platform account', () => {
  state.uid = null;
  render(<TodayUnreadNotifications unsigned={false} />);
  expect(screen.queryByText(TODAY_NOTIFY_UNSIGNED)).toBeNull();
  expect(screen.queryByRole('heading', { name: TODAY_NOTIFY_TITLE })).toBeNull();
  expect(state.watch).toBeNull();
});

it.each(['account', 'school'])('removes private notification rows immediately when %s changes', (change) => {
  const view = render(<TodayUnreadNotifications unsigned={false} />);
  const previous = state.watch!;
  act(() => previous.receive({ notifications: [notice()], unscopedCount: 0 }));
  expect(screen.getByRole('link', { name: /作業提醒/ })).toBeTruthy();
  if (change === 'account') state.uid = 'bob';
  else state.schoolId = 'nthu';
  view.rerender(<TodayUnreadNotifications unsigned={false} />);
  act(() => previous.receive({ notifications: [notice()], unscopedCount: 0 }));
  expect(screen.queryByRole('link', { name: /作業提醒/ })).toBeNull();
  expect(screen.queryByText(TODAY_NOTIFY_EMPTY)).toBeNull();
});
