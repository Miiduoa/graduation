import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { studySourceFromDocument, studySourceFromText, type TutorExplanation } from '@/lib/studyTutor';
import { CourseStudyPanel } from './CourseStudyPanel';
import {
  COURSE_STUDY_PROGRESS_LIMITS,
  parseCourseStudyProgress,
  serializeCourseStudyProgress,
  type CourseStudyProgressData,
  type CourseStudyProgressScope,
} from './courseStudyProgress';
import { appendStudyLesson, emptyStudyPassage } from './courseStudySession';

const mocks = vi.hoisted(() => ({ run: vi.fn(), read: vi.fn() }));
vi.mock('@/lib/studyTutorRuntime', () => ({
  getStudyTutorAvailability: () => ({ available: true, downloadLabel: '約 1.9 GB，建議使用 Wi-Fi' }),
  runStudyTutor: mocks.run,
}));
vi.mock('@/lib/personalImportDocuments', () => ({ readPersonalImportDocumentFile: mocks.read }));

const scope: CourseStudyProgressScope = {
  platformAccountId: 'pa_11111111-1111-4111-8111-111111111111',
  workspaceId: 'cw_11111111-1111-4111-8111-111111111111',
};
const material = { id: 'material-1', title: '關聯式資料庫', body: '主鍵用來唯一識別資料。' };
const savedText = '交易是一組一起成功或失敗的操作，失敗時必須復原全部操作。';
const explanation: TutorExplanation = {
  title: '交易的完整性', explanation: '轉帳包含扣款與入帳，這兩項操作需要一起完成。',
  sourceQuote: '失敗時必須復原全部操作', question: '扣款成功但入帳失敗時，應該怎麼處理？',
  answer: '復原這筆交易的全部操作。',
};
const noteLabel = '用自己的話記下這一段';
const questionLabel = '卡在哪裡？也可以直接開始講解';
const restoreLabel = '載入閱讀進度檔';
const inputValue = (label: string) => (screen.getByLabelText(label) as HTMLInputElement).value;

function progress(): CourseStudyProgressData {
  const source = studySourceFromDocument({ format: 'pdf', name: '資料庫複習.pdf', warnings: [], sections: [
    { id: 'page-2', label: '第 2 頁', rows: [{ line: 1, cells: [material.body] }], needsOcr: false, warnings: [] },
    { id: 'page-5', label: '第 5 頁', rows: [{ line: 1, cells: [`${'甲'.repeat(1600)}${savedText}`] }], needsOcr: false, warnings: [] },
  ] });
  let memory = appendStudyLesson(emptyStudyPassage(), 'exam', {
    question: '怎麼理解交易？', response: { ...explanation, title: '第一輪講解', answer: '第一輪的參考回答。' },
  });
  memory = appendStudyLesson(memory, 'exam', {
    question: '從另一個角度說明', response: { ...explanation, title: '另一條追問' },
  }, 1);
  memory = appendStudyLesson(memory, 'exam', {
    question: '回到第一輪，再給一個例子', response: { ...explanation, title: '第三輪講解' },
  }, 1);
  memory.note = '交易必須一起完成。\n這裡還要問老師。';
  memory.needsReview = true;
  memory.modes.exam.question = '你剛剛說的復原是什麼意思？';
  memory.modes.exam.lessons[0].attempt = '我第一次的想法';
  memory.modes.exam.lessons[0].answerVisible = true;
  memory.modes.exam.lessons[2].attempt = '我想應該把扣款也復原。';
  return {
    scope: { ...scope }, source,
    position: { sectionIndex: 1, passageIndex: 1, mode: 'exam' },
    passages: { '0:0': { ...emptyStudyPassage(), note: '上一頁留下的筆記' }, '1:1': memory },
  };
}

function progressFile(text: string, name = '資料庫.campus-study.json', read = async () => text): File {
  const file = new File([text], name, { type: 'application/json' });
  Object.defineProperty(file, 'text', { value: read });
  return file;
}

function selectFile(file: File) {
  fireEvent.change(screen.getByLabelText(restoreLabel), { target: { files: [file] } });
}

