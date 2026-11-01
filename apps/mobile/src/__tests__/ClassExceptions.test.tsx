import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { ClassExceptions } from '../components/ClassExceptions';
import type { ClassException, PersonalImportRecord } from '@campus/shared';
const row: PersonalImportRecord = {
  id: 'synthetic',
  kind: 'timetable',
  title: '合成課程',
  schoolId: 'pu',
  academicYear: '115',
  semester: '1',
  dayOfWeek: 1,
  startTime: '09:00',
  endTime: '12:00',
  location: '原教室',
  batchId: 'batch',
  importedAt: '',
  source: { type: 'paste', line: 1, rawText: '合成來源' },
};
test('changes the room for a selected date and retains original source', async () => {
  let saved: ClassException[] = [];
  const onSave = jest.fn(async (next: ClassException[]) => {
    saved = next;
    return true;
  });
  const view = render(<ClassExceptions records={[row]} schoolId="pu" onSave={onSave} />);
  fireEvent.changeText(view.getByLabelText('查看日期'), '2026-11-02');
  fireEvent.press(view.getByText('只換教室'));
  fireEvent.changeText(view.getByLabelText('這次的教室'), '新教室');
  fireEvent.press(view.getByText('儲存這次安排'));
  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  expect(saved[0]).toMatchObject({
    kind: 'room',
    originalDate: '2026-11-02',
    location: '新教室',
    original: { source: { type: 'paste', line: 1, rawText: '' } },
  });
  view.rerender(
    <ClassExceptions records={[row]} exceptions={saved} schoolId="pu" onSave={onSave} />,
  );
  expect(view.getByText('09:00–12:00 · 新教室')).toBeTruthy();
  fireEvent.press(view.getByText('恢復原安排'));
  await waitFor(() => expect(onSave).toHaveBeenLastCalledWith([]));
});
test('keeps a makeup draft after a storage failure and tolerates partially typed dates', async () => {
  const view = render(<ClassExceptions records={[row]} schoolId="pu" onSave={async () => false} />);
  fireEvent.changeText(view.getByLabelText('查看日期'), '2026-');
  expect(view.getByText('請填寫完整有效日期。')).toBeTruthy();
  fireEvent.changeText(view.getByLabelText('查看日期'), '2026-11-02');
  fireEvent.press(view.getByText('改期補課'));
  fireEvent.changeText(view.getByLabelText('補課日期'), '2026-11-03');
  fireEvent.changeText(view.getByLabelText('開始時間'), '23:30');
  fireEvent.changeText(view.getByLabelText('結束日期'), '2026-11-04');
  fireEvent.changeText(view.getByLabelText('結束時間'), '01:00');
  fireEvent.press(view.getByText('儲存這次安排'));
  await waitFor(() => expect(view.getByText('尚未完成儲存，請保留畫面並重試。')).toBeTruthy());
  expect(view.getByLabelText('補課日期').props.value).toBe('2026-11-03');
});


test('previews an overlap only on the overnight ending date', () => {
  const view = render(<ClassExceptions records={[row, { ...row, id: 'early', title: '凌晨課', dayOfWeek: 3, startTime: '00:30', endTime: '01:30' }]} schoolId="pu" onSave={async () => true} />);
  fireEvent.changeText(view.getByLabelText('查看日期'), '2026-11-02');
  fireEvent.press(view.getByText('改期補課'));
  fireEvent.changeText(view.getByLabelText('補課日期'), '2026-11-03');
  fireEvent.changeText(view.getByLabelText('開始時間'), '23:30');
  fireEvent.changeText(view.getByLabelText('結束日期'), '2026-11-04');
  fireEvent.changeText(view.getByLabelText('結束時間'), '01:00');
  expect(view.getByText('補課時間與其他課程重疊，請核對；仍可儲存。')).toBeTruthy();
});
