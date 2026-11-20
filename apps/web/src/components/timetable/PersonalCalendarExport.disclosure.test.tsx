import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { PersonalCalendarExport } from './PersonalCalendarExport';

afterEach(cleanup);

it('opens export settings without downloading, and keeps the chosen range when closed and reopened', () => {
  const create = vi.fn(() => 'blob:fixture');
  const previous = URL.createObjectURL;
  URL.createObjectURL = create;
  try {
    render(<PersonalCalendarExport records={[]} schoolId="pu" termKey="115|1" />);
    const summary = screen.getByText('匯出至行事曆', { exact: false });
    const details = summary.closest('details')!;
    expect(details.open).toBe(false);
    fireEvent.click(summary);
    expect(details.open).toBe(true);
    expect(screen.getByText(/不會自動更新/)).toBeTruthy();
    expect(screen.getByText(/重複匯入可能產生重複行程/)).toBeTruthy();
    expect(screen.getByText(/未登記的放假或停課/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('匯出開始日期'), { target: { value: '2026-11-02' } });
    fireEvent.change(screen.getByLabelText('匯出結束日期'), { target: { value: '2026-11-08' } });
    fireEvent.click(summary);
    expect(details.open).toBe(false);
    fireEvent.click(summary);
    expect((screen.getByLabelText('匯出開始日期') as HTMLInputElement).value).toBe('2026-11-02');
    expect((screen.getByLabelText('匯出結束日期') as HTMLInputElement).value).toBe('2026-11-08');
    expect(create).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: '下載課表 ICS' }) as HTMLButtonElement).disabled).toBe(true);
  } finally {
    URL.createObjectURL = previous;
  }
});