async function preview(data = progress()) {
  selectFile(progressFile(serializeCourseStudyProgress(data)));
  return screen.findByRole('region', { name: '閱讀進度預覽' });
}

function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsText(blob);
  });
}

beforeEach(() => { mocks.run.mockReset(); mocks.read.mockReset(); mocks.run.mockResolvedValue(explanation); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('saves an explicit progress download that can restore its source, position, notes, drafts and self-check state', async () => {
  const create = vi.fn().mockReturnValue('blob:study-progress');
  const revoke = vi.fn();
  const OriginalURL = URL;
  vi.stubGlobal('URL', class extends OriginalURL { static createObjectURL = create; static revokeObjectURL = revoke; });
  const downloads: { href: string; filename: string }[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    downloads.push({ href: this.href, filename: this.download });
  });
  const storage = Object.hasOwn(window.localStorage, 'getItem') ? window.localStorage : Storage.prototype;
  const storageRead = vi.spyOn(storage, 'getItem');
  const storageWrite = vi.spyOn(storage, 'setItem');
  const body = `${material.body.padEnd(1600, '甲')}${savedText}`;
  const view = render(<CourseStudyPanel scope={scope} courseTitle="資料庫" material={{ ...material, body }} onClose={vi.fn()} />);
  try {
    expect(create).not.toHaveBeenCalled();
    expect(mocks.run).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '下一段' }));
    fireEvent.change(screen.getByLabelText('這次怎麼讀'), { target: { value: 'practice' } });
    const start = screen.getByRole('button', { name: '啟用 AI 講解本段' });
    await waitFor(() => expect(start.hasAttribute('disabled')).toBe(false));
    fireEvent.click(start);
    await screen.findByRole('region', { name: '本段 AI 講解' });
    fireEvent.change(screen.getByLabelText(noteLabel), { target: { value: '明天要繼續的筆記 😀\n保留換行。' } });
    fireEvent.change(screen.getByLabelText(questionLabel), { target: { value: '尚未送出的下一個問題' } });
    fireEvent.change(screen.getByLabelText('先寫下你的想法'), { target: { value: '我先試著回答。' } });
    fireEvent.click(screen.getByRole('button', { name: '加入待複習' }));
    expect(create).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '儲存閱讀進度' }));
    expect(downloads).toHaveLength(1);
    expect(downloads[0].href).toBe('blob:study-progress');
    expect(downloads[0].filename).toMatch(/\.campus-study\.json$/);
    const blob = create.mock.calls[0][0] as Blob;
    expect(blob.type).toMatch(/^application\/json/);
    const text = await readBlob(blob);
    const saved = parseCourseStudyProgress(text, scope);
    expect(saved.scope).toEqual(scope);
    expect(Object.keys(saved.scope).sort()).toEqual(['platformAccountId', 'workspaceId']);
    expect(text).not.toMatch(/"(?:context|cookie|token|session)"\s*:/);
    expect(saved.source.sections[0].text).toBe(body);
    expect(saved.position).toEqual({ sectionIndex: 0, passageIndex: 1, mode: 'practice' });
    const memory = saved.passages['0:1'];
    expect(memory.note).toBe('明天要繼續的筆記 😀\n保留換行。');
    expect(memory.needsReview).toBe(true);
    expect(memory.modes.practice.question).toBe('尚未送出的下一個問題');
    expect(memory.modes.practice.selectedLessonId).toBe(1);
    expect(memory.modes.practice.lessons[0]).toEqual(expect.objectContaining({
      response: explanation, attempt: '我先試著回答。', answerVisible: false,
    }));
    expect(screen.queryByText(explanation.answer)).toBeNull();
    expect(storageRead).not.toHaveBeenCalled();
    expect(storageWrite).not.toHaveBeenCalled();
    expect(mocks.read).not.toHaveBeenCalled();
    expect(document.querySelector('a[download]')).toBeNull();
    view.unmount();
    render(<CourseStudyPanel scope={scope} courseTitle="資料庫" onClose={vi.fn()} />);
    selectFile(progressFile(text, downloads[0].filename));
    await screen.findByRole('region', { name: '閱讀進度預覽' });
    fireEvent.click(screen.getByRole('button', { name: '還原這份進度' }));
    await screen.findByRole('heading', { name: explanation.title });
    expect(document.querySelector('mark')?.parentElement?.textContent).toBe(savedText);
    expect(inputValue('這次怎麼讀')).toBe('practice');
    expect(inputValue(noteLabel)).toBe(memory.note);
    expect(inputValue(questionLabel)).toBe(memory.modes.practice.question);
    expect(inputValue('先寫下你的想法')).toBe('我先試著回答。');
    expect(screen.queryByText(explanation.answer)).toBeNull();
    expect(mocks.run).toHaveBeenCalledTimes(1);
  } finally { view.unmount(); }
  expect(revoke).toHaveBeenCalledWith('blob:study-progress');
});

