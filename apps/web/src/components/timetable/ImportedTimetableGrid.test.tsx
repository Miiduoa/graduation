import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanCourse, WEEKDAY_LABELS } from '@campus/shared';
import { TimetableGrid } from './TimetableGrid';

afterEach(cleanup);
const manual = cleanCourse({ id: 'manual', name: '手動課程', day: 1, start: 3, end: 4 });
const imported = cleanCourse({ id: 'import:grade-one', name: '匯入課程', day: 1, start: 3, end: 5 });

it('displays overlapping manual and imported courses without hiding either', () => {
  const onEdit = vi.fn();
  render(<TimetableGrid courses={[manual, imported]} disabled={false} onEdit={onEdit} />);
  const table = screen.getByRole('table', { name: '一週格子課表' });
  expect(table.textContent).toContain('同時有 2 門課');
  const importedButton = screen.getByRole('button', { name: /檢視匯入紀錄 匯入課程.*第 3 節/ }) as HTMLButtonElement;
  expect(importedButton.draggable).toBe(false);
  fireEvent.click(importedButton);
  expect(onEdit).toHaveBeenCalledExactlyOnceWith(imported);
});

it('only lets the user move manual classes and keeps imported records unchanged', () => {
  const onEdit = vi.fn();
  render(<TimetableGrid courses={[manual, imported]} disabled={false} onEdit={onEdit} />);
  fireEvent.click(screen.getByRole('button', { name: '移動課程' }));
  const select = screen.getByRole('combobox', { name: '要移動的課程' }) as HTMLSelectElement;
  expect([...select.options].map(option => option.textContent).join(' ')).not.toContain('匯入課程');
  fireEvent.change(select, { target: { value: manual.id } });
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`移到${WEEKDAY_LABELS[1]}第 6 節`) }));
  expect(onEdit).toHaveBeenCalledWith({ ...manual, day: 2, start: 6, end: 7 });
  expect(imported).toMatchObject({ day: 1, start: 3, end: 5 });
});
