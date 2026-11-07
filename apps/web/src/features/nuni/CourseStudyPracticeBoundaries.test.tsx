import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { studySourceFromText, type TutorExplanation } from '@/lib/studyTutor';
import { CourseStudyPanel } from './CourseStudyPanel';
import { appendStudyLesson, emptyStudyPassage } from './courseStudySession';
import {
  serializeCourseStudyProgress,
  type CourseStudyProgressData,
  type CourseStudyProgressScope,
} from './courseStudyProgress';

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
const initialMaterial = { id: 'course-intro', title: '課程說明', body: '這是目前課程已授權的閱讀說明。' };
const sourceText = `${'主鍵用來辨認資料，主鍵不允許重複。'.padEnd(1600, '甲')}交易是一組要一起成功的操作；失敗時要全部復原。`;
const explanations: TutorExplanation[] = [
  {
    title: '辨認資料', explanation: '先確認每筆資料都有自己的識別值。', sourceQuote: '主鍵不允許重複',
    question: '主鍵在資料表中的用途是什麼？', answer: '每一列資料必須能被唯一辨識。',
  },
  {
    title: '交易的完整性', explanation: '相關操作需要一起完成。', sourceQuote: '失敗時要全部復原',
    question: '交易其中一步失敗時，應如何處理？', answer: '應復原這筆交易的全部操作。',
  },
];
const attemptLabel = '這一題，我的回答';
const firstAttempt = '第一題先記下：學號應該唯一。';
const secondAttempt = '第二題的當輪想法 😀\n我會先停止，再還原。';

function savedProgress(): CourseStudyProgressData {
  const passages = Object.fromEntries(explanations.map((response, index) => {
    const memory = appendStudyLesson(emptyStudyPassage(), 'exam', { question: '', response });
    memory.needsReview = true;
    memory.note = `原本第 ${index + 1} 段的筆記`;
    return [`0:${index}`, memory];
  }));
  return {
    scope: { ...scope },
    source: studySourceFromText({ id: 'pasted', title: '貼上的筆記', text: sourceText }),
    position: { sectionIndex: 0, passageIndex: 0, mode: 'exam' },
    passages,
  };
}

function progressFile(raw: string, read = async () => raw): File {
  const file = new File([raw], '複習.campus-study.json', { type: 'application/json' });
  Object.defineProperty(file, 'text', { value: read });
  return file;
}

function chooseProgress(file: File) {
  fireEvent.change(screen.getByLabelText('載入閱讀進度檔'), { target: { files: [file] } });
}

function choosePdf() {
  fireEvent.change(screen.getByLabelText('選擇講義'), {
    target: { files: [new File(['pdf'], '其他講義.pdf', { type: 'application/pdf' })] },
  });
}

function pdfDocument(text: string) {
  return {
    format: 'pdf' as const, name: '其他講義.pdf', warnings: [],
    sections: [{ id: 'page-2', label: '第 2 頁', rows: [{ line: 1, cells: [text] }], needsOcr: false, warnings: [] }],
  };
}

function pendingRead(kind: 'source' | 'progress') {
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => { finish = resolve; });
  if (kind === 'source') {
    mocks.read.mockReturnValueOnce(pending.then(() => pdfDocument('晚到的舊講義不可取代目前練習。')));
    choosePdf();
  } else {
    const stale = savedProgress();
    stale.source.title = '晚到的舊進度不可還原';
    const raw = serializeCourseStudyProgress(stale);
    chooseProgress(progressFile(raw, () => pending.then(() => raw)));
  }
  return finish;
}

async function startSecondQuestion() {
  const props = { scope, courseTitle: '資料庫', material: initialMaterial, onClose: vi.fn() };
  const view = render(<CourseStudyPanel {...props} />);
  chooseProgress(progressFile(serializeCourseStudyProgress(savedProgress())));
  await screen.findByRole('region', { name: '閱讀進度預覽' });
  fireEvent.click(screen.getByRole('button', { name: '還原這份進度' }));
  fireEvent.click(screen.getByRole('button', { name: '開始逐題複習' }));
  fireEvent.change(await screen.findByLabelText(attemptLabel), { target: { value: firstAttempt } });
  fireEvent.click(screen.getByRole('button', { name: '略過這題' }));
  fireEvent.change(screen.getByLabelText(attemptLabel), { target: { value: secondAttempt } });
  fireEvent.click(screen.getByRole('button', { name: '對照參考回答' }));
  expectSecondQuestion();
  expect(mocks.run).not.toHaveBeenCalled();
  return { view, props };
}

function expectSecondQuestion() {
  expect(screen.getAllByText(explanations[1].question).length).toBeGreaterThan(0);
  expect((screen.getByLabelText(attemptLabel) as HTMLTextAreaElement).value).toBe(secondAttempt);
  expect(screen.getByText(explanations[1].answer)).toBeTruthy();
}

function expectRetainedRound() {
  // Check the current position before navigating, then check another card's draft.
  expectSecondQuestion();
  fireEvent.click(screen.getByRole('button', { name: '上一題' }));
  expect((screen.getByLabelText(attemptLabel) as HTMLTextAreaElement).value).toBe(firstAttempt);
  expect(screen.queryByText(explanations[0].answer)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '略過這題' }));
  expectSecondQuestion();
  expect(mocks.run).not.toHaveBeenCalled();
}

beforeEach(() => { mocks.run.mockReset(); mocks.read.mockReset(); });
afterEach(() => { vi.restoreAllMocks(); });

