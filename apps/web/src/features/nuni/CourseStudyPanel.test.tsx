import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { TutorExplanation } from '@/lib/studyTutor';
import { CourseStudyPanel } from './CourseStudyPanel';

const mocks = vi.hoisted(() => ({ run: vi.fn(), read: vi.fn(), available: true }));
vi.mock('@/lib/studyTutorRuntime', () => ({
  getStudyTutorAvailability: () => ({ available: mocks.available, downloadLabel: '約 1.9 GB，建議使用 Wi-Fi', reason: mocks.available ? undefined : '裝置尚未支援 AI 講解。' }),
  runStudyTutor: mocks.run,
}));
vi.mock('@/lib/personalImportDocuments', () => ({ readPersonalImportDocumentFile: mocks.read }));

const material = { id: 'material-1', title: '關聯式資料庫', body: '主鍵用來唯一識別一筆資料，不能重複或為空值。' };
const explanation: TutorExplanation = {
  title: '辨認一筆資料', explanation: '把主鍵想成每位學生的學號，同一份名冊裡不能重複。',
  sourceQuote: '主鍵用來唯一識別一筆資料', question: '兩位學生可以使用同一個主鍵嗎？為什麼？',
  answer: '不可以，否則無法唯一識別一筆資料。',
};
beforeEach(() => { vi.clearAllMocks(); mocks.available = true; mocks.run.mockResolvedValue(explanation); });

it('shows the authorized material without downloading or generating until requested', async () => {
  render(<CourseStudyPanel courseTitle="資料庫" material={material} onClose={vi.fn()} />);
  expect(screen.getByText(material.body)).toBeTruthy();
  expect(screen.getByText(/附件與外部連結的內容需另外選擇/)).toBeTruthy();
  expect(mocks.run).not.toHaveBeenCalled();
  expect(mocks.read).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(screen.getByRole('heading', { name: '讀書白板' }));
  fireEvent.click(screen.getByRole('button', { name: '啟用 AI 講解本段' }));
  expect(await screen.findByRole('region', { name: '本段 AI 講解' })).toBeTruthy();
  expect(mocks.run).toHaveBeenCalledWith(expect.objectContaining({
    mode: 'understand', passage: expect.objectContaining({ text: material.body }),
  }));
  expect(screen.queryByText(explanation.answer)).toBeNull();
  const compare = screen.getByRole('button', { name: '對照參考回答' });
  expect(compare.hasAttribute('disabled')).toBe(true);
  fireEvent.change(screen.getByLabelText('先寫下你的想法'), { target: { value: '不可以，學號應該不同。' } });
  fireEvent.click(compare);
  expect(screen.getByText(explanation.answer)).toBeTruthy();
  expect(screen.getByText(/不會自動評分/)).toBeTruthy();
});

it('keeps reading available when the browser cannot run a model', () => {
  mocks.available = false;
  render(<CourseStudyPanel courseTitle="資料庫" material={material} onClose={vi.fn()} />);
  expect(screen.getByText(material.body)).toBeTruthy();
  expect(screen.getByRole('button', { name: '啟用 AI 講解本段' }).hasAttribute('disabled')).toBe(true);
  expect(mocks.run).not.toHaveBeenCalled();
});

it('aborts a previous passage and ignores a late model response after navigation', async () => {
  let finish!: (value: TutorExplanation) => void;
  mocks.run.mockImplementation(() => new Promise<TutorExplanation>((resolve) => { finish = resolve; }));
  render(<CourseStudyPanel courseTitle="資料庫" material={{ ...material, body: `${'甲'.repeat(1600)}乙` }} onClose={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: '啟用 AI 講解本段' }));
  const signal = mocks.run.mock.calls[0][0].signal as AbortSignal;
  fireEvent.click(screen.getByRole('button', { name: '下一段' }));
  expect(signal.aborted).toBe(true);
  await act(async () => finish(explanation));
  expect(screen.queryByRole('region', { name: '本段 AI 講解' })).toBeNull();
  expect(screen.getByText('乙')).toBeTruthy();
});