it('saves and restores structured steps and quoted formulas without another model call or revealing the answer', async () => {
  const response: TutorExplanation = {
    title: '長方形的面積', explanation: '把寬與高相乘，得到面積。', sourceQuote: 'A = w*h',
    question: '這裡的 w 代表什麼？', answer: '長方形的寬。',
    steps: [
      { title: '辨認寬與高', explanation: '先確認 w 與 h 各代表哪一條邊。', sourceQuote: 'w 是寬，h 是高' },
      { title: '對照面積公式', explanation: '教材以寬乘以高表示面積。', sourceQuote: 'A = w*h', formula: 'A = w*h' },
    ],
  };
  mocks.run.mockResolvedValue(response);
  const create = vi.fn().mockReturnValue('blob:step-progress');
  const OriginalURL = URL;
  vi.stubGlobal('URL', class extends OriginalURL { static createObjectURL = create; static revokeObjectURL = vi.fn(); });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  const body = '長方形的面積 A = w*h；w 是寬，h 是高。';
  const view = render(<CourseStudyPanel scope={scope} courseTitle="數學" material={{ id: 'area', title: '面積', body }} onClose={vi.fn()} />);
  const start = screen.getByRole('button', { name: '啟用 AI 講解本段' });
  await waitFor(() => expect(start.hasAttribute('disabled')).toBe(false));
  fireEvent.click(start);
  await screen.findByRole('navigation', { name: '講解步驟' });
  fireEvent.click(screen.getByRole('button', { name: '下一步' }));
  expect(document.querySelector('math')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('先寫下你的想法'), { target: { value: '其中一條邊的長度。' } });
  fireEvent.click(screen.getByRole('button', { name: '儲存閱讀進度' }));
  const raw = await readBlob(create.mock.calls[0][0] as Blob);
  expect(JSON.parse(raw).version).toBe(2);
  expect(parseCourseStudyProgress(raw, scope).passages['0:0'].modes.understand.lessons[0].response).toEqual(response);
  view.unmount();
  render(<CourseStudyPanel scope={scope} courseTitle="數學" onClose={vi.fn()} />);
  selectFile(progressFile(raw));
  await screen.findByRole('region', { name: '閱讀進度預覽' });
  expect(screen.queryByRole('navigation', { name: '講解步驟' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '還原這份進度' }));
  expect(await screen.findByText('第 1 步，共 2 步')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '下一步' }));
  expect(screen.getByRole('heading', { name: '對照面積公式' })).toBeTruthy();
  expect(document.querySelector('math')).toBeTruthy();
  expect(document.querySelector('mark')?.textContent).toBe('A = w*h');
  expect(document.querySelector('mark')?.parentElement?.textContent).toBe(body);
  expect(inputValue('先寫下你的想法')).toBe('其中一條邊的長度。');
  expect(screen.queryByText(response.answer)).toBeNull();
  expect(mocks.run).toHaveBeenCalledTimes(1);
  expect(mocks.read).not.toHaveBeenCalled();
});

