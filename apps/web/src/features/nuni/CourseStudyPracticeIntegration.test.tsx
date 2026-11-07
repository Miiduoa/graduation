import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { studySourceFromDocument, type TutorExplanation } from '@/lib/studyTutor';
import { CourseStudyPanel } from './CourseStudyPanel';
import { parseCourseStudyProgress, serializeCourseStudyProgress, type CourseStudyProgressData } from './courseStudyProgress';
import { appendStudyLesson, emptyStudyPassage, updateStudyMode } from './courseStudySession';

const mocks = vi.hoisted(() => ({ run: vi.fn(), read: vi.fn(), available: false }));
vi.mock('@/lib/studyTutorRuntime', () => ({
  getStudyTutorAvailability: () => ({ available: mocks.available, downloadLabel: '約 1.9 GB', reason: '這台裝置沒有啟用 AI。' }),
  runStudyTutor: mocks.run,
}));
vi.mock('@/lib/personalImportDocuments', () => ({ readPersonalImportDocumentFile: mocks.read }));

const scope = {
  platformAccountId: 'pa_11111111-1111-4111-8111-111111111111',
  workspaceId: 'cw_11111111-1111-4111-8111-111111111111',
};
const keyText = '主鍵用來唯一識別資料，不能重複。';
const transactionText = '交易失敗時必須復原全部操作。';
const first: TutorExplanation = {
  title: '原本的主鍵講解', explanation: '同一資料表的主鍵值不能重複。', sourceQuote: '主鍵用來唯一識別資料',
  question: '主鍵可以重複嗎？', answer: '主鍵參考回答：不可以，必須唯一。',
};
const second: TutorExplanation = {
  title: '原本的交易講解', explanation: '同一筆交易的操作需要一起完成。', sourceQuote: '交易失敗時必須復原全部操作',
  question: '交易失敗時如何處理？', answer: '交易參考回答：復原全部操作。',
};

function savedPractice(): CourseStudyProgressData {
  const source = studySourceFromDocument({ format: 'pdf', name: '資料庫.pdf', warnings: [], sections: [
    { id: 'page-2', label: '第 2 頁', rows: [{ line: 1, cells: [keyText] }], needsOcr: false, warnings: [] },
    { id: 'page-5', label: '第 5 頁', rows: [{ line: 1, cells: [transactionText] }], needsOcr: false, warnings: [] },
    { id: 'page-9', label: '第 9 頁', rows: [{ line: 1, cells: ['索引可以加快查詢。'] }], needsOcr: false, warnings: [] },
  ] });
  let keys = appendStudyLesson(emptyStudyPassage(), 'understand', { question: '', response: first });
  keys = appendStudyLesson(keys, 'understand', { question: '較新的另一個問題', response: { ...first, question: '較新分支的題目' } }, 1);
  keys = updateStudyMode(keys, 'understand', (memory) => ({ ...memory, selectedLessonId: 1, question: '還沒有送出的草稿',
    lessons: memory.lessons.map((lesson) => lesson.id === 1 ? { ...lesson, attempt: '原本的主鍵試答', answerVisible: true } : lesson),
  }));
  keys = appendStudyLesson(keys, 'exam', { question: '', response: { ...first, question: '考前模式的另一題' } });
  keys.note = '原本的主鍵筆記';
  keys.needsReview = true;
  const transaction = appendStudyLesson(emptyStudyPassage(), 'understand', { question: '', response: second });
  transaction.note = '原本的交易筆記';
  transaction.needsReview = true;
  return {
    scope, source, position: { sectionIndex: 0, passageIndex: 0, mode: 'understand' },
    passages: { '0:0': keys, '1:0': transaction, '2:0': { ...emptyStudyPassage(), needsReview: true } },
  };
}

async function restore(data = savedPractice()) {
  const text = serializeCourseStudyProgress(data);
  const file = new File([text], '複習.campus-study.json', { type: 'application/json' });
  Object.defineProperty(file, 'text', { value: async () => text });
  fireEvent.change(screen.getByLabelText('載入閱讀進度檔'), { target: { files: [file] } });
  await screen.findByRole('region', { name: '閱讀進度預覽' });
  fireEvent.click(screen.getByRole('button', { name: '還原這份進度' }));
  await screen.findByRole('heading', { name: first.title });
}

function mount() {
  return render(<CourseStudyPanel scope={scope} courseTitle="資料庫" onClose={vi.fn()} />);
}

function begin() { fireEvent.click(screen.getByRole('button', { name: '開始逐題複習' })); }
const value = (label: string) => (screen.getByLabelText(label) as HTMLInputElement).value;
const practiceLabel = '這一題，我的回答';

function downloadMock(create = vi.fn().mockReturnValue('blob:practice')) {
  const revoke = vi.fn();
  const OriginalURL = URL;
  vi.stubGlobal('URL', class extends OriginalURL { static createObjectURL = create; static revokeObjectURL = revoke; });
  const filenames: string[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { filenames.push(this.download); });
  return { create, revoke, filenames };
}

function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsText(blob);
  });
}