it('requests cancellation on stop, mode change, and unmount', () => {
  mocks.run.mockImplementation(() => new Promise(() => {}));
  const view = render(<CourseStudyPanel courseTitle="資料庫" material={material} onClose={vi.fn()} />);
  const start = () => fireEvent.click(screen.getByRole('button', { name: '啟用 AI 講解本段' }));
  start();
  const first = mocks.run.mock.calls[0][0].signal as AbortSignal;
  fireEvent.click(screen.getByRole('button', { name: '停止講解' }));
  expect(first.aborted).toBe(true);
  start();
  const second = mocks.run.mock.calls[1][0].signal as AbortSignal;
  fireEvent.change(screen.getByLabelText('這次怎麼讀'), { target: { value: 'exam' } });
  expect(second.aborted).toBe(true);
  start();
  expect(mocks.run.mock.calls[2][0].mode).toBe('exam');
  const third = mocks.run.mock.calls[2][0].signal as AbortSignal;
  view.unmount();
  expect(third.aborted).toBe(true);
});

it('preserves PDF page labels and reports unreadable pages instead of inventing their content', async () => {
  mocks.read.mockResolvedValue({ format: 'pdf', name: '複習.pdf', warnings: [], sections: [
    { id: 'page-1', label: '第 1 頁', rows: [], needsOcr: true, warnings: [] },
    { id: 'page-2', label: '第 2 頁', rows: [{ line: 1, cells: ['交易要符合 ACID。'] }], needsOcr: false, warnings: [] },
  ] });
  render(<CourseStudyPanel courseTitle="資料庫" onClose={vi.fn()} />);
  fireEvent.change(screen.getByLabelText('選擇講義'), { target: { files: [new File(['pdf'], '複習.pdf', { type: 'application/pdf' })] } });
  expect(await screen.findByText('交易要符合 ACID。')).toBeTruthy();
  expect(screen.getByRole('option', { name: '第 2 頁' })).toBeTruthy();
  expect(screen.queryByRole('option', { name: '第 1 頁' })).toBeNull();
  fireEvent.click(screen.getByText(/來源注意事項/));
  expect(screen.getAllByText(/第 1 頁/).length).toBeGreaterThan(0);
  expect(mocks.run).not.toHaveBeenCalled();
});

it('ignores a cancelled file read and does not leak its content into a later selection', async () => {
  let finish!: (value: unknown) => void;
  mocks.read.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  render(<CourseStudyPanel courseTitle="資料庫" onClose={vi.fn()} />);
  fireEvent.change(screen.getByLabelText('選擇講義'), { target: { files: [new File(['pdf'], '舊講義.pdf')] } });
  const signal = mocks.read.mock.calls[0][1] as AbortSignal;
  fireEvent.click(screen.getByRole('button', { name: '取消讀取' }));
  expect(signal.aborted).toBe(true);
  fireEvent.change(screen.getByLabelText('或貼上課文與筆記'), { target: { value: '新的課程內容。' } });
  fireEvent.click(screen.getByRole('button', { name: '開始讀這份內容' }));
  await act(async () => finish({ format: 'pdf', name: '舊講義.pdf', warnings: [], sections: [
    { id: 'page-1', label: '第 1 頁', rows: [{ line: 1, cells: ['舊課程內容'] }], needsOcr: false, warnings: [] },
  ] }));
  expect(screen.getByText('新的課程內容。')).toBeTruthy();
  expect(screen.queryByText('舊課程內容')).toBeNull();
});

it('renders source and generated text without executing HTML or treating URLs as file contents', async () => {
  render(<CourseStudyPanel courseTitle="資料庫" material={{ ...material, body: '<img src=x onerror=alert(1)> https://example.test/private.pdf' }} onClose={vi.fn()} />);
  expect(document.querySelector('img')).toBeNull();
  expect(mocks.read).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '啟用 AI 講解本段' }));
  await waitFor(() => expect(mocks.run).toHaveBeenCalledTimes(1));
});

it('keeps an oversized paste intact and asks for a smaller section instead of silently truncating it', () => {
  render(<CourseStudyPanel courseTitle="資料庫" onClose={vi.fn()} />);
  const text = '字'.repeat(60001);
  fireEvent.change(screen.getByLabelText('或貼上課文與筆記'), { target: { value: text } });
  expect((screen.getByLabelText('或貼上課文與筆記') as HTMLTextAreaElement).value).toBe(text);
  expect(screen.getByRole('button', { name: '開始讀這份內容' }).hasAttribute('disabled')).toBe(true);
  expect(screen.getByText(/內容尚未加入白板/)).toBeTruthy();
});
