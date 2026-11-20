import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { NuniStudyTask } from '@campus/shared/src/nuniStudyAgenda';
import { studyCalendarKey } from '@campus/shared/src/studyAgendaCalendar';
import type { StudyDeadlineSource } from '@campus/shared/src/studyDeadlineConflicts';
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
it('keeps conflict copy, grades and student identifiers out of the downloaded ICS', async () => {
  vi.useRealTimers();
  const blobs: Blob[] = [];
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: (blob: Blob) => {
      blobs.push(blob);
      return 'blob:ics';
    },
  });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  const conflictSources: StudyDeadlineSource[] = [
    {
      kind: 'events',
      schoolId: 's',
      termKey: '115|1',
      start: '2026-11-01',
      end: '2026-11-30',
      status: 'complete',
      records: [
        {
          id: 'secret',
          batchId: 'b',
          importedAt: '',
          kind: 'events',
          title: '學號A12345678的補考',
          schoolId: 's',
          academicYear: '115',
          semester: '1',
          grade: '99',
          source: { type: 'paste', line: 1, rawText: '學號A12345678 grade=99' },
          date: '2026-11-02',
          startTime: '00:00',
          endTime: '01:00',
        },
      ],
    },
  ];
  render(
    <StudyDeadlineExport
      tasks={[task()]}
      partial={false}
      retry={vi.fn()}
      conflictSources={conflictSources}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: '匯出未繳期限 ICS' }));
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: '預覽已選 1 項' }));
  expect(screen.getByLabelText('期限匯出預覽').textContent).toContain(
    '與個人事件衝突：學號A12345678的補考',
  );
  fireEvent.click(screen.getByRole('button', { name: '下載 ICS' }));
  expect(blobs).toHaveLength(1);
  const content = await blobs[0].text();
  expect(content).toContain(`UID:study-${studyCalendarKey(task())}@nuni.tw`);
  expect(content).toContain('DTSTART:20261101T163000Z');
  expect(content).toContain('DTEND:20261101T163000Z');
  expect(content).not.toMatch(/學號A12345678|grade=99|衝突|未知|\b99\b/);
});
