import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { PersonalImportRecord } from '@campus/shared';
import { MonthCalendar } from './MonthCalendar';

it('顯示每日名稱、展開更多、選日期及沿用事件物件', () => {
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
  const onDate = vi.fn();
  const onEdit = vi.fn();
  render(
    <MonthCalendar
      month="2024-03"
      records={records}
      selectedDate=""
      onDate={onDate}
      onEdit={onEdit}
      disabled={false}
    />,
  );
  expect(screen.getByRole('button', { name: records[0].title })).toBeTruthy();
  expect(screen.queryByText('合成2')).toBeNull();
  fireEvent.click(screen.getByText('還有 1 筆'));
  fireEvent.click(screen.getByText('合成2'));
  expect(onEdit).toHaveBeenCalledWith(records[2]);
  fireEvent.click(screen.getByRole('button', { name: '2024-03-01' }));
  expect(onDate).toHaveBeenCalledWith('2024-03-01');
  fireEvent.click(screen.getByText('收合'));
  expect(screen.queryByText('合成2')).toBeNull();
});
