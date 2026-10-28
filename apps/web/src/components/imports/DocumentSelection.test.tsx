import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { DocumentSelection } from './DocumentSelection';
import type { PersonalImportDocument } from '@campus/shared';

const options = { kind: 'grades' as const, schoolId: 'pu', academicYear: '115', semester: '1' };
const document: PersonalImportDocument = {
  name: '學期成績.xlsx', format: 'xlsx', warnings: [], sections: [
    { id: 'one', label: '第一學期', needsOcr: false, warnings: [], rows: [
      { line: 1, cells: ['學期成績單'] },
      { line: 3, cells: ['課程名稱', '學分', '成績'] },
      { line: 4, cells: ['資料庫', '3', '85'] },
    ] },
    { id: 'two', label: '第二學期', needsOcr: false, warnings: [], rows: [
      { line: 2, cells: ['課程名稱', '學分', '成績'] },
      { line: 3, cells: ['英文', '2', '90'] },
    ] },
  ],
};
const noop = () => {};

it('suggests the real header, previews without confirming, and combines explicitly selected sections', () => {
  const confirm = vi.fn();
  render(<DocumentSelection document={document} options={options} onConfirm={confirm} onCancel={noop} />);
  expect((screen.getByLabelText('「第一學期」的標題列') as HTMLSelectElement).value).toBe('3');
  expect(screen.getByText('可整理 1 筆 · 0 筆待修正')).toBeTruthy();
  expect(screen.getByText('標題前有 1 列不會匯入，展開核對')).toBeTruthy();
  expect(within(screen.getByLabelText('第一學期 整理結果預覽')).getByText('資料庫')).toBeTruthy();
  expect(confirm).not.toHaveBeenCalled();
  fireEvent.click(screen.getByLabelText('第二學期 · 2 列'));
  fireEvent.click(screen.getByRole('button', { name: '整理選取內容' }));
  expect(confirm.mock.calls[0][0].map((row: { title: string }) => row.title)).toEqual(['資料庫', '英文']);
  expect(confirm.mock.calls[0][0][0].source.line).toBe(4);
});

it('does not import or save when cancelling a document', () => {
  const confirm = vi.fn(), cancel = vi.fn();
  render(<DocumentSelection document={document} options={options} onConfirm={confirm} onCancel={cancel} />);
  fireEvent.click(screen.getByText('取消這份文件'));
  expect(cancel).toHaveBeenCalledOnce();
  expect(confirm).not.toHaveBeenCalled();
});

it('offers AI for manually chosen ranges without requiring recognizable column headers', () => {
  const confirm = vi.fn(), ai = vi.fn();
  render(<DocumentSelection document={document} options={options}
    initialSelection={{ selected: ['one'], headers: { one: 1, two: 2 } }}
    onConfirm={confirm} onCancel={noop} onAi={ai} aiNote="免費在裝置上整理，首次下載約 1.9 GB。" />);
  expect(screen.getByRole('button', { name: '整理選取內容' }).hasAttribute('disabled')).toBe(true);
  expect(ai).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('checkbox', { name: '第二學期 · 2 列' }));
  fireEvent.change(screen.getByLabelText('「第二學期」的標題列'), { target: { value: '3' } });
  fireEvent.click(screen.getByRole('button', { name: '用 AI 整理選取內容' }));
  expect(ai).toHaveBeenCalledWith({ selected: ['one', 'two'], headers: { one: 1, two: 3 } });
  expect(confirm).not.toHaveBeenCalled();
});

it('explains unavailable AI and keeps ordinary document review available', () => {
  const ai = vi.fn(), confirm = vi.fn();
  render(<DocumentSelection document={document} options={options}
    initialSelection={{ selected: ['one'], headers: { one: 3, two: 2 } }}
    onConfirm={confirm} onCancel={noop} onAi={ai} aiDisabled aiNote="這個瀏覽器不支援 WebGPU。" />);
  const action = screen.getByRole('button', { name: '用 AI 整理選取內容' });
  expect(action.hasAttribute('disabled')).toBe(true);
  expect(globalThis.document.getElementById(action.getAttribute('aria-describedby') || '')).toBe(screen.getByText('這個瀏覽器不支援 WebGPU。'));
  fireEvent.click(action);
  expect(ai).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '整理選取內容' }));
  expect(confirm).toHaveBeenCalledOnce();
});

it('does not overwrite a restored manual header until the suggestion is explicitly applied', () => {
  const change = vi.fn();
  render(<DocumentSelection document={document} options={options}
    initialSelection={{ selected: ['one'], headers: { one: 1, two: 2 } }}
    onSelectionChange={change} onConfirm={noop} onCancel={noop} />);
  expect((screen.getByLabelText('「第一學期」的標題列') as HTMLSelectElement).value).toBe('1');
  expect(change).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '使用建議：第 3 列' }));
  expect(change).toHaveBeenCalledWith({ selected: ['one'], headers: { one: 3, two: 2 } });
  expect(screen.getByText('可整理 1 筆 · 0 筆待修正')).toBeTruthy();
});

