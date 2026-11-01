import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { NuniStudyTask } from '@campus/shared/src/nuniStudyAgenda';
import { StudyDeadlineExport } from './StudyDeadlineExport';

const task = (overrides: Partial<NuniStudyTask> = {}): NuniStudyTask => ({
  id: 'a',
  courseId: 'c',
  courseTitle: '資料庫',
  title: '期末報告',
  kind: 'assignment',
  state: 'open',
  dueAt: '2026-11-02T00:30:00+08:00',
  submittedAt: null,
  feedback: null,
  reviewedAt: null,
  ...overrides,
});
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
it('requires a selection and preview; preserves choices after failure and downloads the selected snapshot', () => {
  const retry = vi.fn();
  const create = vi
    .fn()
    .mockImplementationOnce(() => {
      throw new Error('failed');
    })
    .mockReturnValue('blob:ics');
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: create });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  render(
    <StudyDeadlineExport
      tasks={[
        task(),
        task({ id: 'submitted', title: '已交', submittedAt: '2026-11-01T00:00:00Z' }),
      ]}
      partial
      retry={retry}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: '匯出未繳期限 ICS' }));
  expect(screen.getByText(/部分課程讀取失敗或達到來源上限/)).toBeTruthy();
  expect(screen.getByRole('button', { name: '預覽已選 0 項' }).hasAttribute('disabled')).toBe(true);
  expect(screen.getAllByRole('checkbox')).toHaveLength(1);
  fireEvent.click(screen.getByRole('checkbox'));
  expect(screen.queryByRole('button', { name: '下載 ICS' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '預覽已選 1 項' }));
  expect(screen.getByLabelText('期限匯出預覽').textContent).toContain('2026/11/2 上午12:30');
  fireEvent.click(screen.getByRole('button', { name: '下載 ICS' }));
  expect(screen.getByText(/下載未能開始/)).toBeTruthy();
  expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
  expect(screen.getByRole('button', { name: '正在下載…' }).hasAttribute('disabled')).toBe(true);
  act(() => {
    vi.advanceTimersByTime(1_000);
  });
  fireEvent.click(screen.getByRole('button', { name: '下載 ICS' }));
  expect(click).toHaveBeenCalledTimes(1);
  expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: '正在下載…' }).hasAttribute('disabled')).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '正在下載…' }));
  expect(click).toHaveBeenCalledTimes(1);
  act(() => {
    vi.advanceTimersByTime(999);
  });
  expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  act(() => {
    vi.advanceTimersByTime(1);
  });
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:ics');
  fireEvent.click(screen.getByRole('button', { name: '更新待辦資料' }));
  expect(retry).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('checkbox'));
  expect(screen.queryByRole('button', { name: '下載 ICS' })).toBeNull();
});
it('gives an actionable empty state and revalidates eligibility after a submission', () => {
  const view = render(<StudyDeadlineExport tasks={[task()]} partial={false} retry={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: '匯出未繳期限 ICS' }));
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: '預覽已選 1 項' }));
  view.rerender(
    <StudyDeadlineExport
      tasks={[task({ submittedAt: '2026-11-01T00:00:00Z' })]}
      partial={false}
      retry={vi.fn()}
    />,
  );
  expect(screen.queryByRole('button', { name: '下載 ICS' })).toBeNull();
  expect(screen.getByText(/目前沒有可匯出的未繳期限/)).toBeTruthy();
});