it('loads a version one progress file without inventing structured teaching steps', async () => {
  const legacy = JSON.parse(serializeCourseStudyProgress(progress()));
  legacy.version = 1;
  render(<CourseStudyPanel scope={scope} courseTitle="資料庫" onClose={vi.fn()} />);
  selectFile(progressFile(JSON.stringify(legacy)));
  await screen.findByRole('region', { name: '閱讀進度預覽' });
  fireEvent.click(screen.getByRole('button', { name: '還原這份進度' }));
  expect(await screen.findByRole('heading', { name: '第三輪講解' })).toBeTruthy();
  expect(screen.queryByRole('navigation', { name: '講解步驟' })).toBeNull();
  expect(inputValue(noteLabel)).toBe(progress().passages['1:1'].note);
  expect(mocks.run).not.toHaveBeenCalled();
});

it('previews the saved location and lets the user cancel without replacing current learning', async () => {
  render(<CourseStudyPanel scope={scope} courseTitle="資料庫" material={material} onClose={vi.fn()} />);
  fireEvent.change(screen.getByLabelText(noteLabel), { target: { value: '目前正在寫的筆記' } });
  fireEvent.change(screen.getByLabelText(questionLabel), { target: { value: '目前的問題草稿' } });
  const region = await preview();
  expect(region.textContent).toContain('資料庫複習.pdf');
  expect(region.textContent).toContain('資料庫.campus-study.json');
  expect(region.textContent).toContain('第 5 頁');
  expect(region.textContent).toContain('第 2 段');
  expect(region.textContent).toContain('考前複習');
  // File.text() and the preview focus effect settle in separate microtasks.
  await waitFor(() => expect(document.activeElement).toBe(within(region).getByRole('heading')));
  expect(mocks.run).not.toHaveBeenCalled();
  expect(mocks.read).not.toHaveBeenCalled();
  fireEvent.click(within(region).getByRole('button', { name: '取消還原' }));
  expect(screen.queryByRole('region', { name: '閱讀進度預覽' })).toBeNull();
  expect(screen.getByText(material.body)).toBeTruthy();
  expect(inputValue(noteLabel)).toBe('目前正在寫的筆記');
  expect(inputValue(questionLabel)).toBe('目前的問題草稿');
  expect(document.activeElement).toBe(screen.getByLabelText(restoreLabel));
});

it('can save just the reading position before any note or model use', async () => {
  const create = vi.fn().mockReturnValue('blob:reading-position');
  const OriginalURL = URL;
  vi.stubGlobal('URL', class extends OriginalURL { static createObjectURL = create; static revokeObjectURL = vi.fn(); });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  const view = render(<CourseStudyPanel scope={scope} courseTitle="資料庫" material={{ ...material, body: `${'甲'.repeat(1600)}${savedText}` }} onClose={vi.fn()} />);
  try {
    fireEvent.click(screen.getByRole('button', { name: '下一段' }));
    const save = screen.getByRole('button', { name: '儲存閱讀進度' });
    expect(save.hasAttribute('disabled')).toBe(false);
    expect(screen.getByRole('button', { name: '下載本次筆記' }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(save);
    const saved = parseCourseStudyProgress(await readBlob(create.mock.calls[0][0] as Blob), scope);
    expect(saved.position).toEqual({ sectionIndex: 0, passageIndex: 1, mode: 'understand' });
    expect(saved.passages).toEqual({});
    expect(mocks.run).not.toHaveBeenCalled();
  } finally { view.unmount(); }
});

it('restores the selected PDF page, mode, notes and lesson branch without automatically generating', async () => {
  render(<CourseStudyPanel scope={scope} courseTitle="資料庫" onClose={vi.fn()} />);
  const data = progress();
  await preview(data);
  expect(screen.queryByRole('region', { name: '本段 AI 講解' })).toBeNull();
  expect(mocks.run).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '還原這份進度' }));
  await screen.findByRole('heading', { name: '第三輪講解' });
  expect(document.querySelector('mark')?.parentElement?.textContent).toBe(savedText);
  expect(inputValue('閱讀範圍')).toBe('1');
  expect(inputValue('這次怎麼讀')).toBe('exam');
  expect(screen.getByText('第 2 段，共 2 段')).toBeTruthy();
  expect(inputValue(noteLabel)).toBe(data.passages['1:1'].note);
  expect(inputValue(questionLabel)).toBe(data.passages['1:1'].modes.exam.question);
  expect(inputValue('這一段的講解記錄')).toBe('3');
  expect(inputValue('先寫下你的想法')).toBe('我想應該把扣款也復原。');
  expect(screen.getByRole('button', { name: '已加入待複習' }).getAttribute('aria-pressed')).toBe('true');
  expect(screen.queryByText(explanation.answer)).toBeNull();
  expect(mocks.run).not.toHaveBeenCalled();
  expect(mocks.read).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('這一段的講解記錄'), { target: { value: '1' } });
  expect(inputValue('先寫下你的想法')).toBe('我第一次的想法');
  expect(screen.getByText('第一輪的參考回答。')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('這一段的講解記錄'), { target: { value: '3' } });
  expect(screen.queryByText('第一輪的參考回答。')).toBeNull();
  mocks.run.mockResolvedValueOnce({ ...explanation, title: '還原後的新講解' });
  const followUp = screen.getByRole('button', { name: '接著追問' });
  await waitFor(() => expect(followUp.hasAttribute('disabled')).toBe(false));
  fireEvent.click(followUp);
  await screen.findByRole('heading', { name: '還原後的新講解' });
  expect(mocks.run).toHaveBeenCalledTimes(1);
  const request = mocks.run.mock.calls[0][0];
  expect(request.mode).toBe('exam');
  expect(request.question).toBe(data.passages['1:1'].modes.exam.question);
  expect(request.passage.text).toBe(savedText);
  expect(request.history.turns.map((turn: { response: TutorExplanation }) => turn.response.title)).toEqual(['第一輪講解', '第三輪講解']);
});

