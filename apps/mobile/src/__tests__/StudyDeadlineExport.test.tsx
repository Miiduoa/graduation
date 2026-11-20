import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import type { NuniStudyTask } from '@campus/shared/src/nuniStudyAgenda';
import { StudyDeadlineExport } from '../screens/nuni/StudyDeadlineExport';
import { shareICalContent } from '../services/ical';

jest.mock('../services/ical', () => ({ shareICalContent: jest.fn() }));
jest.mock('../state/theme', () => ({ useTheme: () => require('../ui/theme').theme }));
const share = jest.mocked(shareICalContent);
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
beforeEach(() => share.mockReset());
it('previews selected tasks, retains selection for retry, and does not claim a share was saved', async () => {
  share.mockRejectedValueOnce(new Error('failed')).mockResolvedValueOnce();
  const retry = jest.fn();
  const view = render(
    <StudyDeadlineExport
      tasks={[task(), task({ id: 'b', submittedAt: '2026-11-01T00:00:00Z' })]}
      partial
      retry={retry}
    />,
  );
  fireEvent.press(view.getByRole('button', { name: '匯出未繳期限 ICS' }));
  expect(view.getByText(/部分課程讀取失敗或達到來源上限/)).toBeTruthy();
  expect(
    view.getByRole('button', { name: '預覽已選 0 項' }).props.accessibilityState.disabled,
  ).toBe(true);
  expect(view.getAllByRole('checkbox')).toHaveLength(1);
  fireEvent.press(view.getByRole('checkbox'));
  fireEvent.press(view.getByRole('button', { name: '預覽已選 1 項' }));
  fireEvent.press(view.getByRole('button', { name: '分享 ICS' }));
  await waitFor(() => expect(view.getByText(/分享未能完成/)).toBeTruthy());
  expect(view.getByRole('checkbox').props.accessibilityState.checked).toBe(true);
  fireEvent.press(view.getByRole('button', { name: '分享 ICS' }));
  await waitFor(() => expect(view.getByText(/是否儲存或匯入/)).toBeTruthy());
  expect(share.mock.calls[1][0]).toContain('DTSTART:20261101T163000Z');
  expect(share.mock.calls[1][0]).toContain('DTEND:20261101T163000Z');
  expect(share.mock.calls[1][0]).not.toMatch(/衝突|未知|學號|grade=|\b99\b/);
  fireEvent.press(view.getByRole('button', { name: '更新待辦資料' }));
  expect(retry).toHaveBeenCalledTimes(1);
});
it('fences an outstanding share on unmount and prevents duplicate taps', async () => {
  let finish!: () => void;
  share.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const view = render(<StudyDeadlineExport tasks={[task()]} partial={false} retry={jest.fn()} />);
  fireEvent.press(view.getByRole('button', { name: '匯出未繳期限 ICS' }));
  fireEvent.press(view.getByRole('checkbox'));
  fireEvent.press(view.getByRole('button', { name: '預覽已選 1 項' }));
  fireEvent.press(view.getByRole('button', { name: '分享 ICS' }));
  fireEvent.press(view.getByRole('button', { name: '正在開啟分享…' }));
  expect(share).toHaveBeenCalledTimes(1);
  const active = share.mock.calls[0][2]!;
  expect(active()).toBe(true);
  view.unmount();
  expect(active()).toBe(false);
  await act(async () => finish());
});
it('keeps conflict copy, grades and student identifiers out of the shared ICS', async () => {
  share.mockResolvedValueOnce();
  const view = render(
    <StudyDeadlineExport
      tasks={[task()]}
      partial={false}
      retry={jest.fn()}
      conflictSources={[
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
      ]}
    />,
  );
  fireEvent.press(view.getByRole('button', { name: '匯出未繳期限 ICS' }));
  fireEvent.press(view.getByRole('checkbox'));
  fireEvent.press(view.getByRole('button', { name: '預覽已選 1 項' }));
  expect(view.getByText(/與個人事件衝突：學號A12345678的補考/)).toBeTruthy();
  fireEvent.press(view.getByRole('button', { name: '分享 ICS' }));
  await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
  expect(share.mock.calls[0][0]).toContain('UID:study-c:assignment:a@nuni.tw');
  expect(share.mock.calls[0][0]).toContain('DTSTART:20261101T163000Z');
  expect(share.mock.calls[0][0]).toContain('DTEND:20261101T163000Z');
  expect(share.mock.calls[0][0]).not.toMatch(/學號A12345678|grade=99|衝突|未知|\b99\b/);
});
it('offers a next step when no precise unfinished deadline exists', () => {
  const view = render(
    <StudyDeadlineExport tasks={[task({ dueAt: null })]} partial={false} retry={jest.fn()} />,
  );
  fireEvent.press(view.getByRole('button', { name: '匯出未繳期限 ICS' }));
  expect(view.getByText(/目前沒有可匯出的未繳期限/)).toBeTruthy();
  expect(view.queryByRole('checkbox')).toBeNull();
});
