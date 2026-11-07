import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
beforeEach(() => { mocks.read.mockReset(); mocks.run.mockReset(); mocks.available = true; mocks.run.mockResolvedValue(explanation); });

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
  fireEvent.change(screen.getByLabelText('用自己的話記下這一段'), { target: { value: '先用學號理解主鍵。' } });
  fireEvent.click(screen.getByRole('button', { name: '加入待複習' }));
  expect(screen.getByRole('region', { name: '待複習段落' })).toBeTruthy();
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

const questionLabel = '卡在哪裡？也可以直接開始講解';
const noteLabel = '用自己的話記下這一段';
const inputValue = (label: string) => (screen.getByLabelText(label) as HTMLTextAreaElement).value;
async function generate() {
  const button = screen.getByRole('button', { name: '啟用 AI 講解本段' });
  await waitFor(() => expect(button.hasAttribute('disabled')).toBe(false));
  fireEvent.click(button);
  await screen.findByRole('region', { name: '本段 AI 講解' });
}

it('retains notes, the question draft, lesson, attempt and answer when returning to a marked passage', async () => {
  render(<CourseStudyPanel courseTitle="資料庫" material={{ ...material, body: `${material.body.padEnd(1600, '甲')}乙` }} onClose={vi.fn()} />);
  await generate();
  fireEvent.change(screen.getByLabelText(noteLabel), { target: { value: '主鍵就像學號。\n同一份名冊不可重複。' } });
  fireEvent.change(screen.getByLabelText(questionLabel), { target: { value: '換一間學校也不能重複嗎？' } });
  fireEvent.change(screen.getByLabelText('先寫下你的想法'), { target: { value: '同一份資料表不能重複。' } });
  fireEvent.click(screen.getByRole('button', { name: '對照參考回答' }));
  fireEvent.click(screen.getByRole('button', { name: '加入待複習' }));
  fireEvent.click(screen.getByRole('button', { name: '下一段' }));
  expect(inputValue(noteLabel)).toBe('');
  expect(inputValue(questionLabel)).toBe('');
  expect(screen.queryByRole('region', { name: '本段 AI 講解' })).toBeNull();
  fireEvent.click(within(screen.getByRole('region', { name: '待複習段落' })).getByRole('button', { name: '教材原文 · 第 1 段' }));
  expect(inputValue(noteLabel)).toContain('主鍵就像學號。\n');
  expect(inputValue(questionLabel)).toBe('換一間學校也不能重複嗎？');
  expect(inputValue('先寫下你的想法')).toBe('同一份資料表不能重複。');
  expect(screen.getByText(explanation.answer)).toBeTruthy();
  expect(screen.getByRole('button', { name: '已加入待複習' }).getAttribute('aria-pressed')).toBe('true');
  expect(mocks.run).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: '已加入待複習' }));
  expect(screen.queryByRole('region', { name: '待複習段落' })).toBeNull();
});

it('keeps each reading mode independent while sharing the personal passage note', async () => {
  render(<CourseStudyPanel courseTitle="資料庫" material={material} onClose={vi.fn()} />);
  await generate();
  fireEvent.change(screen.getByLabelText(noteLabel), { target: { value: '這段要再確認。' } });
  fireEvent.change(screen.getByLabelText(questionLabel), { target: { value: '理解模式的未送出問題' } });
  fireEvent.change(screen.getByLabelText('先寫下你的想法'), { target: { value: '我原本的試答' } });
  fireEvent.change(screen.getByLabelText('這次怎麼讀'), { target: { value: 'exam' } });
  expect(inputValue(noteLabel)).toBe('這段要再確認。');
  expect(inputValue(questionLabel)).toBe('');
  expect(screen.queryByRole('region', { name: '本段 AI 講解' })).toBeNull();
  await generate();
  expect(mocks.run.mock.calls[1][0]).toEqual(expect.objectContaining({ mode: 'exam', history: undefined }));
  fireEvent.change(screen.getByLabelText(questionLabel), { target: { value: '考前模式的未送出問題' } });
  fireEvent.change(screen.getByLabelText('這次怎麼讀'), { target: { value: 'understand' } });
  expect(inputValue(questionLabel)).toBe('理解模式的未送出問題');
  expect(inputValue('先寫下你的想法')).toBe('我原本的試答');
  expect(mocks.run).toHaveBeenCalledTimes(2);
});

