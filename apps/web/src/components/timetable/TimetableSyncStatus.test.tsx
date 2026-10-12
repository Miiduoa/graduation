import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const context = vi.hoisted(() => ({ uid: 'u-1', schoolId: 'pu', loading: false }));
const retry = vi.hoisted(() => vi.fn());
vi.mock('@/components/AuthGuard', () => ({ useAuth: () => ({ user: { uid: context.uid }, loading: context.loading }) }));
vi.mock('@/components/SelectedSchoolProvider', () => ({ useSelectedSchool: () => ({ selectedSchoolId: context.schoolId, loading: false }) }));
vi.mock('@/lib/timetable/persistence', () => ({ retryPersonalTimetableSync: retry }));

import { TimetableSyncStatus } from './TimetableSyncStatus';
import { setTimetableSyncStatus } from '@/lib/timetable/syncStatus';

beforeEach(() => {
  context.uid = 'u-1'; context.schoolId = 'pu'; context.loading = false;
  retry.mockReset();
  setTimetableSyncStatus('u-1', 'pu', { kind: 'idle' });
  setTimetableSyncStatus('u-1', 'nchu', { kind: 'idle' });
  setTimetableSyncStatus('other', 'pu', { kind: 'idle' });
});
afterEach(cleanup);

it('waits until the account and school are known', () => {
  context.loading = true;
  setTimetableSyncStatus('u-1', 'pu', { kind: 'pending' });
  render(<TimetableSyncStatus />);
  expect(screen.queryByRole('region', { name: '課表儲存狀態' })).toBeNull();
});

it('provides one retry action and suppresses a second click while it is running', async () => {
  let finish!: () => void;
  retry.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
  setTimetableSyncStatus('u-1', 'pu', { kind: 'pending' });
  render(<TimetableSyncStatus />);
  const button = screen.getByRole('button', { name: '重新同步' });
  fireEvent.click(button); fireEvent.click(button);
  expect(retry).toHaveBeenCalledTimes(1);
  expect(retry).toHaveBeenCalledWith('u-1', 'pu');
  await act(async () => { finish(); });
});

it('does not offer a misleading retry for a different cloud campus', () => {
  setTimetableSyncStatus('u-1', 'pu', { kind: 'conflict' });
  render(<TimetableSyncStatus />);
  expect(screen.getByRole('status').textContent).toContain('不會覆蓋另一校園');
  expect(screen.queryByRole('button', { name: '重新同步' })).toBeNull();
});

it('does not carry a pending status into another campus or account', () => {
  setTimetableSyncStatus('u-1', 'pu', { kind: 'pending' });
  const view = render(<TimetableSyncStatus />);
  expect(screen.getByRole('status').textContent).toContain('尚未同步');
  context.schoolId = 'nchu';
  view.rerender(<TimetableSyncStatus />);
  expect(screen.queryByRole('status')).toBeNull();
  context.schoolId = 'pu'; context.uid = 'other';
  view.rerender(<TimetableSyncStatus />);
  expect(screen.queryByRole('status')).toBeNull();
});

it('describes malformed storage without claiming a successful save', () => {
  setTimetableSyncStatus('u-1', 'pu', { kind: 'error', detail: 'local-data' });
  render(<TimetableSyncStatus />);
  expect(screen.getByRole('status').textContent).toContain('沒有用空白課表覆蓋');
  expect(screen.getByRole('status').textContent).not.toContain('已同步至雲端');
});
