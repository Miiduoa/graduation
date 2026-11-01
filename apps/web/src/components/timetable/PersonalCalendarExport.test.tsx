import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { PersonalCalendarExport } from './PersonalCalendarExport';
import type { PersonalImportRecord } from '@campus/shared';
const row: PersonalImportRecord = {
  id: 'one',
  batchId: '',
  importedAt: '',
  kind: 'timetable',
  schoolId: 'pu',
  academicYear: '115',
  semester: '1',
  title: '有時間',
  dayOfWeek: 1,
  startTime: '09:00',
  endTime: '10:00',
  source: { type: 'paste', line: 1, rawText: '' },
};
it('previews the chosen period and skipped names before downloading, blocks invalid ranges and incomplete data', () => {
  const create = vi.fn(() => 'blob:calendar');
  URL.createObjectURL = create;
  URL.revokeObjectURL = vi.fn();
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  const props = {
    records: [row, { ...row, id: 'unknown', title: '待確認', endTime: undefined }],
    schoolId: 'pu',
    termKey: '115|1',
  };
  const view = render(<PersonalCalendarExport {...props} />);
  fireEvent.change(screen.getByLabelText('匯出開始日期'), { target: { value: '2026-11-02' } });
  fireEvent.change(screen.getByLabelText('匯出結束日期'), { target: { value: '2026-11-08' } });
  expect(screen.getByText('將匯出 1 堂課；略過 1 門時間未確認的課程。')).toBeTruthy();
  expect(screen.getByText('待確認：星期或時間未確認')).toBeTruthy();
  expect(screen.getByText(/重複匯入可能/)).toBeTruthy();
  fireEvent.click(screen.getByText('下載課表 ICS'));
  expect(create).toHaveBeenCalledTimes(1);
  expect(click).toHaveBeenCalledTimes(1);
  fireEvent.change(screen.getByLabelText('匯出結束日期'), { target: { value: '2027-01-01' } });
  expect((screen.getByText('下載課表 ICS') as HTMLButtonElement).disabled).toBe(true);
  view.rerender(<PersonalCalendarExport {...props} disabled />);
  expect(screen.getByText('課表尚未完整讀取，暫時無法匯出。')).toBeTruthy();
  expect((screen.getByText('下載課表 ICS') as HTMLButtonElement).disabled).toBe(true);
  click.mockRestore();
});