it('continues from the selected successful lesson and keeps older attempts separately', async () => {
  const next = { ...explanation, title: '換一個角度', question: '什麼是唯一？', answer: '在指定資料表裡沒有重複。' };
  mocks.run.mockResolvedValueOnce(explanation).mockResolvedValueOnce(next);
  render(<CourseStudyPanel courseTitle="資料庫" material={material} onClose={vi.fn()} />);
  await generate();
  fireEvent.change(screen.getByLabelText('先寫下你的想法'), { target: { value: '保留第一題的回答' } });
  fireEvent.click(screen.getByRole('button', { name: '對照參考回答' }));
  fireEvent.change(screen.getByLabelText(questionLabel), { target: { value: '你剛剛提到的名冊是什麼？' } });
  fireEvent.click(screen.getByRole('button', { name: '接著追問' }));
  await screen.findByRole('heading', { name: next.title });
  expect(mocks.run.mock.calls[1][0]).toEqual(expect.objectContaining({
    question: '你剛剛提到的名冊是什麼？',
    history: { passageId: 'text:part-1', sourceText: material.body, mode: 'understand', turns: [{ question: '', response: explanation }] },
  }));
  expect(inputValue(questionLabel)).toBe('');
  expect(inputValue('先寫下你的想法')).toBe('');
  expect(screen.queryByText(next.answer)).toBeNull();
  fireEvent.change(screen.getByLabelText('這一段的講解記錄'), { target: { value: '1' } });
  expect(inputValue('先寫下你的想法')).toBe('保留第一題的回答');
  expect(screen.getByText(explanation.answer)).toBeTruthy();
});

it('preserves a successful lesson and all drafts through a failed or cancelled follow-up', async () => {
  render(<CourseStudyPanel courseTitle="資料庫" material={material} onClose={vi.fn()} />);
  await generate();
  fireEvent.change(screen.getByLabelText(questionLabel), { target: { value: '可以再說一次嗎？' } });
  fireEvent.change(screen.getByLabelText('先寫下你的想法'), { target: { value: '我的原始試答' } });
  mocks.run.mockRejectedValueOnce(new Error('模型暫時忙碌'));
  fireEvent.click(screen.getByRole('button', { name: '接著追問' }));
  expect((await screen.findByRole('alert')).textContent).toContain('模型暫時忙碌');
  expect(screen.getByRole('region', { name: '本段 AI 講解' })).toBeTruthy();
  expect(inputValue(questionLabel)).toBe('可以再說一次嗎？');
  expect(inputValue('先寫下你的想法')).toBe('我的原始試答');
  let finish!: (value: TutorExplanation) => void;
  mocks.run.mockImplementationOnce(() => new Promise<TutorExplanation>((resolve) => { finish = resolve; }));
  fireEvent.click(screen.getByRole('button', { name: '接著追問' }));
  expect(screen.getByText(explanation.explanation)).toBeTruthy();
  fireEvent.change(screen.getByLabelText(noteLabel), { target: { value: '等候時仍能寫筆記' } });
  fireEvent.click(screen.getByRole('button', { name: '停止講解' }));
  expect(mocks.run.mock.calls[2][0].signal.aborted).toBe(true);
  await act(async () => finish({ ...explanation, title: '不應出現的遲到結果' }));
  expect(screen.queryByText('不應出現的遲到結果')).toBeNull();
  expect(inputValue(noteLabel)).toBe('等候時仍能寫筆記');
  expect(inputValue(questionLabel)).toBe('可以再說一次嗎？');
  expect(inputValue('先寫下你的想法')).toBe('我的原始試答');
});

it('follows the selected conversation branch without importing an unrelated later explanation', async () => {
  const answers = [1, 2, 3, 4].map((id) => ({ ...explanation, title: `講解 ${id}` }));
  answers.forEach((answer) => mocks.run.mockResolvedValueOnce(answer));
  render(<CourseStudyPanel courseTitle="資料庫" material={material} onClose={vi.fn()} />);
  await generate();
  fireEvent.click(screen.getByRole('button', { name: '接著追問' }));
  await screen.findByRole('heading', { name: '講解 2' });
  fireEvent.change(screen.getByLabelText('這一段的講解記錄'), { target: { value: '1' } });
  fireEvent.click(screen.getByRole('button', { name: '接著追問' }));
  await screen.findByRole('heading', { name: '講解 3' });
  expect(mocks.run.mock.calls[2][0].history.turns.map((turn: { response: TutorExplanation }) => turn.response.title)).toEqual(['講解 1']);
  fireEvent.click(screen.getByRole('button', { name: '接著追問' }));
  await screen.findByRole('heading', { name: '講解 4' });
  expect(mocks.run.mock.calls[3][0].history.turns.map((turn: { response: TutorExplanation }) => turn.response.title)).toEqual(['講解 1', '講解 3']);
});

