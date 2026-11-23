import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import type { PersonalImportRecord } from '@campus/shared';
import { MonthCalendar } from './MonthCalendar';

afterEach(() => vi.useRealTimers());

const baseProps = {
  records: [] as PersonalImportRecord[],
  month: '2028-01',
  selectedDate: '2028-01-31',
  onDate: vi.fn(),
  onEdit: vi.fn(),
  disabled: false,
};

function focusDate(date: string) {
  const button = screen.getByRole('button', { name: date });
  act(() => button.focus());
  return button;
}

function dateTabStops() {
  return screen
    .getAllByRole('button', { name: /^\d{4}-\d{2}-\d{2}$/ })
    .filter((button) => button.tabIndex === 0);
}

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
  expect(screen.getByRole('heading', { name: '2024 / 03' })).toBeTruthy();
  expect(screen.getByRole('region', { name: '2024-03 月格，週日起始' }).tabIndex).toBe(0);
  expect(screen.getByRole('button', { name: records[0].title })).toBeTruthy();
  expect(screen.queryByText('合成2')).toBeNull();
  fireEvent.click(screen.getByText('還有 1 筆'));
  const edit = screen.getByRole('button', { name: '合成2' });
  fireEvent.click(edit);
  expect(onEdit).toHaveBeenCalledWith(records[2], edit);
  const date = screen.getByRole('button', { name: '2024-03-01' });
  expect(document.getElementById(date.getAttribute('aria-describedby')!)?.textContent).toBe(
    '3 筆行程',
  );
  fireEvent.click(screen.getByRole('button', { name: '2024-03-01' }));
  expect(onDate).toHaveBeenCalledWith('2024-03-01');
  fireEvent.click(screen.getByText('收合'));
  expect(screen.queryByText('合成2')).toBeNull();
});

it('日期只保留一個 Tab 入口，方向鍵移動焦點而不改選日', () => {
  const onDate = vi.fn();
  render(<MonthCalendar {...baseProps} selectedDate="2028-01-12" onDate={onDate} />);
  expect(dateTabStops()).toEqual([screen.getByRole('button', { name: '2028-01-12' })]);
  fireEvent.keyDown(focusDate('2028-01-12'), { key: 'ArrowDown' });
  expect(document.activeElement).toBe(screen.getByRole('button', { name: '2028-01-19' }));
  expect(dateTabStops()).toEqual([document.activeElement]);
  expect(screen.getByRole('button', { name: '2028-01-12' }).getAttribute('aria-pressed')).toBe(
    'true',
  );
  expect(onDate).not.toHaveBeenCalled();
  fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
  expect(document.activeElement).toBe(screen.getByRole('button', { name: '2028-01-20' }));
  fireEvent.keyDown(document.activeElement!, { key: 'Home' });
  expect(document.activeElement).toBe(screen.getByRole('button', { name: '2028-01-16' }));
  fireEvent.keyDown(document.activeElement!, { key: 'End' });
  expect(document.activeElement).toBe(screen.getByRole('button', { name: '2028-01-22' }));
  fireEvent.click(document.activeElement!);
  expect(onDate).toHaveBeenCalledExactlyOnceWith('2028-01-22');
});

it('PageDown 跨到閏年短月保留焦點，只有選取後才改當日內容', () => {
  const onDate = vi.fn();
  function ControlledCalendar() {
    const [month, setMonth] = useState('2028-01');
    const [selectedDate, setSelectedDate] = useState('2028-01-31');
    return (
      <MonthCalendar
        {...baseProps}
        month={month}
        selectedDate={selectedDate}
        onMonthChange={(next) => {
          setMonth(next);
          setSelectedDate('');
        }}
        onDate={(date) => {
          onDate(date);
          setSelectedDate(date);
        }}
      />
    );
  }
  render(<ControlledCalendar />);
  fireEvent.keyDown(focusDate('2028-01-31'), { key: 'PageDown' });
  expect(screen.getByRole('heading', { name: '2028 / 02' })).toBeTruthy();
  const target = screen.getByRole('button', { name: '2028-02-29' });
  expect(document.activeElement).toBe(target);
  expect(target.getAttribute('aria-pressed')).toBe('false');
  expect(dateTabStops()).toEqual([target]);
  expect(onDate).not.toHaveBeenCalled();
  fireEvent.click(target);
  expect(onDate).toHaveBeenCalledExactlyOnceWith('2028-02-29');
  expect(target.getAttribute('aria-pressed')).toBe('true');
  fireEvent.keyDown(target, { key: 'ArrowRight' });
  expect(document.activeElement).toBe(screen.getByRole('button', { name: '2028-03-01' }));
  expect(onDate).toHaveBeenCalledTimes(1);
});

it('外部月份或日期更新不搶走目前控制的焦點', () => {
  const { rerender } = render(
    <>
      <button type="button">回今天</button>
      <MonthCalendar {...baseProps} />
    </>,
  );
  const outside = screen.getByRole('button', { name: '回今天' });
  act(() => outside.focus());
  rerender(
    <>
      <button type="button">回今天</button>
      <MonthCalendar {...baseProps} month="2028-02" selectedDate="2028-02-14" />
    </>,
  );
  expect(document.activeElement).toBe(outside);
  expect(dateTabStops()).toEqual([screen.getByRole('button', { name: '2028-02-14' })]);
  rerender(
    <>
      <button type="button">回今天</button>
      <MonthCalendar {...baseProps} month="2028-02" selectedDate="2028-02-21" />
    </>,
  );
  expect(document.activeElement).toBe(outside);
  expect(dateTabStops()).toEqual([screen.getByRole('button', { name: '2028-02-21' })]);
});

it('缺少跨月回呼時留在邊界，不攔截瀏覽器快捷鍵', () => {
  render(<MonthCalendar {...baseProps} />);
  const last = focusDate('2028-01-31');
  fireEvent.keyDown(last, { key: 'ArrowRight' });
  expect(document.activeElement).toBe(last);
  expect(dateTabStops()).toEqual([last]);
  const shortcut = new KeyboardEvent('keydown', {
    key: 'ArrowLeft',
    altKey: true,
    bubbles: true,
    cancelable: true,
  });
  fireEvent(last, shortcut);
  expect(shortcut.defaultPrevented).toBe(false);
  expect(document.activeElement).toBe(last);
});

it('今天依台灣日期標示，禁止編輯時仍可查看日期', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2028-01-30T16:30:00Z'));
  const onDate = vi.fn();
  render(<MonthCalendar {...baseProps} selectedDate="" disabled onDate={onDate} />);
  const today = screen.getByRole('button', { name: '2028-01-31' });
  expect(today.getAttribute('aria-current')).toBe('date');
  expect(dateTabStops()).toEqual([today]);
  expect(document.getElementById(today.getAttribute('aria-describedby')!)?.textContent).toBe(
    '今天，沒有個人行程',
  );
  fireEvent.click(today);
  expect(onDate).toHaveBeenCalledExactlyOnceWith('2028-01-31');
});