beforeEach(() => { mocks.run.mockReset(); mocks.read.mockReset(); mocks.available = false; });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('uses the selected lesson and reading mode, reports missing questions, and returns to the exact PDF source', async () => {
  mount();
  await restore();
  expect(screen.getByText('目前讀法有 2 題可練習')).toBeTruthy();
  expect(screen.getByText(/另有 1 段在目前讀法還沒有自我檢查題/)).toBeTruthy();
  begin();
  expect(screen.getByText(first.question)).toBeTruthy();
  expect(screen.queryByText('較新分支的題目')).toBeNull();
  expect(screen.queryByText('考前模式的另一題')).toBeNull();
  expect(value(practiceLabel)).toBe('');
  expect(screen.queryByText(first.answer)).toBeNull();
  expect(screen.queryByRole('button', { name: '儲存閱讀進度' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '略過這題' }));
  expect(screen.getByText(second.question)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '回白板看這段' }));
  expect(screen.queryByLabelText(practiceLabel)).toBeNull();
  expect(value('閱讀範圍')).toBe('1');
  expect(value('用自己的話記下這一段')).toBe('原本的交易筆記');
  expect(document.querySelector('mark')?.parentElement?.textContent).toBe(transactionText);
  fireEvent.change(screen.getByLabelText('閱讀範圍'), { target: { value: '0' } });
  expect(value('先寫下你的想法')).toBe('原本的主鍵試答');
  expect(screen.getByText(first.answer)).toBeTruthy();
  fireEvent.change(screen.getByLabelText('這次怎麼讀'), { target: { value: 'exam' } });
  expect(screen.getByText('目前讀法有 1 題可練習')).toBeTruthy();
  begin();
  expect(screen.getByText('考前模式的另一題')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '回到閱讀' }));
  fireEvent.change(screen.getByLabelText('這次怎麼讀'), { target: { value: 'practice' } });
  expect(screen.getByRole('button', { name: '開始逐題複習' }).hasAttribute('disabled')).toBe(true);
  expect(mocks.run).not.toHaveBeenCalled();
  expect(mocks.read).not.toHaveBeenCalled();
});

it('keeps all original attempts, answers, branches and review markers unchanged after a finished round', async () => {
  const downloads = downloadMock();
  const original = savedPractice();
  mount();
  await restore(original);
  begin();
  fireEvent.change(screen.getByLabelText(practiceLabel), { target: { value: '這輪獨立的主鍵回答' } });
  fireEvent.click(screen.getByRole('button', { name: '對照參考回答' }));
  fireEvent.click(screen.getByRole('button', { name: '這題已理解' }));
  fireEvent.click(screen.getByRole('button', { name: '略過這題' }));
  expect(screen.getByRole('heading', { name: '本輪練習摘要' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '回到閱讀' }));
  fireEvent.click(screen.getByRole('button', { name: '儲存閱讀進度' }));
  const raw = await readBlob(downloads.create.mock.calls[0][0] as Blob);
  expect(JSON.parse(raw).version).toBe(2);
  expect(parseCourseStudyProgress(raw, scope).passages).toEqual(original.passages);
  expect(raw).not.toContain('這輪獨立的主鍵回答');
  expect(screen.getByRole('heading', { name: '待複習 · 3 段' })).toBeTruthy();
  expect(mocks.run).not.toHaveBeenCalled();
});

it('downloads only this round with its own answer gate and keeps the round through a download failure', async () => {
  const create = vi.fn().mockImplementationOnce(() => { throw new Error('download unavailable'); })
    .mockReturnValueOnce('blob:practice-hidden').mockReturnValueOnce('blob:practice-revealed');
  const downloads = downloadMock(create);
  const view = mount();
  await restore();
  begin();
  expect(create).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText(practiceLabel), { target: { value: '本輪試答 😀\n保留換行' } });
  fireEvent.click(screen.getByRole('button', { name: '下載本輪練習' }));
  expect(screen.getByRole('alert').textContent).toContain('目前無法下載');
  expect(value(practiceLabel)).toBe('本輪試答 😀\n保留換行');
  fireEvent.click(screen.getByRole('button', { name: '下載本輪練習' }));
  const hidden = await readBlob(create.mock.calls[1][0] as Blob);
  expect(hidden).toContain('本輪試答 😀\n保留換行');
  expect(hidden).not.toContain(first.answer);
  expect(hidden).not.toContain(second.answer);
  expect(hidden).not.toContain('原本的主鍵試答');
  expect(downloads.filenames[0]).toMatch(/-逐題複習\.txt$/);
  fireEvent.click(screen.getByRole('button', { name: '對照參考回答' }));
  fireEvent.click(screen.getByRole('button', { name: '下載本輪練習' }));
  const revealed = await readBlob(create.mock.calls[2][0] as Blob);
  expect(revealed).toContain(first.answer);
  expect(revealed).toContain(keyText);
  expect(revealed).not.toContain(second.answer);
  expect(downloads.revoke).toHaveBeenCalledWith('blob:practice-hidden');
  expect(document.querySelector('a[download]')).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
  view.unmount();
  expect(downloads.revoke).toHaveBeenCalledWith('blob:practice-revealed');
});

it('aborts a running follow-up when starting practice and ignores its late answer', async () => {
  mocks.available = true;
  let finish!: (response: TutorExplanation) => void;
  mocks.run.mockImplementation(() => new Promise<TutorExplanation>((resolve) => { finish = resolve; }));
  mount();
  await restore();
  const followup = screen.getByRole('button', { name: '接著追問' });
  await waitFor(() => expect(followup.hasAttribute('disabled')).toBe(false));
  fireEvent.click(followup);
  const signal = mocks.run.mock.calls[0][0].signal as AbortSignal;
  begin();
  expect(signal.aborted).toBe(true);
  await act(async () => finish({ ...first, title: '遲到的講解', question: '不應進入本輪的新題目' }));
  expect(screen.getByText(first.question)).toBeTruthy();
  expect(screen.queryByText('不應進入本輪的新題目')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '回到閱讀' }));
  expect(screen.queryByRole('heading', { name: '遲到的講解' })).toBeNull();
  expect((screen.getByLabelText('這一段的講解記錄') as HTMLSelectElement).options).toHaveLength(2);
  expect(value('先寫下你的想法')).toBe('原本的主鍵試答');
});