it('starts from the original source without history on request and does not lose earlier lessons', async () => {
  render(<CourseStudyPanel courseTitle="資料庫" material={material} onClose={vi.fn()} />);
  await generate();
  fireEvent.click(screen.getByRole('button', { name: '只依原文重新講解' }));
  await waitFor(() => expect(inputValue('這一段的講解記錄')).toBe('2'));
  expect(mocks.run.mock.calls[1][0].history).toBeUndefined();
  fireEvent.click(screen.getByRole('button', { name: '接著追問' }));
  await waitFor(() => expect(inputValue('這一段的講解記錄')).toBe('3'));
  expect(mocks.run.mock.calls[2][0].history.turns).toHaveLength(1);
  expect(screen.getByRole('option', { name: '第 1 次：開始講解' })).toBeTruthy();
});

it('clears all study memory when another PDF has the same filename and page IDs', async () => {
  const document = (text: string) => ({ format: 'pdf', name: '筆記.pdf', warnings: [], sections: [
    { id: 'page-2', label: '第 2 頁', rows: [{ line: 1, cells: [text] }], needsOcr: false, warnings: [] },
  ] });
  mocks.read.mockResolvedValueOnce(document(material.body)).mockResolvedValueOnce(document('新的一份檔案，主題是交易。'));
  render(<CourseStudyPanel courseTitle="資料庫" onClose={vi.fn()} />);
  const upload = () => fireEvent.change(screen.getByLabelText('選擇講義'), { target: { files: [new File(['pdf'], '筆記.pdf')] } });
  upload();
  await screen.findByText(material.body);
  await generate();
  fireEvent.change(screen.getByLabelText(noteLabel), { target: { value: '舊教材的私有筆記' } });
  fireEvent.change(screen.getByLabelText(questionLabel), { target: { value: '舊教材的問題' } });
  fireEvent.click(screen.getByRole('button', { name: '加入待複習' }));
  upload();
  await screen.findByText('新的一份檔案，主題是交易。');
  expect(inputValue(noteLabel)).toBe('');
  expect(inputValue(questionLabel)).toBe('');
  expect(screen.queryByRole('region', { name: '待複習段落' })).toBeNull();
  expect(screen.queryByRole('region', { name: '本段 AI 講解' })).toBeNull();
  expect(screen.queryByLabelText('這一段的講解記錄')).toBeNull();
});

it('keeps the existing notes if replacing the source fails or is cancelled', async () => {
  render(<CourseStudyPanel courseTitle="資料庫" material={material} onClose={vi.fn()} />);
  await generate();
  fireEvent.change(screen.getByLabelText(noteLabel), { target: { value: '不要因為匯入失敗消失' } });
  mocks.read.mockRejectedValueOnce(new Error('檔案無法讀取'));
  const upload = () => fireEvent.change(screen.getByLabelText('選擇講義'), { target: { files: [new File(['pdf'], '新教材.pdf')] } });
  upload();
  await screen.findByText('檔案無法讀取');
  expect(inputValue(noteLabel)).toBe('不要因為匯入失敗消失');
  expect(screen.getByText(explanation.explanation)).toBeTruthy();
  mocks.read.mockImplementationOnce(() => new Promise(() => {}));
  upload();
  fireEvent.click(screen.getByRole('button', { name: '取消讀取' }));
  expect(inputValue(noteLabel)).toBe('不要因為匯入失敗消失');
});

it('does not restore study memory after the panel has been closed and reopened', async () => {
  const view = render(<CourseStudyPanel courseTitle="資料庫" material={material} onClose={vi.fn()} />);
  await generate();
  fireEvent.change(screen.getByLabelText(noteLabel), { target: { value: '只在這次開啟保留' } });
  fireEvent.click(screen.getByRole('button', { name: '加入待複習' }));
  view.unmount();
  render(<CourseStudyPanel courseTitle="資料庫" material={material} onClose={vi.fn()} />);
  expect(inputValue(noteLabel)).toBe('');
  expect(screen.queryByRole('region', { name: '本段 AI 講解' })).toBeNull();
  expect(screen.queryByRole('region', { name: '待複習段落' })).toBeNull();
});

it('bounds retained lessons to the six most recent successful results', async () => {
  for (let number = 1; number <= 7; number++) mocks.run.mockResolvedValueOnce({ ...explanation, title: `講解 ${number}` });
  render(<CourseStudyPanel courseTitle="資料庫" material={material} onClose={vi.fn()} />);
  await generate();
  for (let number = 2; number <= 7; number++) {
    fireEvent.click(screen.getByRole('button', { name: '接著追問' }));
    await screen.findByRole('heading', { name: `講解 ${number}` });
  }
  expect(within(screen.getByLabelText('這一段的講解記錄')).getAllByRole('option')).toHaveLength(6);
  expect(screen.queryByRole('option', { name: '第 1 次：開始講解' })).toBeNull();
  expect(screen.getByRole('option', { name: '第 2 次：開始講解' })).toBeTruthy();
});

