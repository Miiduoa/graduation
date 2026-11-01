import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { PersonalCalendarExport } from '../components/PersonalCalendarExport';
import { shareICalContent } from '../services/ical';
import type { PersonalImportRecord } from '@campus/shared';
jest.mock('../services/ical', () => ({ shareICalContent: jest.fn(async () => {}) }));
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
test('previews and shares the selected snapshot, reports failures and fences unmount', async () => {
  const props = {
    records: [row, { ...row, id: 'unknown', title: '待確認', endTime: undefined }],
    schoolId: 'pu',
    termKey: '115|1',
  };
  const view = render(<PersonalCalendarExport {...props} />);
  fireEvent.changeText(view.getByLabelText('匯出開始日期'), '2026-11-02');
  fireEvent.changeText(view.getByLabelText('匯出結束日期'), '2026-11-08');
  expect(view.getByText('將匯出 1 堂課；略過 1 門時間未確認的課程。')).toBeTruthy();
  expect(view.getByText('待確認：星期或時間未確認')).toBeTruthy();
  fireEvent.press(view.getByText('分享課表 ICS'));
  await waitFor(() => expect(shareICalContent).toHaveBeenCalledTimes(1));
  expect(jest.mocked(shareICalContent).mock.calls[0][0]).toContain('DTSTART:20261102T010000Z');
  await waitFor(() => expect(view.getByText('分享課表 ICS')).toBeTruthy());
  jest.mocked(shareICalContent).mockRejectedValueOnce(new Error('failed'));
  fireEvent.press(view.getByText('分享課表 ICS'));
  await waitFor(() => expect(view.getByText('分享選單未能開啟，請稍後再試。')).toBeTruthy());
  fireEvent.changeText(view.getByLabelText('匯出結束日期'), '2027-01-01');
  fireEvent.press(view.getByText('分享課表 ICS'));
  expect(shareICalContent).toHaveBeenCalledTimes(2);
  view.rerender(<PersonalCalendarExport {...props} disabled />);
  expect(view.getByText('課表尚未完整讀取，暫時無法匯出。')).toBeTruthy();
  const active = jest.mocked(shareICalContent).mock.calls[0][2]!;
  view.unmount();
  expect(active()).toBe(false);
});