it('preserves an explicitly empty selection, supports bulk selection and never auto-confirms', () => {
  const confirm = vi.fn(), change = vi.fn();
  render(<DocumentSelection document={document} options={options}
    initialSelection={{ selected: [], headers: {} }} onSelectionChange={change} onConfirm={confirm} onCancel={noop} />);
  expect(screen.getByRole('button', { name: '整理選取內容' }).hasAttribute('disabled')).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '全選可讀取內容' }));
  expect(screen.getByText('可整理 2 筆 · 0 筆待修正')).toBeTruthy();
  expect(confirm).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '取消全選' }));
  expect(screen.getByRole('button', { name: '整理選取內容' }).hasAttribute('disabled')).toBe(true);
  expect(change.mock.calls.at(-1)?.[0].selected).toEqual([]);
});

it('excludes unreadable and empty sections from bulk selection', () => {
  const change = vi.fn();
  const input: PersonalImportDocument = { ...document, sections: [...document.sections,
    { id: 'scan', label: '掃描頁', needsOcr: true, warnings: [], rows: [] },
    { id: 'empty', label: '空白頁', needsOcr: false, warnings: [], rows: [] },
  ] };
  render(<DocumentSelection document={input} options={options} onSelectionChange={change} onConfirm={noop} onCancel={noop} />);
  fireEvent.click(screen.getByText('全選可讀取內容'));
  expect(change.mock.calls[0][0].selected).toEqual(['one', 'two']);
  expect(screen.getByRole('checkbox', { name: '掃描頁 · 0 列' }).hasAttribute('disabled')).toBe(true);
  expect(screen.getByRole('checkbox', { name: '空白頁 · 0 列' }).hasAttribute('disabled')).toBe(true);
});

it('keeps invalid fields editable while accurately showing the affected record count', () => {
  const confirm = vi.fn();
  const input = { ...document, sections: [{ ...document.sections[0], rows: [
    document.sections[0].rows[1], { line: 8, cells: ['資料庫', '不確定', ''] },
  ] }] };
  render(<DocumentSelection document={input} options={options} onConfirm={confirm} onCancel={noop} />);
  expect(screen.getByText('可整理 1 筆 · 1 筆待修正')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '整理選取內容' }));
  expect(confirm.mock.calls[0][0][0].credits).toBeUndefined();
  expect(confirm.mock.calls[0][1].some((issue: { severity: string }) => issue.severity === 'error')).toBe(true);
});

it('blocks partial confirmation and offers the still-available AI path when a selected sheet cannot parse', () => {
  const confirm = vi.fn(), ai = vi.fn();
  const input = { ...document, sections: [document.sections[0], { ...document.sections[1], rows: [
    { line: 1, cells: ['說明文字'] }, { line: 2, cells: ['沒有標題'] },
  ] }] };
  render(<DocumentSelection document={input} options={options} onConfirm={confirm} onCancel={noop} onAi={ai} />);
  fireEvent.click(screen.getByText('全選可讀取內容'));
  const action = screen.getByRole('button', { name: '整理選取內容' });
  expect(action.hasAttribute('disabled')).toBe(true);
  fireEvent.click(action);
  expect(confirm).not.toHaveBeenCalled();
  expect(screen.getByText(/不會只讀入其餘部分/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '用 AI 整理選取內容' }));
  expect(ai).toHaveBeenCalledOnce();
});

it('recomputes the preview for current campus options, not the original render options', () => {
  const confirm = vi.fn();
  const view = render(<DocumentSelection document={document} options={options} onConfirm={confirm} onCancel={noop} />);
  view.rerender(<DocumentSelection document={document} options={{ ...options, schoolId: 'ncku' }} onConfirm={confirm} onCancel={noop} />);
  fireEvent.click(screen.getByRole('button', { name: '整理選取內容' }));
  expect(confirm.mock.calls[0][0][0].schoolId).toBe('ncku');
});

it('preserves original document ordering after checkbox re-selection', () => {
  const confirm = vi.fn();
  render(<DocumentSelection document={document} options={options} onConfirm={confirm} onCancel={noop} />);
  fireEvent.click(screen.getByLabelText('第一學期 · 3 列'));
  fireEvent.click(screen.getByLabelText('第二學期 · 2 列'));
  fireEvent.click(screen.getByLabelText('第一學期 · 3 列'));
  fireEvent.click(screen.getByRole('button', { name: '整理選取內容' }));
  expect(confirm.mock.calls[0][0].map((row: { title: string }) => row.title)).toEqual(['資料庫', '英文']);
});

it('labels unmapped columns and renders hostile-looking cell text without executing markup', () => {
  const input = { ...document, sections: [{ ...document.sections[0], rows: [
    { line: 3, cells: ['課名', '學分', '成績', '備註'] },
    { line: 4, cells: ['<img src=x onerror=alert(1)>', '3', '85', '保留文字'] },
  ] }] };
  render(<DocumentSelection document={input} options={options} onConfirm={noop} onCancel={noop} />);
  expect(screen.getByText('未對應 · 原文保留')).toBeTruthy();
  expect(screen.queryByRole('img')).toBeNull();
  expect(screen.getAllByText('<img src=x onerror=alert(1)>').length).toBeGreaterThan(0);
});