it('labels restored material as a saved copy even when its ID matches the current course material', async () => {
  render(<CourseStudyPanel scope={scope} courseTitle="資料庫" material={material} onClose={vi.fn()} />);
  expect(screen.getByText(/已帶入「關聯式資料庫」/)).toBeTruthy();
  const data: CourseStudyProgressData = {
    scope, source: studySourceFromText({ id: material.id, title: material.title, text: '進度檔裡的舊版教材。' }),
    position: { sectionIndex: 0, passageIndex: 0, mode: 'understand' }, passages: {},
  };
  await preview(data);
  fireEvent.click(screen.getByRole('button', { name: '還原這份進度' }));
  expect(await screen.findByText('進度檔裡的舊版教材。')).toBeTruthy();
  expect(screen.queryByText(/已帶入「關聯式資料庫」/)).toBeNull();
  expect(screen.getByText(/進度檔中的教材副本/)).toBeTruthy();
});

it.each([
  ['another account', (): string => serializeCourseStudyProgress({ ...progress(), scope: { ...scope, platformAccountId: 'pa_22222222-2222-4222-8222-222222222222' } })],
  ['another course', (): string => serializeCourseStudyProgress({ ...progress(), scope: { ...scope, workspaceId: 'cw_22222222-2222-4222-8222-222222222222' } })],
  ['broken JSON', (): string => '{"format":'],
  ['a quote outside the source', (): string => {
    const data = JSON.parse(serializeCourseStudyProgress(progress()));
    data.passages['1:1'].modes.exam.lessons[0].response.sourceQuote = '不在講義裡的引文';
    return JSON.stringify(data);
  }],
] as const)('rejects %s while preserving the current notes and source', async (_name, text) => {
  render(<CourseStudyPanel scope={scope} courseTitle="資料庫" material={material} onClose={vi.fn()} />);
  fireEvent.change(screen.getByLabelText(noteLabel), { target: { value: '載入失敗也要保留' } });
  selectFile(progressFile(text()));
  expect((await screen.findByRole('alert')).textContent).toBeTruthy();
  expect(screen.queryByRole('region', { name: '閱讀進度預覽' })).toBeNull();
  expect(screen.getByText(material.body)).toBeTruthy();
  expect(inputValue(noteLabel)).toBe('載入失敗也要保留');
  expect(mocks.run).not.toHaveBeenCalled();
});