it('ignores a cancelled follow-up even when its original passage has been reopened', async () => {
  render(<CourseStudyPanel courseTitle="資料庫" material={{ ...material, body: `${material.body.padEnd(1600, '甲')}乙` }} onClose={vi.fn()} />);
  await generate();
  let finish!: (value: TutorExplanation) => void;
  mocks.run.mockImplementationOnce(() => new Promise<TutorExplanation>((resolve) => { finish = resolve; }));
  fireEvent.change(screen.getByLabelText(questionLabel), { target: { value: '保留未完成的追問' } });
  fireEvent.click(screen.getByRole('button', { name: '接著追問' }));
  fireEvent.click(screen.getByRole('button', { name: '下一段' }));
  fireEvent.click(screen.getByRole('button', { name: '上一段' }));
  await act(async () => finish({ ...explanation, title: '遲到的追問結果' }));
  expect(screen.queryByText('遲到的追問結果')).toBeNull();
  expect(screen.getByRole('heading', { name: explanation.title })).toBeTruthy();
  expect(inputValue(questionLabel)).toBe('保留未完成的追問');
  expect(within(screen.getByLabelText('這一段的講解記錄')).getAllByRole('option')).toHaveLength(1);
});

it('explains when a long prior answer cannot fit in follow-up context and keeps it readable', async () => {
  mocks.run.mockResolvedValueOnce({ ...explanation, explanation: '長'.repeat(1800), answer: '答'.repeat(1000) });
  render(<CourseStudyPanel courseTitle="資料庫" material={material} onClose={vi.fn()} />);
  await generate();
  fireEvent.click(screen.getByRole('button', { name: '接著追問' }));
  await waitFor(() => expect(inputValue('這一段的講解記錄')).toBe('2'));
  expect(mocks.run.mock.calls[1][0].history).toBeUndefined();
  expect(screen.getByText(/先前講解較長，這次只依目前原文與問題整理/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText('這一段的講解記錄'), { target: { value: '1' } });
  expect(screen.getByText('長'.repeat(1800))).toBeTruthy();
});

it('downloads only after an explicit click, recovers from download failure, and clears the file URL on source replacement', async () => {
  const create = vi.fn().mockImplementationOnce(() => { throw new Error('unsupported'); }).mockReturnValue('blob:study-notes');
  const revoke = vi.fn();
  const OriginalURL = URL;
  vi.stubGlobal('URL', class extends OriginalURL { static createObjectURL = create; static revokeObjectURL = revoke; });
  const downloads: { href: string; filename: string }[] = [];
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    downloads.push({ href: this.href, filename: this.download });
  });
  const view = render(<CourseStudyPanel courseTitle="資料庫" material={material} onClose={vi.fn()} />);
  try {
    const download = screen.getByRole('button', { name: '下載本次筆記' });
    expect(download.hasAttribute('disabled')).toBe(true);
    fireEvent.change(screen.getByLabelText(noteLabel), { target: { value: '要留下的個人筆記' } });
    expect(create).not.toHaveBeenCalled();
    fireEvent.click(download);
    expect(screen.getByRole('alert').textContent).toContain('目前無法下載');
    expect(inputValue(noteLabel)).toBe('要留下的個人筆記');
    expect(downloads).toHaveLength(0);
    fireEvent.click(download);
    expect(downloads).toEqual([{ href: 'blob:study-notes', filename: '關聯式資料庫-學習筆記.txt' }]);
    const blob = create.mock.calls[1][0] as Blob;
    expect(blob.type).toBe('text/plain;charset=utf-8');
    const text = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = reject;
      reader.readAsText(blob);
    });
    expect(text).toContain('要留下的個人筆記');
    expect(text).toContain(material.body);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(document.querySelector('a[download]')).toBeNull();
    expect(revoke).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('或貼上課文與筆記'), { target: { value: '另一份教材' } });
    fireEvent.click(screen.getByRole('button', { name: '開始讀這份內容' }));
    expect(revoke).toHaveBeenCalledWith('blob:study-notes');
    expect(screen.getByRole('button', { name: '下載本次筆記' }).hasAttribute('disabled')).toBe(true);
  } finally {
    view.unmount();
    click.mockRestore();
    vi.unstubAllGlobals();
  }
});
