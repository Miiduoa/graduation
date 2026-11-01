import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import type { PersonalImportRecord } from '@campus/shared';
import { PersonalMonthCalendar } from '../screens/PersonalMonthCalendar';

it('小格呈現活動文字、更多可展開並回傳原始事件與日期', () => {
  const records: PersonalImportRecord[] = Array.from({ length: 3 }, (_, i) => ({
    id: String(i),
    kind: 'events',
    title: i === 0 ? '跨月活動的完整長名稱應可透過輔助科技閱讀' : `合成${i}`,
    schoolId: 'pu',
    academicYear: '',
    semester: '',
    date: '2024-02-29',
    endDate: '2024-03-02',
    allDay: true,
    batchId: 'test',
    importedAt: '2024-01-01T00:00:00Z',
    source: { type: 'paste', line: 1, rawText: '' },
  }));
  const onDate = jest.fn();
  const onEdit = jest.fn();
  const view = render(
    <PersonalMonthCalendar
      month="2024-03"
      records={records}
      selectedDate=""
      onDate={onDate}
      onEdit={onEdit}
      disabled={false}
    />,
  );
  expect(view.getByRole('button', { name: records[0].title })).toBeTruthy();
  expect(view.queryByText('合成2')).toBeNull();
  fireEvent.press(view.getByText('還有 1 筆'));
  fireEvent.press(view.getByText('合成2'));
  expect(onEdit).toHaveBeenCalledWith(records[2]);
  fireEvent.press(view.getByLabelText('2024-03-01'));
  expect(onDate).toHaveBeenCalledWith('2024-03-01');
  fireEvent.press(view.getByText('收合'));
  expect(view.queryByText('合成2')).toBeNull();
});