it('does not read an oversized progress file or replace the current notes', async () => {
  render(<CourseStudyPanel scope={scope} courseTitle="資料庫" material={material} onClose={vi.fn()} />);
  fireEvent.change(screen.getByLabelText(noteLabel), { target: { value: '超限也保留原筆記' } });
  const read = vi.fn().mockResolvedValue(serializeCourseStudyProgress(progress()));
  const file = progressFile('large', '過大.campus-study.json', read);
  Object.defineProperty(file, 'size', { value: COURSE_STUDY_PROGRESS_LIMITS.bytes + 1 });
  selectFile(file);
  expect((await screen.findByRole('alert')).textContent).toContain('8 MiB');
  expect(read).not.toHaveBeenCalled();
  expect(inputValue(noteLabel)).toBe('超限也保留原筆記');
  expect(screen.queryByRole('region', { name: '閱讀進度預覽' })).toBeNull();
});

it('ignores a cancelled file read after a newer progress file has reached preview', async () => {
  render(<CourseStudyPanel scope={scope} courseTitle="資料庫" material={material} onClose={vi.fn()} />);
  const older = progress();
  older.source.title = '不應還原的舊進度';
  let finish!: (value: string) => void;
  selectFile(progressFile('pending', '舊進度.campus-study.json', () => new Promise((resolve) => { finish = resolve; })));
  fireEvent.click(screen.getByRole('button', { name: '取消讀取' }));
  const newer = progress();
  newer.source.title = '應該還原的新進度';
  newer.passages['1:1'].note = '最新檔案的筆記';
  await preview(newer);
  await act(async () => finish(serializeCourseStudyProgress(older)));
  expect(screen.getByRole('region', { name: '閱讀進度預覽' }).textContent).toContain('應該還原的新進度');
  expect(screen.queryByText(/不應還原的舊進度/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '還原這份進度' }));
  expect(inputValue(noteLabel)).toBe('最新檔案的筆記');
  expect(mocks.run).not.toHaveBeenCalled();
});

it('discards a pending preview when the user deliberately starts another source', async () => {
  render(<CourseStudyPanel scope={scope} courseTitle="資料庫" material={material} onClose={vi.fn()} />);
  await preview();
  fireEvent.change(screen.getByLabelText('或貼上課文與筆記'), { target: { value: '剛選擇的新教材。' } });
  fireEvent.click(screen.getByRole('button', { name: '開始讀這份內容' }));
  expect(screen.queryByRole('region', { name: '閱讀進度預覽' })).toBeNull();
  expect(screen.queryByRole('button', { name: '還原這份進度' })).toBeNull();
  expect(screen.getByText('剛選擇的新教材。')).toBeTruthy();
  expect(inputValue(noteLabel)).toBe('');
  expect(screen.queryByText(savedText)).toBeNull();
  expect(mocks.run).not.toHaveBeenCalled();
});

it.each([
  { ...scope, platformAccountId: 'pa_22222222-2222-4222-8222-222222222222' },
  { ...scope, workspaceId: 'cw_22222222-2222-4222-8222-222222222222' },
])('clears old memory and ignores a pending restore when scope changes (%#)', async (nextScope) => {
  const view = render(<CourseStudyPanel scope={scope} courseTitle="資料庫" material={material} onClose={vi.fn()} />);
  fireEvent.change(screen.getByLabelText(noteLabel), { target: { value: '先前帳號課程的筆記' } });
  fireEvent.click(screen.getByRole('button', { name: '加入待複習' }));
  let finish!: (value: string) => void;
  selectFile(progressFile('pending', '先前進度.campus-study.json', () => new Promise((resolve) => { finish = resolve; })));
  view.rerender(<CourseStudyPanel scope={nextScope} courseTitle="資料庫" material={material} onClose={vi.fn()} />);
  expect(inputValue(noteLabel)).toBe('');
  expect(screen.queryByRole('region', { name: '待複習段落' })).toBeNull();
  await act(async () => finish(serializeCourseStudyProgress(progress())));
  expect(screen.queryByRole('region', { name: '閱讀進度預覽' })).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(inputValue(noteLabel)).toBe('');
  expect(mocks.run).not.toHaveBeenCalled();
});
