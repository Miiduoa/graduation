import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { DocumentSelection } from './DocumentSelection';
import type { PersonalImportDocument } from '@campus/shared';
const document: PersonalImportDocument = { name: '學期成績.xlsx', format: 'xlsx', warnings: [], sections: [
  { id: 'one', label: '第一學期', needsOcr: false, warnings: [], rows: [
    { line: 1, cells: ['學期成績單'] }, { line: 3, cells: ['課程名稱', '學分', '成績'] }, { line: 4, cells: ['資料庫', '3', '85'] },
  ] },
  { id: 'two', label: '第二學期', needsOcr: false, warnings: [], rows: [
    { line: 2, cells: ['課程名稱', '學分', '成績'] }, { line: 3, cells: ['英文', '2', '90'] },
  ] },
] };
it('requires a valid selected header and combines only explicitly selected sections', () => {
  const confirm = vi.fn();
  render(<DocumentSelection document={document} options={{ kind: 'grades', schoolId: 'pu', academicYear: '115', semester: '1' }} onConfirm={confirm} onCancel={() => {}} />);
  fireEvent.click(screen.getByText('整理選取內容'));
  expect(confirm).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('「第一學期」的標題列'), { target: { value: '3' } });
  fireEvent.click(screen.getByLabelText('第二學期 · 2 列'));
  fireEvent.click(screen.getByText('整理選取內容'));
  expect(confirm.mock.calls[0][0].map((row: { title: string }) => row.title)).toEqual(['資料庫', '英文']);
  expect(confirm.mock.calls[0][0][0].source.line).toBe(4);
});
it('does not import or save when cancelling a document', () => {
  const confirm = vi.fn(), cancel = vi.fn();
  render(<DocumentSelection document={document} options={{ kind: 'grades', schoolId: 'pu' }} onConfirm={confirm} onCancel={cancel} />);
  fireEvent.click(screen.getByText('取消這份文件'));
  expect(cancel).toHaveBeenCalledOnce(); expect(confirm).not.toHaveBeenCalled();
});
