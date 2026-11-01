import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ClassExceptions } from './ClassExceptions';
import type { ClassException, PersonalImportRecord } from '@campus/shared';
const row: PersonalImportRecord = {
  id: 'course',
  kind: 'timetable',
  schoolId: 'pu',
  title: '合成課程',
  academicYear: '115',
  semester: '1',
  dayOfWeek: 1,
  startTime: '09:00',
  endTime: '12:00',
  location: '原教室',
  batchId: 'batch',
  importedAt: '',
  source: { type: 'file', name: 'sample.csv', line: 3, rawText: '合成原始資料' },
};
it('saves one cancellation, exposes provenance, and restores the original arrangement', async () => {
  let saved: ClassException[] = [];
  const onSave = vi.fn(async (next: ClassException[]) => {
    saved = next;
  });
  const view = render(<ClassExceptions records={[row]} schoolId="pu" onSave={onSave} />);
  fireEvent.change(screen.getByLabelText('查看日期'), { target: { value: '2026-11-02' } });
  expect(screen.getByLabelText('當日實際課程').textContent).toContain('原教室');
  fireEvent.click(screen.getByRole('button', { name: '儲存這次安排' }));
  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  expect(saved[0]).toMatchObject({
    kind: 'cancel',
    originalDate: '2026-11-02',
    original: { source: { type: 'paste', line: 1, rawText: '' } },
  });
  view.rerender(
    <ClassExceptions records={[row]} exceptions={saved} schoolId="pu" onSave={onSave} />,
  );
  expect(screen.getByLabelText('當日實際課程').textContent).toBe('');
  expect(screen.queryByText('合成原始資料')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '恢復原安排' }));
  await waitFor(() => expect(onSave).toHaveBeenLastCalledWith([]));
});
it('shows overlaps and reports save failures without discarding the editor', async () => {
  render(
    <ClassExceptions
      records={[row, { ...row, id: 'second', title: '另一課' }]}
      schoolId="pu"
      onSave={async () => {
        throw new Error('儲存失敗');
      }}
    />,
  );
  fireEvent.change(screen.getByLabelText('查看日期'), { target: { value: '2026-11-02' } });
  expect(screen.getAllByText('時間重疊，請核對')).toHaveLength(2);
  fireEvent.change(screen.getByLabelText('這次安排'), { target: { value: 'room' } });
  fireEvent.change(screen.getByLabelText('這次的教室'), { target: { value: '新教室' } });
  fireEvent.click(screen.getByRole('button', { name: '儲存這次安排' }));
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', '儲存失敗');
  expect((screen.getByLabelText('這次的教室') as HTMLInputElement).value).toBe('新教室');
});

it('previews a makeup overlap before saving', () => {
  render(<ClassExceptions records={[row, { ...row, id: 'tuesday', title: '另一課', dayOfWeek: 2, startTime: '18:00', endTime: '20:00' }]} schoolId="pu" onSave={async () => undefined} />);
  fireEvent.change(screen.getByLabelText('查看日期'), { target: { value: '2026-11-02' } });
  fireEvent.change(screen.getByLabelText('這次安排'), { target: { value: 'move' } });
  fireEvent.change(screen.getByLabelText('補課日期'), { target: { value: '2026-11-03' } });
  expect(screen.getByText('補課時間與其他課程重疊，請核對；仍可儲存。')).toBeTruthy();
});


it('warns before saving an overnight move overlapping only on the following day', () => {
  render(<ClassExceptions records={[row, { ...row, id: 'early', title: '凌晨課', dayOfWeek: 3, startTime: '00:30', endTime: '01:30' }]} schoolId="pu" onSave={async () => undefined} />);
  fireEvent.change(screen.getByLabelText('查看日期'), { target: { value: '2026-11-02' } });
  fireEvent.change(screen.getByLabelText('這次安排'), { target: { value: 'move' } });
  fireEvent.change(screen.getByLabelText('補課日期'), { target: { value: '2026-11-03' } });
  fireEvent.change(screen.getByLabelText('開始'), { target: { value: '23:30' } });
  fireEvent.change(screen.getByLabelText('結束日期'), { target: { value: '2026-11-04' } });
  fireEvent.change(screen.getByLabelText('結束'), { target: { value: '01:00' } });
  expect(screen.getByText('補課時間與其他課程重疊，請核對；仍可儲存。')).toBeTruthy();
});