it.each(['source', 'progress'] as const)('retains the round after cancelling a pending %s read and ignores its late result', async (kind) => {
  await startSecondQuestion();
  const finish = pendingRead(kind);
  expect(screen.queryByLabelText(attemptLabel)).toBeNull();
  expect(screen.queryByRole('button', { name: '下載本輪練習' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '取消讀取' }));
  if (kind === 'source') expect((mocks.read.mock.calls[0][1] as AbortSignal).aborted).toBe(true);
  expectRetainedRound();

  await act(async () => finish());
  expectRetainedRound();
  expect(screen.queryByRole('region', { name: '閱讀進度預覽' })).toBeNull();
  expect(screen.queryByText('晚到的舊講義不可取代目前練習。')).toBeNull();
  expect(screen.queryByText('晚到的舊進度不可還原')).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
});

it.each(['source', 'progress'] as const)('preserves drafts, the selected question and the revealed answer when a %s read fails', async (kind) => {
  await startSecondQuestion();
  if (kind === 'source') {
    mocks.read.mockRejectedValueOnce(new Error('這份講義無法讀取。'));
    choosePdf();
  } else {
    chooseProgress(progressFile('{"format":'));
  }
  expect((await screen.findByRole('alert')).textContent).toContain('無法讀取');
  expect(screen.queryByRole('region', { name: '閱讀進度預覽' })).toBeNull();
  expectRetainedRound();
});

it('preserves the round through progress preview and cancellation, then clears it only after confirming the same source', async () => {
  await startSecondQuestion();
  const replacement = savedProgress();
  replacement.passages['0:0'].note = '確認還原後的新筆記';
  const raw = serializeCourseStudyProgress(replacement);

  chooseProgress(progressFile(raw));
  await screen.findByRole('region', { name: '閱讀進度預覽' });
  expectSecondQuestion();
  fireEvent.click(screen.getByRole('button', { name: '取消還原' }));
  expect(screen.queryByRole('region', { name: '閱讀進度預覽' })).toBeNull();
  expectRetainedRound();

  chooseProgress(progressFile(raw));
  await screen.findByRole('region', { name: '閱讀進度預覽' });
  expectSecondQuestion();
  fireEvent.click(screen.getByRole('button', { name: '還原這份進度' }));
  expect(screen.queryByLabelText(attemptLabel)).toBeNull();
  expect((screen.getByLabelText('用自己的話記下這一段') as HTMLTextAreaElement).value).toBe('確認還原後的新筆記');
  expect(screen.getByRole('button', { name: '儲存閱讀進度' })).toBeTruthy();

  // A fresh round cannot borrow either draft or reveal from the prior revision.
  fireEvent.click(screen.getByRole('button', { name: '開始逐題複習' }));
  expect((screen.getByLabelText(attemptLabel) as HTMLTextAreaElement).value).toBe('');
  fireEvent.click(screen.getByRole('button', { name: '略過這題' }));
  expect((screen.getByLabelText(attemptLabel) as HTMLTextAreaElement).value).toBe('');
  expect(screen.queryByText(explanations[1].answer)).toBeNull();
  expect(mocks.run).not.toHaveBeenCalled();
});

it.each(['PDF', 'identical pasted content'] as const)('ends the previous round when %s successfully replaces the source', async (kind) => {
  await startSecondQuestion();
  if (kind === 'PDF') {
    mocks.read.mockResolvedValueOnce(pdfDocument('成功換入的新講義內容。'));
    choosePdf();
    await screen.findByText('成功換入的新講義內容。');
  } else {
    // Both the id "pasted" and the complete source text match the old source.
    fireEvent.change(screen.getByLabelText('或貼上課文與筆記'), { target: { value: sourceText } });
    fireEvent.click(screen.getByRole('button', { name: '開始讀這份內容' }));
  }
  expect(screen.queryByLabelText(attemptLabel)).toBeNull();
  expect(screen.queryByRole('button', { name: '下載本輪練習' })).toBeNull();
  expect(screen.queryByRole('region', { name: '待複習段落' })).toBeNull();
  expect(screen.queryByText(explanations[1].answer)).toBeNull();
  expect((screen.getByLabelText('用自己的話記下這一段') as HTMLTextAreaElement).value).toBe('');
  expect(screen.getByRole('button', { name: '儲存閱讀進度' })).toBeTruthy();
  expect(mocks.run).not.toHaveBeenCalled();
});

it.each([
  { boundary: 'account', kind: 'source', nextScope: { ...scope, platformAccountId: 'pa_22222222-2222-4222-8222-222222222222' } },
  { boundary: 'workspace', kind: 'progress', nextScope: { ...scope, workspaceId: 'cw_22222222-2222-4222-8222-222222222222' } },
] as const)('clears the round at the $boundary boundary and prevents a late $kind read from reviving it', async ({ kind, nextScope }) => {
  const { view, props } = await startSecondQuestion();
  const finish = pendingRead(kind);
  view.rerender(<CourseStudyPanel {...props} scope={nextScope} />);
  if (kind === 'source') expect((mocks.read.mock.calls[0][1] as AbortSignal).aborted).toBe(true);
  expect(screen.queryByLabelText(attemptLabel)).toBeNull();
  expect(screen.getByText(initialMaterial.body)).toBeTruthy();

  await act(async () => finish());
  expect(screen.queryByLabelText(attemptLabel)).toBeNull();
  expect(screen.queryByRole('region', { name: '閱讀進度預覽' })).toBeNull();
  expect(screen.queryByRole('region', { name: '待複習段落' })).toBeNull();
  expect(screen.queryByText(explanations[1].answer)).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByText(initialMaterial.body)).toBeTruthy();
  expect((screen.getByLabelText('用自己的話記下這一段') as HTMLTextAreaElement).value).toBe('');
  expect(mocks.run).not.toHaveBeenCalled();
});
