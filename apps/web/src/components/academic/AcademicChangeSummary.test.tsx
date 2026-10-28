import { StrictMode } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import type { AcademicRecordState } from '@/lib/useAcademicRecords';
import { AcademicChangeSummary } from './AcademicChangeSummary';

function ready(score: number | string, minute = 0, owner = 'one'): AcademicRecordState<'grades'> {
  return {
    scope: JSON.stringify([owner, 'grades', true, 'pu']), status: 'ready',
    snapshot: {
      ownerUid: owner, schoolId: 'pu', fetchedAt: new Date(Date.UTC(2026, 9, 27, 0, minute)).toISOString(),
      records: {
        grades: [{ id: `grade:${score}`, semester: '1151', courseName: '統計學', courseNameEn: '',
          class: '三B', courseType: '必修', credits: 3, score }],
        semesters: ['1151'], allSemesters: ['1151'], summary: {},
      },
    },
  };
}
afterEach(cleanup);
const panel = (state: AcademicRecordState<'grades'> | null) => <AcademicChangeSummary kind="grades" state={state} />;

it('shows a baseline, then the actual score change with both values', () => {
  const view = render(panel(ready('尚未公布')));
  expect(screen.getByText(/已建立本次檢視的比對基準/)).toBeTruthy();
  view.rerender(panel(ready(88, 5)));
  const region = within(screen.getByRole('region', { name: '校務更新差異' }));
  expect(region.getByText('新增 0 組 · 變更 1 組 · 待核對 0 組')).toBeTruthy();
  expect(region.getByText('尚未公布')).toBeTruthy();
  expect(region.getByText('統計學')).toBeTruthy();
});
it('masks the previous change immediately on account switch', () => {
  const view = render(panel(ready(70)));
  view.rerender(panel(ready(80, 5)));
  expect(screen.getByText('70')).toBeTruthy();
  view.rerender(panel(ready(95, 10, 'two')));
  expect(screen.queryByText('70')).toBeNull();
  expect(screen.queryByText('統計學')).toBeNull();
  expect(screen.getByText(/已建立本次檢視的比對基準/)).toBeTruthy();
});
it('does not treat a transient failed read as an empty response or a successful baseline', () => {
  const first = ready(70);
  const view = render(panel(first));
  view.rerender(panel({ scope: first.scope, status: 'error', reason: 'unavailable', snapshot: first.snapshot, stale: true }));
  expect(screen.queryByRole('region', { name: '校務更新差異' })).toBeNull();
  view.rerender(panel(ready(80, 10)));
  expect(screen.getByText('70')).toBeTruthy();
  expect(screen.getByText('新增 0 組 · 變更 1 組 · 待核對 0 組')).toBeTruthy();
});
it('forgets the baseline after permission is lost', () => {
  const first = ready(70);
  const view = render(panel(first));
  view.rerender(panel({ scope: first.scope, status: 'error', reason: 'permission' }));
  view.rerender(panel(ready(80, 10)));
  expect(screen.queryByText('70')).toBeNull();
  expect(screen.getByText(/已建立本次檢視的比對基準/)).toBeTruthy();
});
it('does not turn StrictMode effect replay into a stale-source warning', () => {
  render(<StrictMode>{panel(ready(70))}</StrictMode>);
  expect(screen.getByText(/已建立本次檢視的比對基準/)).toBeTruthy();
  expect(screen.queryByText(/來源時間未前進/)).toBeNull();
});
it('hides old differences during refresh and while auth scope is unresolved', () => {
  const first = ready(70), second = ready(80, 5);
  const view = render(panel(first));
  view.rerender(panel(second));
  expect(screen.getByText('統計學')).toBeTruthy();
  view.rerender(panel({ ...second, refreshing: true }));
  expect(screen.queryByRole('region', { name: '校務更新差異' })).toBeNull();
  view.rerender(panel(null));
  view.rerender(panel(ready(90, 10)));
  expect(screen.queryByText('70')).toBeNull();
  expect(screen.getByText(/已建立本次檢視的比對基準/)).toBeTruthy();
});
it('retains the last nonempty successful baseline after an empty reply', () => {
  const first = ready(70), empty = ready(80, 5);
  empty.snapshot!.records.grades = [];
  const view = render(panel(first));
  view.rerender(panel(empty));
  expect(screen.getByText(/來源回傳空清單/)).toBeTruthy();
  view.rerender(panel(ready(90, 10)));
  expect(screen.getByText('70')).toBeTruthy();
});
it('keeps every difference available without rendering a huge list at once', () => {
  const first = ready(70), next = ready(80, 5);
  next.snapshot!.records.grades.push(...Array.from({ length: 12 }, (_, index) => ({
    ...next.snapshot!.records.grades[0], id: `new:${index}`, courseName: `新科目${index}`,
  })));
  const view = render(panel(first));
  view.rerender(panel(next));
  const region = within(screen.getByRole('region', { name: '校務更新差異' }));
  expect(region.getAllByRole('listitem')).toHaveLength(8);
  fireEvent.click(region.getByRole('button', { name: /顯示更多差異/ }));
  expect(region.getAllByRole('listitem')).toHaveLength(13);
});


it('keeps the last valid baseline when an older response arrives', () => {
  const view = render(panel(ready(70, 5)));
  view.rerender(panel(ready(99, 0)));
  expect(screen.getByText(/來源時間未前進/)).toBeTruthy();
  expect(screen.queryByText('99')).toBeNull();
  view.rerender(panel(ready(80, 10)));
  expect(screen.getByText('70')).toBeTruthy();
  expect(screen.queryByText('99')).toBeNull();
});

it('clears the old change when the next successful read has no differences', () => {
  const view = render(panel(ready(70)));
  view.rerender(panel(ready(80, 5)));
  expect(screen.getByText('70')).toBeTruthy();
  view.rerender(panel(ready(80, 10)));
  expect(screen.getByText(/沒有課程欄位變更/)).toBeTruthy();
  expect(screen.queryByText('70')).toBeNull();
});

it.each(['reconnect', 'unconfigured'] as const)('forgets private comparison data after %s', (reason) => {
  const first = ready(70);
  const view = render(panel(first));
  view.rerender(panel({ scope: first.scope, status: 'error', reason }));
  view.rerender(panel(ready(80, 10)));
  expect(screen.queryByText('70')).toBeNull();
  expect(screen.getByText(/已建立本次檢視的比對基準/)).toBeTruthy();
});
