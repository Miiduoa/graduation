import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { TutorExplanation } from '@/lib/studyTutor';
import { CourseStudyPanel } from './CourseStudyPanel';
import { COURSE_STUDY_PROGRESS_LIMITS, parseCourseStudyProgress } from './courseStudyProgress';
import { parseStudyPracticeCheckpoint } from './courseStudyPracticeCheckpoint';

const mocks = vi.hoisted(() => ({ run: vi.fn(), read: vi.fn(), available: true }));
vi.mock('@/lib/studyTutorRuntime', () => ({
  getStudyTutorAvailability: () => ({ available: mocks.available, downloadLabel: '約 1.9 GB，建議使用 Wi-Fi', reason: mocks.available ? undefined : '裝置尚未支援 AI 講解。' }),
  runStudyTutor: mocks.run,
}));
vi.mock('@/lib/personalImportDocuments', () => ({ readPersonalImportDocumentFile: mocks.read }));

const scope = { platformAccountId: 'pa_11111111-1111-4111-8111-111111111111', workspaceId: 'cw_11111111-1111-4111-8111-111111111111' };
const material = { id: 'material-1', title: '關聯式資料庫', body: '主鍵用來唯一識別一筆資料，不能重複或為空值。' };
const explanation: TutorExplanation = {
  title: '辨認一筆資料', explanation: '把主鍵想成每位學生的學號，同一份名冊裡不能重複。',
  sourceQuote: '主鍵用來唯一識別一筆資料', question: '兩位學生可以使用同一個主鍵嗎？為什麼？',
  answer: '不可以，否則無法唯一識別一筆資料。',
};
beforeEach(() => { mocks.read.mockReset(); mocks.run.mockReset(); mocks.available = true; mocks.run.mockResolvedValue(explanation); });


it('isolates study notes when two different account/course scopes share an ambiguous colon-joined key', () => {
  // These scopes have the same old key, "student:course:one".
  const firstScope = { platformAccountId: 'student:course', workspaceId: 'one' };
  const secondScope = { platformAccountId: 'student', workspaceId: 'course:one' };
  const secondMaterial = {
    id: 'course-two-material', title: '另一門課的教材', body: '這門課在介紹外鍵與資料表關聯。',
  };
  const onClose = vi.fn();
  const { rerender } = render(<CourseStudyPanel scope={firstScope} courseTitle="第一門課"
    material={material} onClose={onClose} />);
  fireEvent.change(screen.getByLabelText('用自己的話記下這一段'),
    { target: { value: '第一個帳號的私人筆記' } });
  fireEvent.click(screen.getByRole('button', { name: '加入待複習' }));
  expect(screen.getByRole('region', { name: '待複習段落' })).toBeTruthy();

  rerender(<CourseStudyPanel scope={secondScope} courseTitle="第二門課"
    material={secondMaterial} onClose={onClose} />);
  expect(screen.getByText(secondMaterial.body)).toBeTruthy();
  expect(screen.queryByText(material.body)).toBeNull();
  expect((screen.getByLabelText('用自己的話記下這一段') as HTMLTextAreaElement).value).toBe('');
  expect(screen.queryByRole('region', { name: '待複習段落' })).toBeNull();
  expect(mocks.run).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
});

it('protects unsaved notes when the parent selects a different authorized material in the same course', () => {
  const onClose = vi.fn();
  const revised = { ...material, body: '更新後的教材說明外鍵必須指向存在的主鍵。' };
  const another = { id: 'material-2', title: '第二份講義', body: '第二份講義介紹交易的 ACID 特性。' };
  const { rerender } = render(<CourseStudyPanel scope={scope} courseTitle="資料庫"
    material={material} onClose={onClose} />);
  fireEvent.change(screen.getByLabelText('用自己的話記下這一段'),
    { target: { value: '這份主鍵筆記尚未備份。' } });

  // The same id/title with changed text is still a new selected source.
  rerender(<CourseStudyPanel scope={scope} courseTitle="資料庫"
    material={revised} onClose={onClose} />);
  expect(screen.getByRole('heading', { name: '要改讀另一份教材嗎？' })).toBeTruthy();
  expect(screen.getByText(material.body)).toBeTruthy();
  expect(screen.queryByText(revised.body)).toBeNull();
  expect((screen.getByLabelText('用自己的話記下這一段') as HTMLTextAreaElement).value)
    .toBe('這份主鍵筆記尚未備份。');
  fireEvent.click(screen.getByRole('button', { name: '保留原本的學習內容' }));
  expect(screen.queryByRole('heading', { name: '要改讀另一份教材嗎？' })).toBeNull();
  expect(screen.getByText(material.body)).toBeTruthy();

  // A subsequent new selection requires a fresh confirmation; acceptance resets
  // both old text and private notes without touching other course scopes.
  rerender(<CourseStudyPanel scope={scope} courseTitle="資料庫"
    material={another} onClose={onClose} />);
  expect(screen.getByRole('heading', { name: '要改讀另一份教材嗎？' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '確認改讀新教材' }));
  expect(screen.getByText(another.body)).toBeTruthy();
  expect(screen.queryByText(material.body)).toBeNull();
  expect((screen.getByLabelText('用自己的話記下這一段') as HTMLTextAreaElement).value).toBe('');
  expect(mocks.run).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
});

it('updates the visible lesson immediately when a same-course material changes with no unsaved work', () => {
  const next = { id: material.id, title: material.title, body: '主鍵與外鍵的功能不相同。' };
  const onClose = vi.fn();
  const { rerender } = render(<CourseStudyPanel scope={scope} courseTitle="資料庫"
    material={material} onClose={onClose} />);
  rerender(<CourseStudyPanel scope={scope} courseTitle="資料庫"
    material={next} onClose={onClose} />);
  expect(screen.getByText(next.body)).toBeTruthy();
  expect(screen.queryByText(material.body)).toBeNull();
  expect(screen.queryByRole('heading', { name: '要改讀另一份教材嗎？' })).toBeNull();
  expect(mocks.run).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
});

it('shows the authorized material without downloading or generating until requested', async () => {
  render(<CourseStudyPanel scope={scope} courseTitle="資料庫" material={material} onClose={vi.fn()} />);
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

it('switches local narration between the AI explanation and exact textbook without losing the note or speed', async () => {
  const spoken = vi.fn();
  const cancelled = vi.fn();
  class LocalUtterance {
    voice: unknown;
    lang = '';
    rate = 1;
    onend: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(public text: string) {}
  }
  vi.stubGlobal('SpeechSynthesisUtterance', LocalUtterance);
  vi.stubGlobal('speechSynthesis', {
    getVoices: () => [{ lang: 'zh-TW', localService: true }],
    speak: spoken,
    cancel: cancelled,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  const view = render(<CourseStudyPanel scope={scope} courseTitle="資料庫" material={material} onClose={vi.fn()} />);
  try {
    const note = screen.getByLabelText('用自己的話記下這一段') as HTMLTextAreaElement;
    fireEvent.change(note, { target: { value: '我要重新聽原文，核對 AI 說明。' } });
    fireEvent.change(screen.getByRole('combobox', { name: '朗讀速度' }), { target: { value: '0.8' } });
    fireEvent.click(screen.getByRole('button', { name: '啟用 AI 講解本段' }));
    await screen.findByRole('region', { name: '本段 AI 講解' });
    const target = screen.getByRole('combobox', { name: '朗讀內容' }) as HTMLSelectElement;
    expect(target.value).toBe('explanation');
    expect(screen.queryByRole('option', { name: '全部步驟與引句' })).toBeNull();
    // AI completion can render the new reader before its mount effect has
    // detected installed voices. Wait for the supported local voice to make the
    // button operable; the manual-retry path has separate component coverage.
    const startLocalNarration = async (label: string, expectedCalls: number) => {
      const play = screen.getByRole('button', { name: label }) as HTMLButtonElement;
      await waitFor(() => expect(play.disabled).toBe(false));
      fireEvent.click(play);
      await waitFor(() => expect(spoken).toHaveBeenCalledTimes(expectedCalls));
    };
    await startLocalNarration('朗讀這段講解', 1);
    expect((spoken.mock.calls[0][0] as LocalUtterance).text).toBe(explanation.explanation);
    expect((spoken.mock.calls[0][0] as LocalUtterance).rate).toBe(0.8);
    fireEvent.change(target, { target: { value: 'source' } });
    expect(cancelled).toHaveBeenCalledTimes(1);
    expect((screen.getByRole('combobox', { name: '朗讀速度' }) as HTMLSelectElement).value).toBe('0.8');
    await startLocalNarration('朗讀原文', 2);
    expect((spoken.mock.calls[1][0] as LocalUtterance).text).toBe(material.body);
    expect((spoken.mock.calls[1][0] as LocalUtterance).rate).toBe(0.8);
    expect(note.value).toBe('我要重新聽原文，核對 AI 說明。');
    expect(screen.getByRole('region', { name: '本段 AI 講解' })).toBeTruthy();
    expect(mocks.run).toHaveBeenCalledTimes(1);
  } finally {
    view.unmount();
    vi.unstubAllGlobals();
  }
});


it('reads each cited teaching step in order and keeps playing while browsing source evidence', async () => {
  const spoken = vi.fn();
  const cancelled = vi.fn();
  class LocalUtterance {
    voice: unknown;
    lang = '';
    rate = 1;
    onend: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(public text: string) {}
  }
  vi.stubGlobal('SpeechSynthesisUtterance', LocalUtterance);
  vi.stubGlobal('speechSynthesis', {
    getVoices: () => [{ lang: 'zh-TW', localService: true }],
    speak: spoken, cancel: cancelled, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  });
  const structured: TutorExplanation = { ...explanation, steps: [
    { title: '辨認主鍵', explanation: '主鍵代表唯一身分。', sourceQuote: '主鍵用來唯一識別一筆資料' },
    { title: '檢查限制', explanation: '不能重複或留空。', sourceQuote: '不能重複或為空值' },
  ] };
  mocks.run.mockResolvedValueOnce(structured);
  const view = render(<CourseStudyPanel scope={scope} courseTitle="資料庫" material={material} onClose={vi.fn()} />);
  try {
    const note = screen.getByLabelText('用自己的話記下這一段') as HTMLTextAreaElement;
    fireEvent.change(note, { target: { value: '每一步都要核對來源' } });
    fireEvent.change(screen.getByRole('combobox', { name: '朗讀速度' }), { target: { value: '0.8' } });
    fireEvent.click(screen.getByRole('button', { name: '啟用 AI 講解本段' }));
    await screen.findByRole('region', { name: '本段 AI 講解' });
    const target = screen.getByRole('combobox', { name: '朗讀內容' });
    fireEvent.change(target, { target: { value: 'all-steps' } });
    const play = screen.getByRole('button', { name: '朗讀全部步驟與引句' }) as HTMLButtonElement;
    await waitFor(() => expect(play.disabled).toBe(false));
    fireEvent.click(play);
    await waitFor(() => expect(spoken).toHaveBeenCalledTimes(1));
    const utterance = spoken.mock.calls[0][0] as LocalUtterance;
    expect(utterance.text).toBe(
      '第 1 步：辨認主鍵。教材原文：主鍵用來唯一識別一筆資料。主鍵代表唯一身分。\n' +
      '第 2 步：檢查限制。教材原文：不能重複或為空值。不能重複或留空。',
    );
    expect(utterance.rate).toBe(0.8);
    fireEvent.click(screen.getByRole('button', { name: '第 2 步：檢查限制' }));
    expect(cancelled).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '停止朗讀' })).toBeTruthy();
    fireEvent.change(target, { target: { value: 'source' } });
    expect(cancelled).toHaveBeenCalledTimes(1);
    const original = screen.getByRole('button', { name: '朗讀原文' }) as HTMLButtonElement;
    await waitFor(() => expect(original.disabled).toBe(false));
    fireEvent.click(original);
    await waitFor(() => expect(spoken).toHaveBeenCalledTimes(2));
    expect((spoken.mock.calls[1][0] as LocalUtterance).text).toBe(material.body);
    expect((spoken.mock.calls[1][0] as LocalUtterance).rate).toBe(0.8);
    expect(note.value).toBe('每一步都要核對來源');
    expect(mocks.run).toHaveBeenCalledTimes(1);
  } finally {
    view.unmount();
    vi.unstubAllGlobals();
  }
});

it('navigates repeated exact model quotes without rerunning AI or altering the student note', async () => {
  const repeated = { ...material, body: '主鍵在第一段。外鍵可以參照主鍵。最後一段再提主鍵。' };
  mocks.run.mockResolvedValueOnce({ ...explanation, sourceQuote: '主鍵' });
  render(<CourseStudyPanel scope={scope} courseTitle="資料庫" material={repeated} onClose={vi.fn()} />);
  const note = screen.getByLabelText('用自己的話記下這一段') as HTMLTextAreaElement;
  fireEvent.change(note, { target: { value: '我想核對第二次提到的主鍵' } });
  fireEvent.click(screen.getByRole('button', { name: '啟用 AI 講解本段' }));
  await screen.findByRole('region', { name: '本段 AI 講解' });
  const beforeMark = () => document.querySelector('mark')?.previousSibling?.textContent ?? '';
  expect(beforeMark()).toBe('');
  expect(screen.getByText('相同引句在本段出現 3 處，目前標示第 1 處。')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '下一處相同引句' }));
  expect(beforeMark()).toBe('主鍵在第一段。外鍵可以參照');
  expect(screen.getByText('相同引句在本段出現 3 處，目前標示第 2 處。')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '上一處相同引句' }));
  expect(beforeMark()).toBe('');
  fireEvent.click(screen.getByRole('button', { name: '上一處相同引句' }));
  expect(beforeMark()).toBe('主鍵在第一段。外鍵可以參照主鍵。最後一段再提');
  expect(screen.getByText('相同引句在本段出現 3 處，目前標示第 3 處。')).toBeTruthy();
  expect(document.querySelector('blockquote')?.textContent).toBe(repeated.body);
  expect(note.value).toBe('我想核對第二次提到的主鍵');
  expect(mocks.run).toHaveBeenCalledTimes(1);
});


it('brings the selected repeated source quote into view without losing keyboard focus or scrolling on note edits', async () => {
  const repeated = { ...material, body: '主鍵在第一段。外鍵可以參照主鍵。最後一段再提主鍵。' };
  mocks.run.mockResolvedValueOnce({ ...explanation, sourceQuote: '主鍵' });
  render(<CourseStudyPanel scope={scope} courseTitle="資料庫" material={repeated} onClose={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: '啟用 AI 講解本段' }));
  await screen.findByRole('region', { name: '本段 AI 講解' });

  const mark = document.querySelector('mark') as HTMLElement;
  const scroll = vi.fn();
  mark.scrollIntoView = scroll;
  const next = screen.getByRole('button', { name: '下一處相同引句' });
  next.focus();
  fireEvent.click(next);
  await waitFor(() => expect(scroll).toHaveBeenCalledWith({ block: 'nearest' }));
  expect(document.activeElement).toBe(next);
  expect(screen.getByText('相同引句在本段出現 3 處，目前標示第 2 處。')).toBeTruthy();

  const note = screen.getByLabelText('用自己的話記下這一段') as HTMLTextAreaElement;
  fireEvent.change(note, { target: { value: '這處引句仍要保留在畫面上。' } });
  expect(scroll).toHaveBeenCalledTimes(1);
  expect(screen.getByText('相同引句在本段出現 3 處，目前標示第 2 處。')).toBeTruthy();
  expect(mark.textContent).toBe('主鍵');
  expect(mocks.run).toHaveBeenCalledTimes(1);

  fireEvent.click(next);
  await waitFor(() => expect(scroll).toHaveBeenCalledTimes(2));
  expect(document.activeElement).toBe(next);
  expect(screen.getByText('相同引句在本段出現 3 處，目前標示第 3 處。')).toBeTruthy();
});

it('scopes a repeated citation position to its lesson and reading mode', async () => {
  const repeated = { ...material, body: '主鍵在第一段。外鍵可以參照主鍵。最後一段再提主鍵。' };
  mocks.run.mockResolvedValueOnce({ ...explanation, sourceQuote: '主鍵' })
    .mockResolvedValueOnce({ ...explanation, sourceQuote: '外鍵可以參照主鍵。' });
  render(<CourseStudyPanel scope={scope} courseTitle="資料庫" material={repeated} onClose={vi.fn()} />);
  fireEvent.change(screen.getByLabelText('用自己的話記下這一段'),
    { target: { value: '兩種讀法都要保留，不能誤報缺少引句。' } });

  fireEvent.click(screen.getByRole('button', { name: '啟用 AI 講解本段' }));
  await screen.findByRole('region', { name: '本段 AI 講解' });
  fireEvent.change(screen.getByLabelText('這次怎麼讀'), { target: { value: 'exam' } });
  fireEvent.click(screen.getByRole('button', { name: '啟用 AI 講解本段' }));
  await waitFor(() => expect(document.querySelector('mark')?.textContent).toBe('外鍵可以參照主鍵。'));

  fireEvent.change(screen.getByLabelText('這次怎麼讀'), { target: { value: 'understand' } });
  expect(screen.getByText('相同引句在本段出現 3 處，目前標示第 1 處。')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '上一處相同引句' }));
  expect(screen.getByText('相同引句在本段出現 3 處，目前標示第 3 處。')).toBeTruthy();

  // The exam quote appears once. The old index 2 must not be reused to show a false missing-citation error.
  fireEvent.change(screen.getByLabelText('這次怎麼讀'), { target: { value: 'exam' } });
  expect(document.querySelector('mark')?.textContent).toBe('外鍵可以參照主鍵。');
  expect(screen.queryByText('目前無法在原文定位這句引用，請重新講解。')).toBeNull();
  expect(screen.queryByRole('button', { name: '下一處相同引句' })).toBeNull();

  fireEvent.change(screen.getByLabelText('這次怎麼讀'), { target: { value: 'understand' } });
  expect(screen.getByText('相同引句在本段出現 3 處，目前標示第 1 處。')).toBeTruthy();
  expect((screen.getByLabelText('用自己的話記下這一段') as HTMLTextAreaElement).value)
    .toBe('兩種讀法都要保留，不能誤報缺少引句。');
  expect(mocks.run).toHaveBeenCalledTimes(2);
});

it('keeps reading available when the browser cannot run a model', () => {
  mocks.available = false;
  render(<CourseStudyPanel scope={scope} courseTitle="資料庫" material={material} onClose={vi.fn()} />);
  expect(screen.getByText(material.body)).toBeTruthy();
  expect(screen.getByRole('button', { name: '啟用 AI 講解本段' }).hasAttribute('disabled')).toBe(true);
  expect(mocks.run).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('用自己的話記下這一段'), { target: { value: '先用學號理解主鍵。' } });
  fireEvent.click(screen.getByRole('button', { name: '加入待複習' }));
  expect(screen.getByRole('region', { name: '待複習段落' })).toBeTruthy();
});

it('rechecks device AI availability without launching a model or losing an offline note', async () => {
  mocks.available = false;
  render(<CourseStudyPanel scope={scope} courseTitle="資料庫" material={material} onClose={vi.fn()} />);
  const note = screen.getByLabelText('用自己的話記下這一段') as HTMLTextAreaElement;
  fireEvent.change(note, { target: { value: 'WebGPU 尚不可用時先記下主鍵定義。' } });
  const explain = screen.getByRole('button', { name: '啟用 AI 講解本段' });
  const recheck = screen.getByRole('button', { name: '重新檢查裝置端 AI 支援' });
  expect(explain.hasAttribute('disabled')).toBe(true);
  fireEvent.click(recheck);
  expect(explain.hasAttribute('disabled')).toBe(true);
  expect(screen.getByText(/重新檢查後仍無法使用裝置端 AI/)).toBeTruthy();
  expect(mocks.run).not.toHaveBeenCalled();
  mocks.available = true;
  fireEvent.click(recheck);
  expect(explain.hasAttribute('disabled')).toBe(false);
  expect(screen.getByText(/尚未下載或驗證模型/)).toBeTruthy();
  expect(note.value).toBe('WebGPU 尚不可用時先記下主鍵定義。');
  expect(mocks.run).not.toHaveBeenCalled();
  fireEvent.click(explain);
  expect(await screen.findByRole('region', { name: '本段 AI 講解' })).toBeTruthy();
  expect(mocks.run).toHaveBeenCalledTimes(1);
});

it('offers capability recheck after a worker failure without silently retrying or removing notes', async () => {
  mocks.run.mockRejectedValueOnce(new Error('本機模型啟動失敗'));
  render(<CourseStudyPanel scope={scope} courseTitle="資料庫" material={material} onClose={vi.fn()} />);
  const note = screen.getByLabelText('用自己的話記下這一段') as HTMLTextAreaElement;
  fireEvent.change(note, { target: { value: '錯誤發生前記下的筆記' } });
  fireEvent.click(screen.getByRole('button', { name: '啟用 AI 講解本段' }));
  expect(await screen.findByText('本機模型啟動失敗')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '重新檢查裝置端 AI 支援' }));
  expect(mocks.run).toHaveBeenCalledTimes(1);
  expect(screen.getByText(/尚未下載或驗證模型/)).toBeTruthy();
  expect(note.value).toBe('錯誤發生前記下的筆記');
  fireEvent.click(screen.getByRole('button', { name: '啟用 AI 講解本段' }));
  expect(await screen.findByRole('region', { name: '本段 AI 講解' })).toBeTruthy();
  expect(mocks.run).toHaveBeenCalledTimes(2);
});

it('closes an untouched board without an unnecessary confirmation', () => {
  const onClose = vi.fn();
  render(<CourseStudyPanel scope={scope} courseTitle="資料庫" material={material} onClose={onClose} />);
  fireEvent.click(screen.getByRole('button', { name: '收起白板' }));
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('heading', { name: '要關閉讀書白板嗎？' })).toBeNull();
});


it('warns before page unload only while an unexported note or pasted backup is present', () => {
  const { unmount } = render(<CourseStudyPanel scope={scope} courseTitle="資料庫" material={material} onClose={vi.fn()} />);
  const wouldWarn = () => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  };
  expect(wouldWarn()).toBe(false);
  const note = screen.getByLabelText('用自己的話記下這一段') as HTMLTextAreaElement;
  // Whitespace-only drafts still represent a learner edit, even if not exported as a note.
  fireEvent.change(note, { target: { value: '  ' } });
  expect(wouldWarn()).toBe(true);
  fireEvent.change(note, { target: { value: '' } });
  expect(wouldWarn()).toBe(false);
  const backup = screen.getByLabelText('貼上已備份的進度 JSON') as HTMLTextAreaElement;
  fireEvent.change(backup, { target: { value: '{"unfinished":true}' } });
  expect(wouldWarn()).toBe(true);
  fireEvent.change(backup, { target: { value: '' } });
  expect(wouldWarn()).toBe(false);
  unmount();
  expect(wouldWarn()).toBe(false);
});

it('protects a changed reading position on unload and before replacing the source, even without notes', async () => {
  const longMaterial = { ...material, body: `${'甲'.repeat(1600)}${'乙'.repeat(1600)}${'丙'.repeat(100)}` };
  render(<CourseStudyPanel scope={scope} courseTitle="資料庫" material={longMaterial} onClose={vi.fn()} />);
  const wouldWarn = () => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  };
  expect(wouldWarn()).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: '下一段' }));
  expect(wouldWarn()).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '收起白板' }));
  expect(screen.getByRole('heading', { name: '要關閉讀書白板嗎？' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '繼續讀書' }));
  const input = screen.getByLabelText('選擇講義') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(['新章節'], '另一份講義.txt', { type: 'text/plain' })] } });
  expect(await screen.findByRole('heading', { name: '要改讀另一份教材嗎？' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '保留原本的學習內容' }));
  expect(wouldWarn()).toBe(true);
  expect(screen.getByRole('group', { name: /目前閱讀段落/ }).textContent).toContain('第 2 段');
  expect(mocks.run).not.toHaveBeenCalled();
});

it('protects a not-yet-imported pasted draft from mobile close and explains backup limits', () => {
  const onClose = vi.fn();
  render(<CourseStudyPanel scope={scope} courseTitle="資料庫" onClose={onClose} />);
  const pasted = screen.getByLabelText('或貼上課文與筆記') as HTMLTextAreaElement;
  fireEvent.change(pasted, { target: { value: '還沒按開始讀的講義草稿，不該因誤觸關閉消失。' } });
  fireEvent.click(screen.getByRole('button', { name: '收起白板' }));
  expect(onClose).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(screen.getByRole('heading', { name: '要關閉讀書白板嗎？' }));
  expect(screen.getByText(/尚未加入白板的貼上文字不包含在閱讀或練習進度備份中/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '繼續讀書' }));
  expect(pasted.value).toBe('還沒按開始讀的講義草稿，不該因誤觸關閉消失。');
  expect(onClose).not.toHaveBeenCalled();
  expect(mocks.run).not.toHaveBeenCalled();
  fireEvent.change(pasted, { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: '收起白板' }));
  expect(onClose).toHaveBeenCalledTimes(1);
});

it('rejects oversized pasted lessons before storing them without erasing an earlier draft or notes', () => {
  render(<CourseStudyPanel scope={scope} courseTitle="資料庫" material={material} onClose={vi.fn()} />);
  const pasted = screen.getByLabelText('或貼上課文與筆記') as HTMLTextAreaElement;
  const note = screen.getByLabelText('用自己的話記下這一段') as HTMLTextAreaElement;
  fireEvent.change(note, { target: { value: '尚未保存的課堂筆記' } });
  fireEvent.change(pasted, { target: { value: '先前輸入的教材草稿' } });
  fireEvent.change(pasted, { target: { value: '甲'.repeat(60_001) } });
  expect(pasted.value).toBe('先前輸入的教材草稿');
  expect(screen.getByRole('alert').textContent).toContain('貼上的教材超過 60,000 字元');
  expect(note.value).toBe('尚未保存的課堂筆記');
  expect(screen.getByText(material.body)).toBeTruthy();
  fireEvent.change(pasted, { target: { value: '乙'.repeat(60_000) } });
  expect(pasted.value).toHaveLength(60_000);
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByRole('button', { name: '開始讀這份內容' }).hasAttribute('disabled')).toBe(false);
});

it('rejects a definitely oversized UTF-8 lesson file before decoding, retaining the current note', async () => {
  render(<CourseStudyPanel scope={scope} courseTitle="資料庫" material={material} onClose={vi.fn()} />);
  const note = screen.getByLabelText('用自己的話記下這一段') as HTMLTextAreaElement;
  fireEvent.change(note, { target: { value: '原教材尚未備份的筆記' } });
  // 60,002 three-byte characters exceed the largest UTF-8 representation of 60,000 UTF-16 units.
  const text = '字'.repeat(60_002);
  const file = new File([text], '大份講義.md', { type: 'text/markdown' });
  const read = vi.fn().mockResolvedValue(text);
  Object.defineProperty(file, 'text', { value: read });
  fireEvent.change(screen.getByLabelText('選擇講義'), { target: { files: [file] } });
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('尚未載入內容'));
  expect(read).not.toHaveBeenCalled();
  expect(note.value).toBe('原教材尚未備份的筆記');
  expect(screen.getByText(material.body)).toBeTruthy();
  expect(mocks.run).not.toHaveBeenCalled();
});

it('allows a valid 60,000-character multibyte lesson through file preflight', async () => {
  render(<CourseStudyPanel scope={scope} courseTitle="資料庫" onClose={vi.fn()} />);
  const content = '中'.repeat(60_000);
  const file = new File([content], '中文講義.txt', { type: 'text/plain' });
  const read = vi.fn().mockResolvedValue(content);
  Object.defineProperty(file, 'text', { value: read });
  expect(file.size).toBe(180_000);
  fireEvent.change(screen.getByLabelText('選擇講義'), { target: { files: [file] } });
  await waitFor(() => expect(read).toHaveBeenCalledOnce());
  expect(await screen.findByText('中'.repeat(1_600))).toBeTruthy();
  expect(screen.getByRole('button', { name: '下一段' }).hasAttribute('disabled')).toBe(false);
  expect(screen.queryByRole('alert')).toBeNull();
});

it('imports a legacy Big5 TXT when explicitly selected without corrupting Traditional Chinese', async () => {
  render(<CourseStudyPanel scope={scope} courseTitle="資料庫" onClose={vi.fn()} />);
  fireEvent.change(screen.getByLabelText('TXT／Markdown 文字編碼'), { target: { value: 'big5' } });
  // Big5 for 中文主鍵; this is intentionally not valid UTF-8.
  const bytes = Uint8Array.from([0xa4, 0xa4, 0xa4, 0xe5, 0xa5, 0x44, 0xc1, 0xe4]);
  const file = new File([bytes], '舊版筆記.txt', { type: 'text/plain' });
  const readBytes = vi.fn().mockResolvedValue(bytes.buffer);
  const readUtf8 = vi.fn();
  Object.defineProperty(file, 'arrayBuffer', { value: readBytes });
  Object.defineProperty(file, 'text', { value: readUtf8 });
  fireEvent.change(screen.getByLabelText('選擇講義'), { target: { files: [file] } });
  expect(await screen.findByText('中文主鍵')).toBeTruthy();
  expect(readBytes).toHaveBeenCalledOnce();
  expect(readUtf8).not.toHaveBeenCalled();
  expect(mocks.run).not.toHaveBeenCalled();
});

it('rejects malformed Big5 instead of silently losing characters or replacing existing notes', async () => {
  render(<CourseStudyPanel scope={scope} courseTitle="資料庫" material={material} onClose={vi.fn()} />);
  const note = screen.getByLabelText('用自己的話記下這一段') as HTMLTextAreaElement;
  fireEvent.change(note, { target: { value: '原來的筆記不能被亂碼覆蓋' } });
  fireEvent.change(screen.getByLabelText('TXT／Markdown 文字編碼'), { target: { value: 'big5' } });
  const file = new File([Uint8Array.from([0x81])], '損壞的筆記.md', { type: 'text/markdown' });
  Object.defineProperty(file, 'arrayBuffer', { value: vi.fn().mockResolvedValue(Uint8Array.from([0x81]).buffer) });
  fireEvent.change(screen.getByLabelText('選擇講義'), { target: { files: [file] } });
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('無法以繁體中文 Big5 讀取'));
  expect(note.value).toBe('原來的筆記不能被亂碼覆蓋');
  expect(screen.getByText(material.body)).toBeTruthy();
  expect(screen.queryByRole('heading', { name: '要改讀另一份教材嗎？' })).toBeNull();
  expect(mocks.run).not.toHaveBeenCalled();
});

it('rejects malformed UTF-8 textbook bytes without replacing an existing note or lesson', async () => {
  render(<CourseStudyPanel scope={scope} courseTitle="資料庫" material={material} onClose={vi.fn()} />);
  const note = screen.getByLabelText('用自己的話記下這一段') as HTMLTextAreaElement;
  fireEvent.change(note, { target: { value: '保留原先的私有筆記' } });
  const bytes = Uint8Array.from([0xe4, 0xb8, 0xad, 0xff, 0xe6, 0x96, 0x87]);
  const file = new File([bytes], '損壞的講義.txt', { type: 'text/plain' });
  const readBytes = vi.fn().mockResolvedValue(bytes.buffer);
  Object.defineProperty(file, 'text', { value: vi.fn().mockResolvedValue('中�文') });
  Object.defineProperty(file, 'arrayBuffer', { value: readBytes });
  fireEvent.change(screen.getByLabelText('選擇講義'), { target: { files: [file] } });
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('無法解碼的 UTF-8 位元組'));
  expect(readBytes).toHaveBeenCalledOnce();
  expect(note.value).toBe('保留原先的私有筆記');
  expect(screen.getByText(material.body)).toBeTruthy();
  expect(screen.queryByRole('heading', { name: '要改讀另一份教材嗎？' })).toBeNull();
});

it('does not mistake a literal valid Unicode replacement glyph for a corrupted UTF-8 file', async () => {
  render(<CourseStudyPanel scope={scope} courseTitle="資料庫" onClose={vi.fn()} />);
  const content = '這份教材本來就包含替代字元�，應保留原文。';
  const bytes = new TextEncoder().encode(content);
  const file = new File([bytes], '合法字元.md', { type: 'text/markdown' });
  const readBytes = vi.fn().mockResolvedValue(bytes.buffer);
  Object.defineProperty(file, 'text', { value: vi.fn().mockResolvedValue(content) });
  Object.defineProperty(file, 'arrayBuffer', { value: readBytes });
  fireEvent.change(screen.getByLabelText('選擇講義'), { target: { files: [file] } });
  expect(await screen.findByText(content)).toBeTruthy();
  expect(readBytes).toHaveBeenCalledOnce();
  expect(screen.queryByRole('alert')).toBeNull();
});

it('rejects malformed UTF-8 progress bytes before offering restore, preserving private notes', async () => {
  render(<CourseStudyPanel scope={scope} courseTitle="資料庫" material={material} onClose={vi.fn()} />);
  const note = screen.getByLabelText('用自己的話記下這一段') as HTMLTextAreaElement;
  fireEvent.change(note, { target: { value: '未備份的原筆記' } });
  fireEvent.click(screen.getByText('接著上次的進度'));
  const bytes = Uint8Array.from([0x7b, 0x22, 0x61, 0x22, 0x3a, 0x22, 0xff, 0x22, 0x7d]);
  const file = new File([bytes], '上次進度.json', { type: 'application/json' });
  Object.defineProperty(file, 'text', { value: vi.fn().mockResolvedValue('{"a":"�"}') });
  Object.defineProperty(file, 'arrayBuffer', { value: vi.fn().mockResolvedValue(bytes.buffer) });
  fireEvent.change(screen.getByLabelText('載入閱讀進度檔'), { target: { files: [file] } });
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('進度備份含有無法解碼的 UTF-8 位元組'));
  expect(screen.queryByRole('region', { name: '閱讀進度預覽' })).toBeNull();
  expect(note.value).toBe('未備份的原筆記');
  expect(screen.getByText(material.body)).toBeTruthy();
});

it('invalidates a pending lesson replacement when an oversized pasted edit is rejected', () => {
  render(<CourseStudyPanel scope={scope} courseTitle="資料庫" material={material} onClose={vi.fn()} />);
  fireEvent.change(screen.getByLabelText('用自己的話記下這一段'), {
    target: { value: '原教材的私人筆記' },
  });
  const pasted = screen.getByLabelText('或貼上課文與筆記') as HTMLTextAreaElement;
  fireEvent.change(pasted, { target: { value: '另一份教材草稿' } });
  fireEvent.click(screen.getByRole('button', { name: '開始讀這份內容' }));
  expect(screen.getByRole('heading', { name: '要改讀另一份教材嗎？' })).toBeTruthy();
  fireEvent.change(pasted, { target: { value: '😀'.repeat(30_001) } });
  expect(screen.queryByRole('heading', { name: '要改讀另一份教材嗎？' })).toBeNull();
  expect(pasted.value).toBe('另一份教材草稿');
  expect(screen.getByText(material.body)).toBeTruthy();
  expect((screen.getByLabelText('用自己的話記下這一段') as HTMLTextAreaElement).value)
    .toBe('原教材的私人筆記');
  fireEvent.click(screen.getByRole('button', { name: '開始讀這份內容' }));
  expect(screen.getByRole('heading', { name: '要改讀另一份教材嗎？' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '保留原本的學習內容' }));
  expect(screen.getByText(material.body)).toBeTruthy();
});

it('also guards pasted text on top of an existing course material without silently saving it', () => {
  const onClose = vi.fn();
  render(<CourseStudyPanel scope={scope} courseTitle="資料庫" material={material} onClose={onClose} />);
  const pasted = screen.getByLabelText('或貼上課文與筆記') as HTMLTextAreaElement;
  fireEvent.change(pasted, { target: { value: '這段還沒有正式換成新的教材。' } });
  fireEvent.click(screen.getByRole('button', { name: '收起白板' }));
  expect(onClose).not.toHaveBeenCalled();
  expect(screen.getByText(/加入新教材會取代目前的閱讀內容/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '繼續讀書' }));
  expect(pasted.value).toBe('這段還沒有正式換成新的教材。');
  expect(screen.getByText(material.body)).toBeTruthy();
});

it('protects unsent question drafts and notes from accidental close, with a keyboard focus return', () => {
  const onClose = vi.fn();
  render(<CourseStudyPanel scope={scope} courseTitle="資料庫" material={material} onClose={onClose} />);
  fireEvent.change(screen.getByLabelText('卡在哪裡？也可以直接開始講解'), {
    target: { value: '先記著這個問題，不要因為手機誤觸消失。' },
  });
  fireEvent.click(screen.getByRole('button', { name: '收起白板' }));
  expect(onClose).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(screen.getByRole('heading', { name: '要關閉讀書白板嗎？' }));
  fireEvent.click(screen.getByRole('button', { name: '繼續讀書' }));
  expect(onClose).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: '收起白板' }));
  expect((screen.getByLabelText('卡在哪裡？也可以直接開始講解') as HTMLTextAreaElement).value)
    .toBe('先記著這個問題，不要因為手機誤觸消失。');
  fireEvent.change(screen.getByLabelText('用自己的話記下這一段'), {
    target: { value: '保留本次原文筆記' },
  });
  fireEvent.click(screen.getByRole('button', { name: '收起白板' }));
  expect((screen.getByLabelText('用自己的話記下這一段') as HTMLTextAreaElement).value)
    .toBe('保留本次原文筆記');
  fireEvent.click(screen.getByRole('button', { name: '確認關閉白板' }));
  expect(onClose).toHaveBeenCalledTimes(1);
});

it('warns before closing an active practice round, preserving the answer if cancelled', async () => {
  const onClose = vi.fn();
  render(<CourseStudyPanel scope={scope} courseTitle="資料庫" material={material} onClose={onClose} />);
  fireEvent.click(screen.getByRole('button', { name: '加入待複習' }));
  await generate();
  fireEvent.click(screen.getByRole('button', { name: '開始逐題複習' }));
  fireEvent.change(screen.getByLabelText('這一題，我的回答'), {
    target: { value: '這是本輪還沒有備份的草稿。' },
  });
  fireEvent.click(screen.getByRole('button', { name: '收起白板' }));
  expect(onClose).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: '儲存練習與閱讀進度' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '繼續讀書' }));
  expect((screen.getByLabelText('這一題，我的回答') as HTMLTextAreaElement).value)
    .toBe('這是本輪還沒有備份的草稿。');
  expect(screen.getByRole('heading', { name: '第 1 題' })).toBeTruthy();
  expect(onClose).not.toHaveBeenCalled();
});

it('aborts a previous passage and ignores a late model response after navigation', async () => {
  let finish!: (value: TutorExplanation) => void;
  mocks.run.mockImplementation(() => new Promise<TutorExplanation>((resolve) => { finish = resolve; }));
  render(<CourseStudyPanel scope={scope} courseTitle="資料庫" material={{ ...material, body: `${'甲'.repeat(1600)}乙` }} onClose={vi.fn()} />);
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
  const view = render(<CourseStudyPanel scope={scope} courseTitle="資料庫" material={material} onClose={vi.fn()} />);
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
  render(<CourseStudyPanel scope={scope} courseTitle="資料庫" onClose={vi.fn()} />);
  fireEvent.change(screen.getByLabelText('選擇講義'), { target: { files: [new File(['pdf'], '複習.pdf', { type: 'application/pdf' })] } });
  expect(await screen.findByText('交易要符合 ACID。')).toBeTruthy();
  expect(screen.getByRole('option', { name: '第 2 頁' })).toBeTruthy();
  expect(screen.queryByRole('option', { name: '第 1 頁' })).toBeNull();
  fireEvent.click(screen.getByText(/來源注意事項/));
  expect(screen.getAllByText(/第 1 頁/).length).toBeGreaterThan(0);
  expect(mocks.run).not.toHaveBeenCalled();
});


it('moves between real PDF pages with next/previous while keeping the original note and cancelling a late response', async () => {
  let finish!: (value: TutorExplanation) => void;
  mocks.run.mockImplementationOnce(() => new Promise<TutorExplanation>((resolve) => { finish = resolve; }));
  const firstPage = '主鍵用來唯一識別一筆資料，不能重複或為空值。';
  const secondPage = '交易失敗時，要把整組操作復原。';
  mocks.read.mockResolvedValueOnce({ format: 'pdf', name: '跨頁講義.pdf', warnings: [], sections: [
    { id: 'page-2', label: '第 2 頁', rows: [{ line: 1, cells: [firstPage] }], needsOcr: false, warnings: [] },
    { id: 'page-5', label: '第 5 頁', rows: [{ line: 1, cells: [secondPage] }], needsOcr: false, warnings: [] },
  ] });
  render(<CourseStudyPanel scope={scope} courseTitle="資料庫" onClose={vi.fn()} />);
  fireEvent.change(screen.getByLabelText('選擇講義'), {
    target: { files: [new File(['test'], '跨頁講義.pdf', { type: 'application/pdf' })] },
  });
  expect(await screen.findByText(firstPage)).toBeTruthy();
  expect(screen.getByRole('button', { name: '上一段' }).hasAttribute('disabled')).toBe(true);
  expect(screen.getByRole('button', { name: '下一段' }).hasAttribute('disabled')).toBe(false);
  fireEvent.change(screen.getByLabelText('用自己的話記下這一段'), {
    target: { value: '第一頁的專屬筆記' },
  });
  fireEvent.click(screen.getByRole('button', { name: '啟用 AI 講解本段' }));
  const signal = mocks.run.mock.calls[0][0].signal as AbortSignal;
  fireEvent.click(screen.getByRole('button', { name: '下一段' }));
  expect(signal.aborted).toBe(true);
  expect(await screen.findByText(secondPage)).toBeTruthy();
  expect((screen.getByLabelText('閱讀範圍') as HTMLSelectElement).value).toBe('1');
  expect(screen.getByRole('button', { name: '下一段' }).hasAttribute('disabled')).toBe(true);
  expect(screen.getByRole('button', { name: '上一段' }).hasAttribute('disabled')).toBe(false);
  expect((screen.getByLabelText('用自己的話記下這一段') as HTMLTextAreaElement).value).toBe('');
  fireEvent.change(screen.getByLabelText('這次怎麼讀'), { target: { value: 'exam' } });
  await act(async () => finish(explanation));
  expect(screen.queryByRole('region', { name: '本段 AI 講解' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '上一段' }));
  expect(screen.getByText(firstPage)).toBeTruthy();
  expect((screen.getByLabelText('閱讀範圍') as HTMLSelectElement).value).toBe('0');
  expect((screen.getByLabelText('這次怎麼讀') as HTMLSelectElement).value).toBe('exam');
  expect((screen.getByLabelText('用自己的話記下這一段') as HTMLTextAreaElement).value).toBe('第一頁的專屬筆記');
  expect(mocks.run).toHaveBeenCalledTimes(1);
});

it('ignores a cancelled file read and does not leak its content into a later selection', async () => {
  let finish!: (value: unknown) => void;
  mocks.read.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  render(<CourseStudyPanel scope={scope} courseTitle="資料庫" onClose={vi.fn()} />);
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
  render(<CourseStudyPanel scope={scope} courseTitle="資料庫" material={{ ...material, body: '<img src=x onerror=alert(1)> https://example.test/private.pdf' }} onClose={vi.fn()} />);
  expect(document.querySelector('img')).toBeNull();
  expect(mocks.read).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '啟用 AI 講解本段' }));
  await waitFor(() => expect(mocks.run).toHaveBeenCalledTimes(1));
});

it('rejects an oversized first paste instead of storing 60,001 characters in React state', () => {
  render(<CourseStudyPanel scope={scope} courseTitle="資料庫" onClose={vi.fn()} />);
  const input = screen.getByLabelText('或貼上課文與筆記') as HTMLTextAreaElement;
  fireEvent.change(input, { target: { value: '字'.repeat(60001) } });
  expect(input.value).toBe('');
  expect(screen.getByRole('button', { name: '開始讀這份內容' }).hasAttribute('disabled')).toBe(true);
  expect(screen.getByRole('alert').textContent).toContain('未加入白板');
  expect(screen.getByText('0 / 60,000 字元')).toBeTruthy();
});

it('keeps the earlier valid draft after rejecting a longer paste and explains which draft would open', () => {
  render(<CourseStudyPanel scope={scope} courseTitle="資料庫" onClose={vi.fn()} />);
  const input = screen.getByLabelText('或貼上課文與筆記') as HTMLTextAreaElement;
  const earlierDraft = '資料庫第一章：主鍵不能重複。';
  fireEvent.change(input, { target: { value: earlierDraft } });
  expect(input.value).toBe(earlierDraft);
  fireEvent.change(input, { target: { value: '字'.repeat(60001) } });
  expect(input.value).toBe(earlierDraft);
  expect(screen.getByRole('alert').textContent).toContain('會讀取原草稿');
  const start = screen.getByRole('button', { name: '開始讀這份內容' });
  expect(start.hasAttribute('disabled')).toBe(false);
  fireEvent.click(start);
  expect(screen.getByText(earlierDraft)).toBeTruthy();
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
  render(<CourseStudyPanel scope={scope} courseTitle="資料庫" material={{ ...material, body: `${material.body.padEnd(1600, '甲')}乙` }} onClose={vi.fn()} />);
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
  render(<CourseStudyPanel scope={scope} courseTitle="資料庫" material={material} onClose={vi.fn()} />);
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
  render(<CourseStudyPanel scope={scope} courseTitle="資料庫" material={material} onClose={vi.fn()} />);
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
  render(<CourseStudyPanel scope={scope} courseTitle="資料庫" material={material} onClose={vi.fn()} />);
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
  render(<CourseStudyPanel scope={scope} courseTitle="資料庫" material={material} onClose={vi.fn()} />);
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
  render(<CourseStudyPanel scope={scope} courseTitle="資料庫" material={material} onClose={vi.fn()} />);
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
  render(<CourseStudyPanel scope={scope} courseTitle="資料庫" onClose={vi.fn()} />);
  const upload = () => fireEvent.change(screen.getByLabelText('選擇講義'), { target: { files: [new File(['pdf'], '筆記.pdf')] } });
  upload();
  await screen.findByText(material.body);
  await generate();
  fireEvent.change(screen.getByLabelText(noteLabel), { target: { value: '舊教材的私有筆記' } });
  fireEvent.change(screen.getByLabelText(questionLabel), { target: { value: '舊教材的問題' } });
  fireEvent.click(screen.getByRole('button', { name: '加入待複習' }));
  upload();
  expect(await screen.findByRole('heading', { name: '要改讀另一份教材嗎？' })).toBeTruthy();
  expect(inputValue(noteLabel)).toBe('舊教材的私有筆記');
  expect(screen.queryByText('新的一份檔案，主題是交易。')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '確認改讀新教材' }));
  await screen.findByText('新的一份檔案，主題是交易。');
  expect(inputValue(noteLabel)).toBe('');
  expect(inputValue(questionLabel)).toBe('');
  expect(screen.queryByRole('region', { name: '待複習段落' })).toBeNull();
  expect(screen.queryByRole('region', { name: '本段 AI 講解' })).toBeNull();
  expect(screen.queryByLabelText('這一段的講解記錄')).toBeNull();
});

it('cancels a successful local file replacement without losing the study draft or source', async () => {
  render(<CourseStudyPanel scope={scope} courseTitle="資料庫" material={material} onClose={vi.fn()} />);
  fireEvent.change(screen.getByLabelText(noteLabel), { target: { value: '保留這份資料庫筆記' } });
  fireEvent.change(screen.getByLabelText(questionLabel), { target: { value: '未送出的問題也要保留' } });
  const input = screen.getByLabelText('選擇講義') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(['交易必須一致。'], '其他講義.txt', { type: 'text/plain' })] } });
  expect(await screen.findByRole('heading', { name: '要改讀另一份教材嗎？' })).toBeTruthy();
  expect(document.activeElement).toBe(screen.getByRole('heading', { name: '要改讀另一份教材嗎？' }));
  expect(inputValue(noteLabel)).toBe('保留這份資料庫筆記');
  expect(screen.queryByText('交易必須一致。')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '保留原本的學習內容' }));
  // The imported lesson keeps its upload details collapsed; the file input
  // is hidden and cannot be the keyboard/screen-reader return destination.
  expect(document.activeElement).toBe(screen.getByText('換一份講義或貼上內容'));
  expect(screen.getByText(material.body)).toBeTruthy();
  expect(inputValue(noteLabel)).toBe('保留這份資料庫筆記');
  expect(inputValue(questionLabel)).toBe('未送出的問題也要保留');
  expect(mocks.run).not.toHaveBeenCalled();
});

it('returns focus to the visible file picker when cancelling a replacement from expanded import details', async () => {
  render(<CourseStudyPanel scope={scope} courseTitle="資料庫" material={material} onClose={vi.fn()} />);
  fireEvent.change(screen.getByLabelText(noteLabel), { target: { value: '還沒備份的筆記' } });
  const summary = screen.getByText('換一份講義或貼上內容');
  fireEvent.click(summary);
  expect(summary.closest('details')?.hasAttribute('open')).toBe(true);
  const input = screen.getByLabelText('選擇講義') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(['新的例題'], '例題.txt', { type: 'text/plain' })] } });
  expect(await screen.findByRole('heading', { name: '要改讀另一份教材嗎？' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '保留原本的學習內容' }));
  expect(document.activeElement).toBe(input);
  expect(screen.getByText(material.body)).toBeTruthy();
  expect(inputValue(noteLabel)).toBe('還沒備份的筆記');
});

it('requires explicit confirmation before pasted text replaces a practice, and cancels without losing the answer', async () => {
  render(<CourseStudyPanel scope={scope} courseTitle="資料庫" material={material} onClose={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: '加入待複習' }));
  await generate();
  fireEvent.click(screen.getByRole('button', { name: '開始逐題複習' }));
  fireEvent.change(screen.getByLabelText('這一題，我的回答'), { target: { value: '未保存的本輪回答' } });
  const pasted = screen.getByLabelText('或貼上課文與筆記') as HTMLTextAreaElement;
  fireEvent.change(pasted, { target: { value: '下一份教材的內容' } });
  fireEvent.click(screen.getByRole('button', { name: '開始讀這份內容' }));
  expect(screen.getByRole('heading', { name: '要改讀另一份教材嗎？' })).toBeTruthy();
  expect((screen.getByLabelText('這一題，我的回答') as HTMLTextAreaElement).value).toBe('未保存的本輪回答');
  fireEvent.click(screen.getByRole('button', { name: '保留原本的學習內容' }));
  expect(pasted.value).toBe('下一份教材的內容');
  expect(screen.getByRole('heading', { name: '第 1 題' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '開始讀這份內容' }));
  fireEvent.click(screen.getByRole('button', { name: '確認改讀新教材' }));
  expect(screen.getByText('下一份教材的內容')).toBeTruthy();
  expect(screen.queryByRole('heading', { name: '第 1 題' })).toBeNull();
  expect(pasted.value).toBe('');
});

it('keeps a pasted but unconfirmed progress backup until the learner accepts a different source', () => {
  render(<CourseStudyPanel scope={scope} courseTitle="資料庫" material={material} onClose={vi.fn()} />);
  fireEvent.click(screen.getByText('接著上次的進度'));
  const progress = screen.getByLabelText('貼上已備份的進度 JSON') as HTMLTextAreaElement;
  fireEvent.change(progress, { target: { value: '{"unfinished":"keep this JSON"}' } });
  const pastedSource = screen.getByLabelText('或貼上課文與筆記') as HTMLTextAreaElement;
  fireEvent.change(pastedSource, { target: { value: '下一份教材的文字' } });
  fireEvent.click(screen.getByRole('button', { name: '開始讀這份內容' }));
  expect(screen.getByRole('heading', { name: '要改讀另一份教材嗎？' })).toBeTruthy();
  expect(screen.getByText(/尚未確認還原的進度 JSON 也會被清除/)).toBeTruthy();
  expect(screen.getByText(material.body)).toBeTruthy();
  expect(progress.value).toBe('{"unfinished":"keep this JSON"}');
  fireEvent.click(screen.getByRole('button', { name: '保留原本的學習內容' }));
  expect(progress.value).toBe('{"unfinished":"keep this JSON"}');
  expect(pastedSource.value).toBe('下一份教材的文字');
  fireEvent.click(screen.getByRole('button', { name: '開始讀這份內容' }));
  fireEvent.click(screen.getByRole('button', { name: '確認改讀新教材' }));
  expect(screen.getByText('下一份教材的文字')).toBeTruthy();
  expect(progress.value).toBe('');
  expect(mocks.run).not.toHaveBeenCalled();
});

it('cancels stale source replacement approval when an unconfirmed backup is edited or rejected', () => {
  render(<CourseStudyPanel scope={scope} courseTitle="資料庫" material={material} onClose={vi.fn()} />);
  fireEvent.change(screen.getByLabelText(noteLabel), { target: { value: '仍在整理的私人筆記' } });
  fireEvent.click(screen.getByText('接著上次的進度'));
  const progress = screen.getByLabelText('貼上已備份的進度 JSON') as HTMLTextAreaElement;
  const source = screen.getByLabelText('或貼上課文與筆記') as HTMLTextAreaElement;
  fireEvent.change(progress, { target: { value: '{"draft":"first"}' } });
  fireEvent.change(source, { target: { value: '尚未確認的新教材' } });
  fireEvent.click(screen.getByRole('button', { name: '開始讀這份內容' }));
  expect(screen.getByRole('heading', { name: '要改讀另一份教材嗎？' })).toBeTruthy();

  // The previous approval must not dispose of a newer backup draft.
  fireEvent.change(progress, { target: { value: '{"draft":"second"}' } });
  expect(screen.queryByRole('button', { name: '確認改讀新教材' })).toBeNull();
  expect(progress.value).toBe('{"draft":"second"}');
  expect(screen.getByText(material.body)).toBeTruthy();
  expect(inputValue(noteLabel)).toBe('仍在整理的私人筆記');

  fireEvent.click(screen.getByRole('button', { name: '開始讀這份內容' }));
  expect(screen.getByRole('button', { name: '確認改讀新教材' })).toBeTruthy();
  // A rejected oversize paste is still an attempted backup edit, so it
  // must invalidate approval while preserving the last accepted backup.
  fireEvent.change(progress, { target: { value: 'x'.repeat(COURSE_STUDY_PROGRESS_LIMITS.bytes + 1) } });
  expect(screen.queryByRole('button', { name: '確認改讀新教材' })).toBeNull();
  expect(progress.value).toBe('{"draft":"second"}');
  expect(screen.getByRole('alert').textContent).toContain('超過 8 MiB');
  expect(screen.getByText(material.body)).toBeTruthy();
  expect(inputValue(noteLabel)).toBe('仍在整理的私人筆記');
  expect(mocks.run).not.toHaveBeenCalled();
});

it('protects a pasted progress draft when importing the first local file', async () => {
  render(<CourseStudyPanel scope={scope} courseTitle="資料庫" onClose={vi.fn()} />);
  fireEvent.click(screen.getByText('接著上次的進度'));
  const progress = screen.getByLabelText('貼上已備份的進度 JSON') as HTMLTextAreaElement;
  fireEvent.change(progress, { target: { value: '{"incomplete":true}' } });
  fireEvent.change(screen.getByLabelText('選擇講義'), {
    target: { files: [new File(['剛選的教材內容'], '新教材.txt', { type: 'text/plain' })] },
  });
  expect(await screen.findByRole('heading', { name: '要改讀另一份教材嗎？' })).toBeTruthy();
  expect(screen.queryByText('剛選的教材內容')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '保留原本的學習內容' }));
  expect(progress.value).toBe('{"incomplete":true}');
  fireEvent.change(screen.getByLabelText('選擇講義'), {
    target: { files: [new File(['剛選的教材內容'], '新教材.txt', { type: 'text/plain' })] },
  });
  expect(await screen.findByRole('heading', { name: '要改讀另一份教材嗎？' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '確認改讀新教材' }));
  expect(screen.getByText('剛選的教材內容')).toBeTruthy();
  expect(progress.value).toBe('');
});

it('keeps a fresh untouched source replacement direct without extra confirmation', async () => {
  render(<CourseStudyPanel scope={scope} courseTitle="資料庫" material={material} onClose={vi.fn()} />);
  fireEvent.change(screen.getByLabelText('或貼上課文與筆記'), { target: { value: '直接改讀新的講義內容' } });
  fireEvent.click(screen.getByRole('button', { name: '開始讀這份內容' }));
  expect(screen.queryByRole('heading', { name: '要改讀另一份教材嗎？' })).toBeNull();
  expect(screen.getByText('直接改讀新的講義內容')).toBeTruthy();
  expect((screen.getByLabelText('或貼上課文與筆記') as HTMLTextAreaElement).value).toBe('');
});

it('keeps the existing notes if replacing the source fails or is cancelled', async () => {
  render(<CourseStudyPanel scope={scope} courseTitle="資料庫" material={material} onClose={vi.fn()} />);
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

it('returns to the progress picker after cancelling a pending file read and ignores its late result', async () => {
  let finish!: (value: string) => void;
  render(<CourseStudyPanel scope={scope} courseTitle="資料庫" material={material} onClose={vi.fn()} />);
  fireEvent.click(screen.getByText('接著上次的進度'));
  const input = screen.getByLabelText('載入閱讀進度檔') as HTMLInputElement;
  const file = new File(['pending'], 'reading.campus-study.json', { type: 'application/json' });
  Object.defineProperty(file, 'text', {
    value: () => new Promise<string>((resolve) => { finish = resolve; }),
  });
  fireEvent.change(input, { target: { files: [file] } });
  expect(screen.getByRole('button', { name: '取消讀取' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '取消讀取' }));
  expect(document.activeElement).toBe(input);
  await act(async () => finish('{"invalid":"late"}'));
  expect(screen.queryByRole('heading', { name: /接著讀「/ })).toBeNull();
  expect(screen.getByText(material.body)).toBeTruthy();
});

it('returns to the visible source summary if the chooser collapses during a cancelled import', async () => {
  let rejectImport!: (failure: Error) => void;
  mocks.read.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectImport = reject; }));
  render(<CourseStudyPanel scope={scope} courseTitle="資料庫" material={material} onClose={vi.fn()} />);
  const summary = screen.getByText('換一份講義或貼上內容');
  fireEvent.click(summary);
  const input = screen.getByLabelText('選擇講義') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(['pdf'], 'waiting.pdf')] } });
  fireEvent.click(summary);
  fireEvent.click(screen.getByRole('button', { name: '取消讀取' }));
  expect(document.activeElement).toBe(summary);
  await act(async () => rejectImport(new Error('取消後才到的讀檔錯誤')));
  expect(screen.queryByText('取消後才到的讀檔錯誤')).toBeNull();
  expect(screen.getByText(material.body)).toBeTruthy();
});

it('returns to the import control after a file error instead of leaving focus at a removed status', async () => {
  mocks.read.mockRejectedValueOnce(new Error('無法讀取這份 PDF'));
  render(<CourseStudyPanel scope={scope} courseTitle="資料庫" material={material} onClose={vi.fn()} />);
  fireEvent.click(screen.getByText('換一份講義或貼上內容'));
  const input = screen.getByLabelText('選擇講義') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(['pdf'], 'bad.pdf')] } });
  expect(await screen.findByText('無法讀取這份 PDF')).toBeTruthy();
  await waitFor(() => expect(document.activeElement).toBe(input));
  expect(screen.getByText(material.body)).toBeTruthy();
});

it('does not restore study memory after the panel has been closed and reopened', async () => {
  const view = render(<CourseStudyPanel scope={scope} courseTitle="資料庫" material={material} onClose={vi.fn()} />);
  await generate();
  fireEvent.change(screen.getByLabelText(noteLabel), { target: { value: '只在這次開啟保留' } });
  fireEvent.click(screen.getByRole('button', { name: '加入待複習' }));
  view.unmount();
  render(<CourseStudyPanel scope={scope} courseTitle="資料庫" material={material} onClose={vi.fn()} />);
  expect(inputValue(noteLabel)).toBe('');
  expect(screen.queryByRole('region', { name: '本段 AI 講解' })).toBeNull();
  expect(screen.queryByRole('region', { name: '待複習段落' })).toBeNull();
});

it('bounds retained lessons to the six most recent successful results', async () => {
  for (let number = 1; number <= 7; number++) mocks.run.mockResolvedValueOnce({ ...explanation, title: `講解 ${number}` });
  render(<CourseStudyPanel scope={scope} courseTitle="資料庫" material={material} onClose={vi.fn()} />);
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
  render(<CourseStudyPanel scope={scope} courseTitle="資料庫" material={{ ...material, body: `${material.body.padEnd(1600, '甲')}乙` }} onClose={vi.fn()} />);
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
  render(<CourseStudyPanel scope={scope} courseTitle="資料庫" material={material} onClose={vi.fn()} />);
  await generate();
  fireEvent.click(screen.getByRole('button', { name: '接著追問' }));
  await waitFor(() => expect(inputValue('這一段的講解記錄')).toBe('2'));
  expect(mocks.run.mock.calls[1][0].history).toBeUndefined();
  expect(screen.getByText(/先前講解較長，這次只依目前原文與問題整理/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText('這一段的講解記錄'), { target: { value: '1' } });
  expect(screen.getByText('長'.repeat(1800))).toBeTruthy();
});

// A mobile WebView can silently ignore an anchor download without throwing.
// Keep the exact TXT/JSON payload recoverable without a second export or model call.
it.each([
  ['下載本次筆記', '可選取的本次筆記文字'],
  ['儲存閱讀進度', '可選取的閱讀進度 JSON'],
])('offers a manual %s backup when the browser silently ignores a file download', (action, field) => {
  const create = vi.fn().mockReturnValue('blob:ignored-download');
  const revoke = vi.fn();
  const OriginalURL = URL;
  vi.stubGlobal('URL', class extends OriginalURL { static createObjectURL = create; static revokeObjectURL = revoke; });
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  const view = render(<CourseStudyPanel scope={scope} courseTitle="資料庫" material={material} onClose={vi.fn()} />);
  try {
    fireEvent.change(screen.getByLabelText(noteLabel), { target: { value: '手機必須保留的筆記' } });
    fireEvent.click(screen.getByRole('button', { name: action }));
    expect(click).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('textbox', { name: field })).toBeNull();

    const rescue = screen.getByRole('button', { name: '沒有下載到檔案？顯示完整手動備份' });
    rescue.focus();
    fireEvent.click(rescue);
    const backup = screen.getByRole('textbox', { name: field }) as HTMLTextAreaElement;
    expect(backup.value).toContain('手機必須保留的筆記');
    expect(backup.value).toContain(material.body);
    expect(document.activeElement).toBe(backup);
    if (action === '儲存閱讀進度') {
      expect(parseCourseStudyProgress(backup.value, scope).passages['0:0'].note).toBe('手機必須保留的筆記');
    }
    fireEvent.click(screen.getByRole('button', { name: '收起手動複製文字' }));
    expect(document.activeElement).toBe(rescue);

    // A later edit must invalidate the old export instead of offering stale notes.
    fireEvent.change(screen.getByLabelText(noteLabel), { target: { value: '已修改的筆記' } });
    expect(screen.queryByRole('button', { name: '沒有下載到檔案？顯示完整手動備份' })).toBeNull();
    expect(screen.queryByRole('textbox', { name: field })).toBeNull();
    expect(mocks.run).not.toHaveBeenCalled();
  } finally {
    view.unmount();
    click.mockRestore();
    vi.unstubAllGlobals();
  }
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
  const view = render(<CourseStudyPanel scope={scope} courseTitle="資料庫" material={material} onClose={vi.fn()} />);
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
    expect(screen.getByRole('heading', { name: '要改讀另一份教材嗎？' })).toBeTruthy();
    expect(revoke).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '確認改讀新教材' }));
    expect(revoke).toHaveBeenCalledWith('blob:study-notes');
    expect(screen.getByRole('button', { name: '下載本次筆記' }).hasAttribute('disabled')).toBe(true);
  } finally {
    view.unmount();
    click.mockRestore();
    vi.unstubAllGlobals();
  }
});

it('offers a selectable reading-note fallback when mobile clipboard support is missing', () => {
  const original = Object.getOwnPropertyDescriptor(window.navigator, 'clipboard');
  Object.defineProperty(window.navigator, 'clipboard', { configurable: true, value: undefined });
  try {
    render(<CourseStudyPanel scope={scope} courseTitle="資料庫" material={material} onClose={vi.fn()} />);
    const copy = screen.getByRole('button', { name: '複製本次筆記' });
    expect(copy.hasAttribute('disabled')).toBe(true);
    fireEvent.change(screen.getByLabelText(noteLabel), { target: { value: '本機筆記甲' } });
    expect(copy.hasAttribute('disabled')).toBe(false);
    copy.focus();
    fireEvent.click(copy);
    const manual = screen.getByRole('textbox', { name: '可選取的本次筆記文字' }) as HTMLTextAreaElement;
    expect(screen.getByRole('region', { name: '手動複製本次筆記' }).contains(manual)).toBe(true);
    expect(manual.readOnly).toBe(true);
    expect(manual.value).toContain('本機筆記甲');
    expect(manual.value).toContain(material.body);
    expect(document.activeElement).toBe(manual);
    fireEvent.click(screen.getByRole('button', { name: '全選上方文字' }));
    expect(document.activeElement).toBe(manual);
    expect(manual.selectionStart).toBe(0);
    expect(manual.selectionEnd).toBe(manual.value.length);
    expect(screen.getByRole('alert').textContent).toContain('無法直接複製筆記');
    fireEvent.click(screen.getByRole('button', { name: '收起手動複製文字' }));
    expect(screen.queryByRole('region', { name: '手動複製本次筆記' })).toBeNull();
    expect(document.activeElement).toBe(copy);
    fireEvent.click(copy);
    expect(screen.getByRole('region', { name: '手動複製本次筆記' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText(noteLabel), { target: { value: '修改後的筆記乙' } });
    expect(screen.queryByRole('region', { name: '手動複製本次筆記' })).toBeNull();
    expect((screen.getByLabelText(noteLabel) as HTMLTextAreaElement).value).toBe('修改後的筆記乙');
    expect(mocks.run).not.toHaveBeenCalled();
  } finally {
    if (original) Object.defineProperty(window.navigator, 'clipboard', original);
    else Reflect.deleteProperty(window.navigator, 'clipboard');
  }
});

// Mobile Safari/Chrome may dispatch click after the learner drags selection
// handles. Never reselect the entire backup on every textarea tap: that would
// prevent copying a chosen excerpt. The explicit select-all button still works.
it.each([
  ['複製本次筆記', '可選取的本次筆記文字'],
  ['複製閱讀進度 JSON', '可選取的閱讀進度 JSON'],
])('preserves manual selection on repeated taps in %s fallback', (action, field) => {
  const original = Object.getOwnPropertyDescriptor(window.navigator, 'clipboard');
  Object.defineProperty(window.navigator, 'clipboard', { configurable: true, value: undefined });
  try {
    render(<CourseStudyPanel scope={scope} courseTitle="資料庫" material={material} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(noteLabel), { target: { value: '保留的手機練習筆記' } });
    fireEvent.click(screen.getByRole('button', { name: action }));
    const manual = screen.getByRole('textbox', { name: field }) as HTMLTextAreaElement;
    expect(document.activeElement).toBe(manual);
    expect(manual.selectionEnd).toBe(manual.value.length);
    manual.setSelectionRange(5, 12);
    fireEvent.click(manual);
    expect(manual.selectionStart).toBe(5);
    expect(manual.selectionEnd).toBe(12);
    expect(manual.value).toContain('保留的手機練習筆記');
    fireEvent.click(screen.getByRole('button', { name: '全選上方文字' }));
    expect(manual.selectionStart).toBe(0);
    expect(manual.selectionEnd).toBe(manual.value.length);
    expect(mocks.run).not.toHaveBeenCalled();
  } finally {
    if (original) Object.defineProperty(window.navigator, 'clipboard', original);
    else Reflect.deleteProperty(window.navigator, 'clipboard');
  }
});

it('preserves a selected JSON excerpt after focus leaves and returns on mobile', () => {
  const original = Object.getOwnPropertyDescriptor(window.navigator, 'clipboard');
  Object.defineProperty(window.navigator, 'clipboard', { configurable: true, value: undefined });
  try {
    render(<CourseStudyPanel scope={scope} courseTitle="資料庫" material={material} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(noteLabel), { target: { value: '切回 App 後仍要保留的筆記' } });
    fireEvent.click(screen.getByRole('button', { name: '複製閱讀進度 JSON' }));
    const manual = screen.getByRole('textbox', { name: '可選取的閱讀進度 JSON' }) as HTMLTextAreaElement;
    const backup = manual.value;
    expect(document.activeElement).toBe(manual);
    expect(manual.selectionStart).toBe(0);
    expect(manual.selectionEnd).toBe(backup.length);

    manual.setSelectionRange(5, 18);
    const retry = screen.getByRole('button', { name: '再次嘗試複製到剪貼簿' });
    retry.focus();
    expect(document.activeElement).toBe(retry);
    manual.focus();
    expect(document.activeElement).toBe(manual);
    expect(manual.selectionStart).toBe(5);
    expect(manual.selectionEnd).toBe(18);

    fireEvent.click(screen.getByRole('button', { name: '全選上方文字' }));
    expect(manual.selectionStart).toBe(0);
    expect(manual.selectionEnd).toBe(backup.length);
    expect(manual.value).toBe(backup);
    expect(parseCourseStudyProgress(backup, scope).passages['0:0'].note)
      .toBe('切回 App 後仍要保留的筆記');
    expect(mocks.run).not.toHaveBeenCalled();
  } finally {
    if (original) Object.defineProperty(window.navigator, 'clipboard', original);
    else Reflect.deleteProperty(window.navigator, 'clipboard');
  }
});

it('retries a denied mobile JSON copy without changing the validated backup or note', async () => {
  const original = Object.getOwnPropertyDescriptor(window.navigator, 'clipboard');
  const writeText = vi.fn().mockRejectedValueOnce(new Error('permission denied'))
    .mockResolvedValueOnce(undefined);
  Object.defineProperty(window.navigator, 'clipboard', { configurable: true, value: { writeText } });
  try {
    render(<CourseStudyPanel scope={scope} courseTitle="資料庫" material={material} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(noteLabel), { target: { value: '先完成的手機筆記' } });
    const trigger = screen.getByRole('button', { name: '複製閱讀進度 JSON' });
    trigger.focus();
    fireEvent.click(trigger);
    const region = await screen.findByRole('region', { name: '手動複製閱讀進度 JSON' });
    const manual = screen.getByRole('textbox', { name: '可選取的閱讀進度 JSON' }) as HTMLTextAreaElement;
    const snapshot = manual.value;
    expect(parseCourseStudyProgress(snapshot, scope).passages['0:0'].note).toBe('先完成的手機筆記');
    expect(region.contains(manual)).toBe(true);
    const retry = screen.getByRole('button', { name: '再次嘗試複製到剪貼簿' });
    retry.focus(); // The retry button is the focused element React will unmount after success.
    expect(document.activeElement).toBe(retry);
    fireEvent.click(retry);
    await waitFor(() => expect(screen.queryByRole('region', { name: '手動複製閱讀進度 JSON' })).toBeNull());
    expect(writeText).toHaveBeenCalledTimes(2);
    expect(writeText.mock.calls[0][0]).toBe(snapshot);
    expect(writeText.mock.calls[1][0]).toBe(snapshot);
    expect(screen.getByText(/已複製完整進度 JSON/)).toBeTruthy();
    expect(document.activeElement).toBe(trigger);
    expect(inputValue(noteLabel)).toBe('先完成的手機筆記');
    expect(mocks.run).not.toHaveBeenCalled();
  } finally {
    if (original) Object.defineProperty(window.navigator, 'clipboard', original);
    else Reflect.deleteProperty(window.navigator, 'clipboard');
  }
});

it('ignores a delayed clipboard success after closing the manual backup fallback', async () => {
  const original = Object.getOwnPropertyDescriptor(window.navigator, 'clipboard');
  let resolveRetry!: () => void;
  const writeText = vi.fn().mockRejectedValueOnce(new Error('permission denied'))
    .mockImplementationOnce(() => new Promise<void>((resolve) => { resolveRetry = resolve; }));
  Object.defineProperty(window.navigator, 'clipboard', { configurable: true, value: { writeText } });
  try {
    render(<CourseStudyPanel scope={scope} courseTitle="資料庫" material={material} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(noteLabel), { target: { value: '尚未離開的原始筆記' } });
    const trigger = screen.getByRole('button', { name: '複製閱讀進度 JSON' });
    trigger.focus();
    fireEvent.click(trigger);
    await screen.findByRole('region', { name: '手動複製閱讀進度 JSON' });
    fireEvent.click(screen.getByRole('button', { name: '再次嘗試複製到剪貼簿' }));
    expect(writeText).toHaveBeenCalledTimes(2);
    const dismiss = screen.getByRole('button', { name: '收起手動複製文字' });
    dismiss.focus(); // Model keyboard focus on a button that will be unmounted.
    fireEvent.click(dismiss);
    expect(document.activeElement).toBe(trigger);
    await act(async () => { resolveRetry(); });
    expect(screen.queryByRole('region', { name: '手動複製閱讀進度 JSON' })).toBeNull();
    expect(screen.queryByText(/已複製完整進度 JSON/)).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(inputValue(noteLabel)).toBe('尚未離開的原始筆記');
    expect(mocks.run).not.toHaveBeenCalled();
  } finally {
    if (original) Object.defineProperty(window.navigator, 'clipboard', original);
    else Reflect.deleteProperty(window.navigator, 'clipboard');
  }
});

it('keeps private reading backup text accessible if mobile textarea selection APIs reject the action', () => {
  const originalClipboard = Object.getOwnPropertyDescriptor(window.navigator, 'clipboard');
  Object.defineProperty(window.navigator, 'clipboard', { configurable: true, value: undefined });
  const select = vi.spyOn(HTMLTextAreaElement.prototype, 'select')
    .mockImplementation(() => { throw new Error('WebKit selection unavailable'); });
  try {
    render(<CourseStudyPanel scope={scope} courseTitle="資料庫" material={material} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(noteLabel), { target: { value: '仍須保留的本機回答' } });
    fireEvent.click(screen.getByRole('button', { name: '複製閱讀進度 JSON' }));
    const manual = screen.getByRole('textbox', { name: '可選取的閱讀進度 JSON' }) as HTMLTextAreaElement;
    expect(manual.readOnly).toBe(true);
    expect(document.activeElement).toBe(manual);
    expect(manual.selectionStart).toBe(0);
    expect(manual.selectionEnd).toBe(manual.value.length);
    expect(parseCourseStudyProgress(manual.value, scope).passages['0:0'].note).toBe('仍須保留的本機回答');
    // Even when both selection methods are rejected, a second tap cannot crash
    // the board or erase the raw JSON; long-press copy is still available.
    const range = vi.spyOn(manual, 'setSelectionRange')
      .mockImplementation(() => { throw new Error('selection range unavailable'); });
    try {
      expect(() => fireEvent.click(screen.getByRole('button', { name: '全選上方文字' }))).not.toThrow();
      expect(document.activeElement).toBe(manual);
      expect(parseCourseStudyProgress(manual.value, scope).passages['0:0'].note).toBe('仍須保留的本機回答');
      expect(screen.getByRole('alert').textContent).toContain('無法直接複製進度 JSON');
    } finally {
      range.mockRestore();
    }
    expect(mocks.run).not.toHaveBeenCalled();
  } finally {
    select.mockRestore();
    if (originalClipboard) Object.defineProperty(window.navigator, 'clipboard', originalClipboard);
    else Reflect.deleteProperty(window.navigator, 'clipboard');
  }
});

it('copies the current reading note and ignores a delayed clipboard denial after editing', async () => {
  const original = Object.getOwnPropertyDescriptor(window.navigator, 'clipboard');
  let rejectCopy!: (error: Error) => void;
  const writeText = vi.fn().mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { rejectCopy = reject; }))
    .mockResolvedValue(undefined);
  Object.defineProperty(window.navigator, 'clipboard', { configurable: true, value: { writeText } });
  try {
    render(<CourseStudyPanel scope={scope} courseTitle="資料庫" material={material} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(noteLabel), { target: { value: '初稿' } });
    fireEvent.click(screen.getByRole('button', { name: '複製本次筆記' }));
    expect(writeText).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByLabelText(noteLabel), { target: { value: '最終筆記' } });
    await act(async () => rejectCopy(new Error('clipboard denied')));
    expect(screen.queryByRole('region', { name: '手動複製本次筆記' })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '複製本次筆記' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2));
    expect(writeText.mock.calls[1][0] as string).toContain('最終筆記');
    expect(writeText.mock.calls[1][0] as string).not.toContain('初稿');
    await screen.findByText(/已複製本次筆記到剪貼簿/);
    expect((screen.getByLabelText(noteLabel) as HTMLTextAreaElement).value).toBe('最終筆記');
    expect(mocks.run).not.toHaveBeenCalled();
  } finally {
    if (original) Object.defineProperty(window.navigator, 'clipboard', original);
    else Reflect.deleteProperty(window.navigator, 'clipboard');
  }
});

it('clears the earlier manual JSON fallback after a new explicit progress download', () => {
  const original = Object.getOwnPropertyDescriptor(window.navigator, 'clipboard');
  Object.defineProperty(window.navigator, 'clipboard', { configurable: true, value: undefined });
  const create = vi.fn().mockReturnValue('blob:study-progress');
  const revoke = vi.fn();
  const OriginalURL = URL;
  vi.stubGlobal('URL', class extends OriginalURL { static createObjectURL = create; static revokeObjectURL = revoke; });
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  try {
    render(<CourseStudyPanel scope={scope} courseTitle="資料庫" material={material} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(noteLabel), { target: { value: '待保留的本機筆記' } });
    fireEvent.click(screen.getByRole('button', { name: '複製閱讀進度 JSON' }));
    const manual = screen.getByRole('textbox', { name: '可選取的閱讀進度 JSON' }) as HTMLTextAreaElement;
    expect(parseCourseStudyProgress(manual.value, scope).passages['0:0'].note).toBe('待保留的本機筆記');

    fireEvent.click(screen.getByRole('button', { name: '儲存閱讀進度' }));
    expect(create).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/已交給瀏覽器下載閱讀進度/)).toBeTruthy();
    expect(screen.queryByRole('region', { name: '手動複製閱讀進度 JSON' })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(inputValue(noteLabel)).toBe('待保留的本機筆記');
  } finally {
    click.mockRestore();
    vi.unstubAllGlobals();
    if (original) Object.defineProperty(window.navigator, 'clipboard', original);
    else Reflect.deleteProperty(window.navigator, 'clipboard');
  }
});

it('keeps a selected TXT excerpt but still offers the NEW JSON when its mobile download is blocked', () => {
  const original = Object.getOwnPropertyDescriptor(window.navigator, 'clipboard');
  Object.defineProperty(window.navigator, 'clipboard', { configurable: true, value: undefined });
  const create = vi.fn(() => { throw new Error('download blocked'); });
  const OriginalURL = URL;
  vi.stubGlobal('URL', class extends OriginalURL { static createObjectURL = create; });
  try {
    render(<CourseStudyPanel scope={scope} courseTitle="資料庫" material={material} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(noteLabel), { target: { value: '兩種格式都要保留的筆記' } });
    fireEvent.click(screen.getByRole('button', { name: '複製本次筆記' }));
    const selectedNotes = screen.getByRole('textbox', { name: '可選取的本次筆記文字' }) as HTMLTextAreaElement;
    selectedNotes.setSelectionRange(4, 14);

    fireEvent.click(screen.getByRole('button', { name: '儲存閱讀進度' }));
    expect(create).toHaveBeenCalledOnce();
    expect(screen.getByRole('textbox', { name: '可選取的本次筆記文字' })).toBe(selectedNotes);
    expect(selectedNotes.selectionStart).toBe(4);
    expect(selectedNotes.selectionEnd).toBe(14);
    expect(screen.getByRole('alert').textContent).toContain('這次的新備份');
    expect(screen.getByRole('button', { name: '沒有下載到檔案？顯示完整手動備份' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '沒有下載到檔案？顯示完整手動備份' }));
    const progress = screen.getByRole('textbox', { name: '可選取的閱讀進度 JSON' }) as HTMLTextAreaElement;
    expect(parseCourseStudyProgress(progress.value, scope).passages['0:0'].note).toBe('兩種格式都要保留的筆記');
    expect(progress.value).toContain(material.body);
    expect(document.activeElement).toBe(progress);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(mocks.run).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
    if (original) Object.defineProperty(window.navigator, 'clipboard', original);
    else Reflect.deleteProperty(window.navigator, 'clipboard');
  }
});

it('preserves a selectable JSON backup after a blocked mobile download', () => {
  const original = Object.getOwnPropertyDescriptor(window.navigator, 'clipboard');
  Object.defineProperty(window.navigator, 'clipboard', { configurable: true, value: undefined });
  const create = vi.fn(() => { throw new Error('download blocked'); });
  const OriginalURL = URL;
  vi.stubGlobal('URL', class extends OriginalURL { static createObjectURL = create; });
  try {
    render(<CourseStudyPanel scope={scope} courseTitle="資料庫" material={material} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(noteLabel), { target: { value: '這份進度還沒成功儲存到手機' } });
    fireEvent.click(screen.getByRole('button', { name: '複製閱讀進度 JSON' }));
    const input = screen.getByRole('textbox', { name: '可選取的閱讀進度 JSON' }) as HTMLTextAreaElement;
    const snapshot = input.value;
    input.setSelectionRange(4, 20);
    fireEvent.click(screen.getByRole('button', { name: '儲存閱讀進度' }));

    expect(create).toHaveBeenCalledTimes(1);
    const remaining = screen.getByRole('textbox', { name: '可選取的閱讀進度 JSON' }) as HTMLTextAreaElement;
    expect(remaining).toBe(input);
    expect(remaining.value).toBe(snapshot);
    expect(remaining.selectionStart).toBe(4);
    expect(remaining.selectionEnd).toBe(20);
    expect(parseCourseStudyProgress(remaining.value, scope).passages['0:0'].note)
      .toBe('這份進度還沒成功儲存到手機');
    expect(screen.getByRole('alert').textContent).toContain('先前可手動選取的備份仍保留');
  } finally {
    vi.unstubAllGlobals();
    if (original) Object.defineProperty(window.navigator, 'clipboard', original);
    else Reflect.deleteProperty(window.navigator, 'clipboard');
  }
});

it('provides full selectable TXT on the first blocked download without clipboard access', () => {
  const original = Object.getOwnPropertyDescriptor(window.navigator, 'clipboard');
  Object.defineProperty(window.navigator, 'clipboard', { configurable: true, value: undefined });
  const create = vi.fn(() => { throw new Error('blob downloads blocked'); });
  const OriginalURL = URL;
  vi.stubGlobal('URL', class extends OriginalURL { static createObjectURL = create; });
  try {
    render(<CourseStudyPanel scope={scope} courseTitle="資料庫" material={material} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(noteLabel), { target: { value: '必須在手機保存的課堂筆記' } });
    fireEvent.click(screen.getByRole('button', { name: '下載本次筆記' }));
    const backup = screen.getByRole('textbox', { name: '可選取的本次筆記文字' }) as HTMLTextAreaElement;
    expect(create).toHaveBeenCalledTimes(1);
    expect(backup.value).toContain('必須在手機保存的課堂筆記');
    expect(backup.value).toContain(material.body);
    expect(screen.getByRole('alert').textContent).toContain('完整可選取的備份文字');
    fireEvent.click(screen.getByRole('button', { name: '再次嘗試複製到剪貼簿' }));
    expect(backup.isConnected).toBe(true);
    expect(inputValue(noteLabel)).toBe('必須在手機保存的課堂筆記');
    expect(mocks.run).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
    if (original) Object.defineProperty(window.navigator, 'clipboard', original);
    else Reflect.deleteProperty(window.navigator, 'clipboard');
  }
});

it('provides restorable JSON on the first blocked progress download without a prior copy', () => {
  const original = Object.getOwnPropertyDescriptor(window.navigator, 'clipboard');
  Object.defineProperty(window.navigator, 'clipboard', { configurable: true, value: undefined });
  const create = vi.fn(() => { throw new Error('blob downloads blocked'); });
  const OriginalURL = URL;
  vi.stubGlobal('URL', class extends OriginalURL { static createObjectURL = create; });
  try {
    render(<CourseStudyPanel scope={scope} courseTitle="資料庫" material={material} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(noteLabel), { target: { value: '不可遺失的期中複習草稿' } });
    fireEvent.change(screen.getByLabelText('這次怎麼讀'), { target: { value: 'exam' } });
    fireEvent.click(screen.getByRole('button', { name: '儲存閱讀進度' }));
    const backup = screen.getByRole('textbox', { name: '可選取的閱讀進度 JSON' }) as HTMLTextAreaElement;
    expect(create).toHaveBeenCalledTimes(1);
    const restored = parseCourseStudyProgress(backup.value, scope);
    expect(restored.passages['0:0'].note).toBe('不可遺失的期中複習草稿');
    expect(restored.position.mode).toBe('exam');
    expect(screen.getByRole('alert').textContent).toContain('完整可選取的備份文字');
    expect(inputValue(noteLabel)).toBe('不可遺失的期中複習草稿');
    expect(mocks.run).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
    if (original) Object.defineProperty(window.navigator, 'clipboard', original);
    else Reflect.deleteProperty(window.navigator, 'clipboard');
  }
});

// WebViews can throw on property access, even before a writeText promise exists.
// Preserve both exports and their manual retry path without exposing lesson data.
it.each(['clipboard', 'writeText'] as const)(
  'provides selectable TXT/JSON when mobile %s property access throws SecurityError',
  (failureAt) => {
    const original = Object.getOwnPropertyDescriptor(window.navigator, 'clipboard');
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      get() {
        if (failureAt === 'clipboard') throw new DOMException('blocked', 'SecurityError');
        return Object.defineProperty({}, 'writeText', {
          get() { throw new DOMException('blocked', 'SecurityError'); },
        });
      },
    });
    try {
      render(<CourseStudyPanel scope={scope} courseTitle="資料庫" material={material} onClose={vi.fn()} />);
      fireEvent.change(screen.getByLabelText(noteLabel), { target: { value: '手機剪貼簿被封鎖的筆記' } });
      fireEvent.click(screen.getByRole('button', { name: '複製本次筆記' }));
      const notes = screen.getByRole('textbox', { name: '可選取的本次筆記文字' }) as HTMLTextAreaElement;
      expect(notes.value).toContain('手機剪貼簿被封鎖的筆記');
      expect(notes.value).toContain(material.body);
      fireEvent.click(screen.getByRole('button', { name: '再次嘗試複製到剪貼簿' }));
      expect(notes.isConnected).toBe(true);
      expect(screen.getByRole('alert').textContent).toContain('全選下方文字');

      fireEvent.click(screen.getByRole('button', { name: '複製閱讀進度 JSON' }));
      const backup = screen.getByRole('textbox', { name: '可選取的閱讀進度 JSON' }) as HTMLTextAreaElement;
      expect(parseCourseStudyProgress(backup.value, scope).passages['0:0'].note)
        .toBe('手機剪貼簿被封鎖的筆記');
      fireEvent.click(screen.getByRole('button', { name: '再次嘗試複製到剪貼簿' }));
      expect(backup.isConnected).toBe(true);
      expect(screen.getByRole('alert').textContent).toContain('全選下方文字');
      expect(mocks.run).not.toHaveBeenCalled();
    } finally {
      if (original) Object.defineProperty(window.navigator, 'clipboard', original);
      else Reflect.deleteProperty(window.navigator, 'clipboard');
    }
  },
);

it('copies a restorable reading-progress JSON with selectable fallback when download or clipboard is blocked', () => {
  const original = Object.getOwnPropertyDescriptor(window.navigator, 'clipboard');
  Object.defineProperty(window.navigator, 'clipboard', { configurable: true, value: undefined });
  try {
    render(<CourseStudyPanel scope={scope} courseTitle="資料庫" material={material} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(noteLabel), { target: { value: '本機備份筆記' } });
    fireEvent.change(screen.getByLabelText('這次怎麼讀'), { target: { value: 'exam' } });
    fireEvent.click(screen.getByRole('button', { name: '複製閱讀進度 JSON' }));
    const manual = screen.getByRole('textbox', { name: '可選取的閱讀進度 JSON' }) as HTMLTextAreaElement;
    expect(screen.getByRole('region', { name: '手動複製閱讀進度 JSON' }).contains(manual)).toBe(true);
    expect(manual.readOnly).toBe(true);
    expect(document.activeElement).toBe(manual);
    const parsed = parseCourseStudyProgress(manual.value, scope);
    expect(parsed.source.title).toBe(material.title);
    expect(parsed.position.mode).toBe('exam');
    expect(parsed.passages['0:0'].note).toBe('本機備份筆記');
    expect(screen.getByRole('alert').textContent).toContain('儲存為 .json');
    fireEvent.change(screen.getByLabelText('這次怎麼讀'), { target: { value: 'understand' } });
    expect(screen.queryByRole('region', { name: '手動複製閱讀進度 JSON' })).toBeNull();
    expect(mocks.run).not.toHaveBeenCalled();
  } finally {
    if (original) Object.defineProperty(window.navigator, 'clipboard', original);
    else Reflect.deleteProperty(window.navigator, 'clipboard');
  }
});

it('copies the full active or paused practice checkpoint without dropping the draft', async () => {
  const original = Object.getOwnPropertyDescriptor(window.navigator, 'clipboard');
  Object.defineProperty(window.navigator, 'clipboard', { configurable: true, value: undefined });
  try {
    render(<CourseStudyPanel scope={scope} courseTitle="資料庫" material={material} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '加入待複習' }));
    await generate();
    fireEvent.click(screen.getByRole('button', { name: '開始逐題複習' }));
    fireEvent.change(screen.getByLabelText('這一題，我的回答'), { target: { value: '手機上的未完成練習回答' } });
    fireEvent.click(screen.getByRole('button', { name: '複製練習與閱讀進度 JSON' }));
    const active = screen.getByRole('textbox', { name: '可選取的練習與閱讀進度 JSON' }) as HTMLTextAreaElement;
    const saved = parseStudyPracticeCheckpoint(active.value, scope);
    expect(saved.round.responses[saved.round.cards[0].id].attempt).toBe('手機上的未完成練習回答');
    expect(saved.round.finished).toBe(false);
    expect(saved.progress.position.mode).toBe(saved.round.mode);
    fireEvent.click(screen.getByRole('button', { name: '回到閱讀' }));
    expect(screen.queryByRole('region', { name: '手動複製練習與閱讀進度 JSON' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '複製暫停的練習與閱讀進度 JSON' }));
    const paused = screen.getByRole('textbox', { name: '可選取的練習與閱讀進度 JSON' }) as HTMLTextAreaElement;
    const resumed = parseStudyPracticeCheckpoint(paused.value, scope);
    expect(resumed.round.responses[resumed.round.cards[0].id].attempt).toBe('手機上的未完成練習回答');
    expect(screen.getByRole('button', { name: '繼續這輪練習' })).toBeTruthy();
  } finally {
    if (original) Object.defineProperty(window.navigator, 'clipboard', original);
    else Reflect.deleteProperty(window.navigator, 'clipboard');
  }
});

it('ignores a late JSON clipboard failure after the learner edits the notes', async () => {
  const original = Object.getOwnPropertyDescriptor(window.navigator, 'clipboard');
  let rejectCopy!: (error: Error) => void;
  const writeText = vi.fn(() => new Promise<void>((_resolve, reject) => { rejectCopy = reject; }));
  Object.defineProperty(window.navigator, 'clipboard', { configurable: true, value: { writeText } });
  try {
    render(<CourseStudyPanel scope={scope} courseTitle="資料庫" material={material} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '複製閱讀進度 JSON' }));
    expect(writeText).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByLabelText(noteLabel), { target: { value: '備份操作後才寫入的筆記' } });
    await act(async () => rejectCopy(new Error('clipboard denied')));
    expect(screen.queryByRole('region', { name: '手動複製閱讀進度 JSON' })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(inputValue(noteLabel)).toBe('備份操作後才寫入的筆記');
  } finally {
    if (original) Object.defineProperty(window.navigator, 'clipboard', original);
    else Reflect.deleteProperty(window.navigator, 'clipboard');
  }
});

it('previews pasted reading JSON without changing current notes and restores only after confirmation', () => {
  const original = Object.getOwnPropertyDescriptor(window.navigator, 'clipboard');
  Object.defineProperty(window.navigator, 'clipboard', { configurable: true, value: undefined });
  try {
    render(<CourseStudyPanel scope={scope} courseTitle="資料庫" material={material} onClose={vi.fn()} />);
    const note = screen.getByLabelText(noteLabel) as HTMLTextAreaElement;
    fireEvent.change(note, { target: { value: '備份時的原筆記' } });
    fireEvent.click(screen.getByRole('button', { name: '複製閱讀進度 JSON' }));
    const json = (screen.getByRole('textbox', { name: '可選取的閱讀進度 JSON' }) as HTMLTextAreaElement).value;
    fireEvent.change(note, { target: { value: '目前還沒存檔的更新筆記' } });
    fireEvent.click(screen.getByText('接著上次的進度'));
    const pasted = screen.getByLabelText('貼上已備份的進度 JSON') as HTMLTextAreaElement;
    fireEvent.change(pasted, { target: { value: json } });
    fireEvent.click(screen.getByRole('button', { name: '預覽貼上的進度' }));
    const preview = screen.getByRole('region', { name: '閱讀進度預覽' });
    expect(preview.textContent).toContain('貼上的進度 JSON');
    expect(document.activeElement).toBe(within(preview).getByRole('heading'));
    expect(note.value).toBe('目前還沒存檔的更新筆記');
    fireEvent.click(screen.getByRole('button', { name: '取消還原' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '預覽貼上的進度' }));
    expect(pasted.value).toBe(json);
    expect(note.value).toBe('目前還沒存檔的更新筆記');
    fireEvent.click(screen.getByRole('button', { name: '預覽貼上的進度' }));
    fireEvent.click(screen.getByRole('button', { name: '還原這份進度' }));
    expect((screen.getByLabelText(noteLabel) as HTMLTextAreaElement).value).toBe('備份時的原筆記');
    expect(pasted.value).toBe('');
    expect(screen.queryByRole('region', { name: '閱讀進度預覽' })).toBeNull();
    expect(mocks.run).not.toHaveBeenCalled();
  } finally {
    if (original) Object.defineProperty(window.navigator, 'clipboard', original);
    else Reflect.deleteProperty(window.navigator, 'clipboard');
  }
});

it('restores keyboard focus to the JSON copy trigger after closing manual mobile copy', () => {
  const original = Object.getOwnPropertyDescriptor(window.navigator, 'clipboard');
  Object.defineProperty(window.navigator, 'clipboard', { configurable: true, value: undefined });
  try {
    render(<CourseStudyPanel scope={scope} courseTitle="資料庫" material={material} onClose={vi.fn()} />);
    const trigger = screen.getByRole('button', { name: '複製閱讀進度 JSON' });
    trigger.focus();
    fireEvent.click(trigger);
    const manual = screen.getByRole('textbox', { name: '可選取的閱讀進度 JSON' });
    expect(document.activeElement).toBe(manual);
    fireEvent.click(screen.getByRole('button', { name: '收起手動複製文字' }));
    expect(screen.queryByRole('region', { name: '手動複製閱讀進度 JSON' })).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(mocks.run).not.toHaveBeenCalled();
  } finally {
    if (original) Object.defineProperty(window.navigator, 'clipboard', original);
    else Reflect.deleteProperty(window.navigator, 'clipboard');
  }
});

it('restores pasted practice checkpoint with its unanswered draft and original study mode', async () => {
  const original = Object.getOwnPropertyDescriptor(window.navigator, 'clipboard');
  Object.defineProperty(window.navigator, 'clipboard', { configurable: true, value: undefined });
  try {
    render(<CourseStudyPanel scope={scope} courseTitle="資料庫" material={material} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '加入待複習' }));
    await generate();
    fireEvent.click(screen.getByRole('button', { name: '開始逐題複習' }));
    fireEvent.change(screen.getByLabelText('這一題，我的回答'), { target: { value: '未自評也要保留的作答' } });
    fireEvent.click(screen.getByRole('button', { name: '複製練習與閱讀進度 JSON' }));
    const json = (screen.getByRole('textbox', { name: '可選取的練習與閱讀進度 JSON' }) as HTMLTextAreaElement).value;
    fireEvent.click(screen.getByRole('button', { name: '回到閱讀' }));
    fireEvent.change(screen.getByLabelText('這次怎麼讀'), { target: { value: 'exam' } });
    fireEvent.click(screen.getByText('接著上次的進度'));
    fireEvent.change(screen.getByLabelText('貼上已備份的進度 JSON'), { target: { value: json } });
    fireEvent.click(screen.getByRole('button', { name: '預覽貼上的進度' }));
    expect(screen.getByRole('region', { name: '閱讀進度預覽' }).textContent).toContain('逐題練習');
    expect(screen.getByRole('button', { name: '繼續這輪練習' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '取消還原' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '預覽貼上的進度' }));
    expect((screen.getByLabelText('貼上已備份的進度 JSON') as HTMLTextAreaElement).value).toBe(json);
    expect(screen.getByRole('button', { name: '繼續這輪練習' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '預覽貼上的進度' }));
    fireEvent.click(screen.getByRole('button', { name: '還原這份進度' }));
    expect((screen.getByLabelText('這一題，我的回答') as HTMLTextAreaElement).value).toBe('未自評也要保留的作答');
    expect(screen.getByRole('heading', { name: '第 1 題' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '回到閱讀' }));
    expect((screen.getByLabelText('這次怎麼讀') as HTMLSelectElement).value).toBe('understand');
  } finally {
    if (original) Object.defineProperty(window.navigator, 'clipboard', original);
    else Reflect.deleteProperty(window.navigator, 'clipboard');
  }
});

it('rejects malformed and cross-course pasted JSON without clearing the current lesson or draft', () => {
  const original = Object.getOwnPropertyDescriptor(window.navigator, 'clipboard');
  Object.defineProperty(window.navigator, 'clipboard', { configurable: true, value: undefined });
  try {
    render(<CourseStudyPanel scope={scope} courseTitle="資料庫" material={material} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(noteLabel), { target: { value: '尚未備份的現在筆記' } });
    fireEvent.click(screen.getByRole('button', { name: '複製閱讀進度 JSON' }));
    const json = (screen.getByRole('textbox', { name: '可選取的閱讀進度 JSON' }) as HTMLTextAreaElement).value;
    fireEvent.click(screen.getByText('接著上次的進度'));
    const pasted = screen.getByLabelText('貼上已備份的進度 JSON') as HTMLTextAreaElement;
    fireEvent.change(pasted, { target: { value: '{invalid' } });
    fireEvent.click(screen.getByRole('button', { name: '預覽貼上的進度' }));
    expect(screen.getAllByRole('alert').some((alert) =>
      alert.textContent?.includes('無法讀取這個進度檔'))).toBe(true);
    // The clipboard backup fallback can remain visible with a distinct error message.
    expect(screen.getAllByRole('alert').some((alert) =>
      alert.textContent?.includes('無法直接複製進度 JSON'))).toBe(true);
    expect(screen.queryByRole('region', { name: '閱讀進度預覽' })).toBeNull();
    const crossCourse = JSON.parse(json);
    crossCourse.scope.workspaceId = 'cw_22222222-2222-4222-8222-222222222222';
    fireEvent.change(pasted, { target: { value: JSON.stringify(crossCourse) } });
    fireEvent.click(screen.getByRole('button', { name: '預覽貼上的進度' }));
    expect(screen.getAllByRole('alert').some((alert) =>
      alert.textContent?.includes('帳號或課程'))).toBe(true);
    expect((screen.getByLabelText(noteLabel) as HTMLTextAreaElement).value).toBe('尚未備份的現在筆記');
    expect(screen.getByText(material.body)).toBeTruthy();
    expect(screen.queryByRole('region', { name: '閱讀進度預覽' })).toBeNull();
    expect(mocks.run).not.toHaveBeenCalled();
  } finally {
    if (original) Object.defineProperty(window.navigator, 'clipboard', original);
    else Reflect.deleteProperty(window.navigator, 'clipboard');
  }
});

it('guards an unconfirmed pasted progress backup from accidental close on an empty board', () => {
  const onClose = vi.fn();
  render(<CourseStudyPanel scope={scope} courseTitle="資料庫" onClose={onClose} />);
  fireEvent.click(screen.getByText('接著上次的進度'));
  const pasted = screen.getByLabelText('貼上已備份的進度 JSON') as HTMLTextAreaElement;
  fireEvent.change(pasted, { target: { value: '{"format":"still-pasting"}' } });
  fireEvent.click(screen.getByRole('button', { name: '收起白板' }));
  expect(onClose).not.toHaveBeenCalled();
  expect(screen.getByText(/貼上的進度 JSON 尚未確認還原/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '繼續讀書' }));
  expect(pasted.value).toBe('{"format":"still-pasting"}');
  expect(onClose).not.toHaveBeenCalled();
});

it('shows a source-linked three-step explanation and focuses its exact quotation', async () => {
  render(<CourseStudyPanel scope={scope} courseTitle="資料庫" material={material} onClose={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: '啟用 AI 講解本段' }));
  await screen.findByRole('region', { name: '本段 AI 講解' });
  expect(screen.getByRole('group', { name: '三步對照學習' })).toBeTruthy();
  expect(screen.getByRole('region', { name: '第一步：核對原文' })).toBeTruthy();
  expect(screen.getByRole('region', { name: '第二步：理解講解' })).toBeTruthy();
  expect(screen.getByRole('region', { name: '第三步：自己試答' })).toBeTruthy();
  const mark = screen.getByText(explanation.sourceQuote, { selector: 'mark' });
  expect(mark.parentElement?.textContent).toBe(material.body);
  fireEvent.click(screen.getByRole('button', { name: '定位原文引句' }));
  expect(document.activeElement).toBe(mark);
  expect(mocks.run).toHaveBeenCalledTimes(1);
  expect(mocks.read).not.toHaveBeenCalled();
});

it('identifies repeated quotations without changing the original text or silently picking another', async () => {
  const repeated = `${material.body} 再讀一次：${explanation.sourceQuote}。`;
  render(<CourseStudyPanel scope={scope} courseTitle="資料庫"
    material={{ ...material, body: repeated }} onClose={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: '啟用 AI 講解本段' }));
  await screen.findByRole('region', { name: '本段 AI 講解' });
  expect(screen.getByText(/相同引句在本段出現 2 處/)).toBeTruthy();
  const mark = screen.getByText(explanation.sourceQuote, { selector: 'mark' });
  expect(mark.parentElement?.textContent).toBe(repeated);
  expect(document.querySelectorAll('mark')).toHaveLength(1);
});

const mathMaterial = { id: 'math-1', title: '平均數', body: '平均數可寫成 m = s/n，其中 s 是總和，n 是筆數。先求總和，再除以筆數；筆數必須大於零。' };
const steppedExplanation: TutorExplanation = {
  title: '從總和算出平均數', explanation: '先加總資料，再除以資料筆數。',
  sourceQuote: '平均數可寫成 m = s/n', question: '這個公式可以用在沒有任何資料的情況嗎？',
  answer: '不可以，筆數不能是零。',
  steps: [
    { title: '辨認總和與筆數', explanation: 's 表示總和，n 表示資料筆數。', sourceQuote: '其中 s 是總和，n 是筆數' },
    { title: '套用平均數公式', explanation: '用總和 s 除以筆數 n，得到平均數 m。', sourceQuote: 'm = s/n', formula: 'm = s/n' },
    { title: '檢查分母', explanation: '先確認資料筆數大於零，才能使用這個公式。', sourceQuote: '筆數必須大於零' },
  ],
};

it('navigates real teaching steps with their own source highlights and quoted formulas', async () => {
  mocks.run.mockResolvedValue(steppedExplanation);
  render(<CourseStudyPanel scope={scope} courseTitle="統計" material={mathMaterial} onClose={vi.fn()} />);
  await generate();
  const navigation = screen.getByRole('navigation', { name: '講解步驟' });
  expect(within(navigation).getAllByRole('button')).toHaveLength(3);
  expect(within(navigation).getByRole('button', { name: '第 1 步：辨認總和與筆數' }).getAttribute('aria-current')).toBe('step');
  expect(screen.getByRole('button', { name: '上一步' }).hasAttribute('disabled')).toBe(true);
  expect(document.querySelector('math')).toBeNull();
  expect(document.querySelector('mark')?.textContent).toBe(steppedExplanation.steps![0].sourceQuote);
  expect(document.querySelector('mark')?.parentElement?.textContent).toBe(mathMaterial.body);
  expect(screen.getByRole('button', { name: '朗讀這一步' })).toBeTruthy();
  fireEvent.change(screen.getByLabelText('先寫下你的想法'), { target: { value: '筆數不能是零。' } });
  fireEvent.click(screen.getByRole('button', { name: '下一步' }));
  expect(screen.getByText('第 2 步，共 3 步')).toBeTruthy();
  expect(screen.getByRole('heading', { name: '套用平均數公式' })).toBeTruthy();
  expect(document.querySelector('math')).toBeTruthy();
  expect(document.querySelector('mark')?.textContent).toBe('m = s/n');
  fireEvent.click(screen.getByRole('button', { name: '定位這一步的原文' }));
  expect(document.activeElement).toBe(document.querySelector('mark'));
  expect(document.querySelector('mark')?.parentElement?.textContent).toBe(mathMaterial.body);
  fireEvent.click(screen.getByRole('button', { name: '下一步' }));
  expect(screen.getByRole('button', { name: '下一步' }).hasAttribute('disabled')).toBe(true);
  expect(document.querySelector('math')).toBeNull();
  expect(document.querySelector('mark')?.textContent).toBe('筆數必須大於零');
  fireEvent.click(within(navigation).getByRole('button', { name: '第 1 步：辨認總和與筆數' }));
  expect(screen.getByText('第 1 步，共 3 步')).toBeTruthy();
  expect(inputValue('先寫下你的想法')).toBe('筆數不能是零。');
  expect(screen.queryByText(steppedExplanation.answer)).toBeNull();
  expect(mocks.run).toHaveBeenCalledTimes(1);
  expect(mocks.read).not.toHaveBeenCalled();
});

it('preserves the active step through a failed follow-up and resets it when another lesson is selected', async () => {
  mocks.run.mockResolvedValue(steppedExplanation);
  render(<CourseStudyPanel scope={scope} courseTitle="統計" material={mathMaterial} onClose={vi.fn()} />);
  await generate();
  fireEvent.click(screen.getByRole('button', { name: '下一步' }));
  mocks.run.mockRejectedValueOnce(new Error('暫時無法講解'));
  fireEvent.click(screen.getByRole('button', { name: '接著追問' }));
  await screen.findByRole('alert');
  expect(screen.getByText('第 2 步，共 3 步')).toBeTruthy();
  expect(document.querySelector('mark')?.textContent).toBe('m = s/n');
  fireEvent.click(screen.getByRole('button', { name: '接著追問' }));
  await waitFor(() => expect(inputValue('這一段的講解記錄')).toBe('2'));
  expect(screen.getByText('第 1 步，共 3 步')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '下一步' }));
  fireEvent.change(screen.getByLabelText('這一段的講解記錄'), { target: { value: '1' } });
  expect(screen.getByText('第 1 步，共 3 步')).toBeTruthy();
  expect(document.querySelector('mark')?.textContent).toBe(steppedExplanation.steps![0].sourceQuote);
  fireEvent.change(screen.getByLabelText('這次怎麼讀'), { target: { value: 'exam' } });
  expect(screen.queryByRole('navigation', { name: '講解步驟' })).toBeNull();
  expect(document.querySelector('mark')).toBeNull();
  expect(screen.getByText(mathMaterial.body)).toBeTruthy();
  fireEvent.change(screen.getByLabelText('這次怎麼讀'), { target: { value: 'understand' } });
  expect(screen.getByText('第 1 步，共 3 步')).toBeTruthy();
});

it('shows saved legacy explanations without inventing teaching steps', async () => {
  render(<CourseStudyPanel scope={scope} courseTitle="資料庫" material={material} onClose={vi.fn()} />);
  await generate();
  expect(screen.getByText(explanation.explanation)).toBeTruthy();
  expect(screen.queryByRole('navigation', { name: '講解步驟' })).toBeNull();
  expect(screen.getByRole('button', { name: '朗讀這段講解' })).toBeTruthy();
  expect(document.querySelector('mark')?.textContent).toBe(explanation.sourceQuote);
});

it('reviews marked passages in source order with wraparound, without erasing notes or triggering AI', () => {
  const body = `${'甲'.repeat(1600)}${'乙'.repeat(1600)}${'丙'.repeat(100)}`;
  render(<CourseStudyPanel scope={scope} courseTitle="資料庫" material={{ ...material, body }} onClose={vi.fn()} />);
  fireEvent.change(screen.getByLabelText(noteLabel), { target: { value: '第一段的筆記' } });
  fireEvent.click(screen.getByRole('button', { name: '加入待複習' }));
  fireEvent.click(screen.getByRole('button', { name: '下一段' }));
  fireEvent.change(screen.getByLabelText(noteLabel), { target: { value: '第二段的筆記' } });
  fireEvent.click(screen.getByRole('button', { name: '加入待複習' }));
  expect(screen.getByText('目前第 2 / 2 段')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '下一段' }));
  expect(screen.getByText('目前不在待複習段落')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '下一個待複習' }));
  expect(screen.getByText('目前第 1 / 2 段')).toBeTruthy();
  expect(inputValue(noteLabel)).toBe('第一段的筆記');
  fireEvent.click(screen.getByRole('button', { name: '上一個待複習' }));
  expect(screen.getByText('目前第 2 / 2 段')).toBeTruthy();
  expect(inputValue(noteLabel)).toBe('第二段的筆記');
  fireEvent.click(screen.getByRole('button', { name: '已加入待複習' }));
  expect(screen.getByText('目前不在待複習段落')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '上一個待複習' }));
  expect(inputValue(noteLabel)).toBe('第一段的筆記');
  expect(screen.getByText('目前第 1 / 1 段')).toBeTruthy();
  expect(screen.getByRole('button', { name: '下一個待複習' }).hasAttribute('disabled')).toBe(true);
  expect(mocks.run).not.toHaveBeenCalled();
  expect(mocks.read).not.toHaveBeenCalled();
});

it('moves directly between marked PDF pages while retaining page identity and current reading mode', async () => {
  mocks.read.mockResolvedValue({
    format: 'pdf', name: '跨頁複習.pdf', warnings: [], sections: [
      { id: 'page-2', label: '第 2 頁', rows: [{ line: 1, cells: ['主鍵唯一識別資料。'] }], needsOcr: false, warnings: [] },
      { id: 'page-7', label: '第 7 頁', rows: [{ line: 1, cells: ['外鍵建立表格關聯。'] }], needsOcr: false, warnings: [] },
    ],
  });
  render(<CourseStudyPanel scope={scope} courseTitle="資料庫" onClose={vi.fn()} />);
  fireEvent.change(screen.getByLabelText('選擇講義'), {
    target: { files: [new File(['pdf'], '跨頁複習.pdf', { type: 'application/pdf' })] },
  });
  await screen.findByText('主鍵唯一識別資料。');
  fireEvent.click(screen.getByRole('button', { name: '加入待複習' }));
  fireEvent.change(screen.getByLabelText('這次怎麼讀'), { target: { value: 'exam' } });
  fireEvent.change(screen.getByLabelText('閱讀範圍'), { target: { value: '1' } });
  fireEvent.click(screen.getByRole('button', { name: '加入待複習' }));
  fireEvent.click(screen.getByRole('button', { name: '下一個待複習' }));
  expect(inputValue('閱讀範圍')).toBe('0');
  expect(inputValue('這次怎麼讀')).toBe('exam');
  expect(screen.getByText('主鍵唯一識別資料。')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '上一個待複習' }));
  expect(inputValue('閱讀範圍')).toBe('1');
  expect(screen.getByText('外鍵建立表格關聯。')).toBeTruthy();
  expect(mocks.run).not.toHaveBeenCalled();
});

it('shows observed local AI phase timings without suggesting a verified benchmark', async () => {
  mocks.run.mockImplementationOnce(async (request) => {
    request.onTiming?.({ preparationMs: 840, generationMs: 1370, totalMs: 2210, outcome: 'success' });
    return explanation;
  });
  render(<CourseStudyPanel scope={scope} courseTitle="資料庫" material={material} onClose={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: '啟用 AI 講解本段' }));
  await screen.findByRole('region', { name: '本段 AI 講解' });
  expect(screen.getByText((_, element) => element?.tagName === 'P' &&
    !!element.textContent?.includes('準備 840 毫秒') &&
    !!element.textContent?.includes('生成 1370 毫秒') &&
    !!element.textContent?.includes('合計 2210 毫秒'))).toBeTruthy();
  expect(screen.getByText(/不能據此認定冷啟、暖啟或回答正確/)).toBeTruthy();
});

it('validates pasted and previewed progress UTF-8 limits without allocating a Blob on mobile', () => {
  render(<CourseStudyPanel scope={scope} courseTitle="資料庫" material={material} onClose={vi.fn()} />);
  fireEvent.click(screen.getByText('接著上次的進度'));
  const paste = screen.getByLabelText('貼上已備份的進度 JSON') as HTMLTextAreaElement;
  const blobSpy = vi.spyOn(globalThis, 'Blob');
  try {
    fireEvent.change(paste, { target: { value: '{"unfinished":"backup draft"}' } });
    expect(paste.value).toBe('{"unfinished":"backup draft"}');
    // Fewer than 8 MiB UTF-16 code units, but over 8 MiB of UTF-8 bytes.
    const oversizedChinese = '中'.repeat(Math.ceil(COURSE_STUDY_PROGRESS_LIMITS.bytes / 3) + 1);
    expect(oversizedChinese.length).toBeLessThan(COURSE_STUDY_PROGRESS_LIMITS.bytes);
    fireEvent.change(paste, { target: { value: oversizedChinese } });
    expect(paste.value).toBe('{"unfinished":"backup draft"}');
    expect(screen.getByRole('alert').textContent).toContain('超過 8 MiB');

    // A second check at preview time still rejects malformed JSON and keeps
    // the learner's current material, without a duplicate encoded allocation.
    fireEvent.click(screen.getByRole('button', { name: '預覽貼上的進度' }));
    expect(screen.queryByRole('region', { name: '閱讀進度預覽' })).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain('這不是讀書白板的閱讀進度檔');
    expect(screen.getByText(material.body)).toBeTruthy();
    expect(blobSpy).not.toHaveBeenCalled();
  } finally {
    blobSpy.mockRestore();
  }
});

it('rejects oversized pasted JSON before retaining it in state, without losing an earlier backup or the course', () => {
  render(<CourseStudyPanel scope={scope} courseTitle="資料庫" material={material} onClose={vi.fn()} />);
  fireEvent.click(screen.getByText('接著上次的進度'));
  const paste = screen.getByLabelText('貼上已備份的進度 JSON') as HTMLTextAreaElement;
  fireEvent.change(paste, { target: { value: '原本貼上的備份文字' } });
  expect(paste.value).toBe('原本貼上的備份文字');

  // Both a too-long ASCII clipboard and a shorter UTF-16 / larger UTF-8 paste
  // must fail before becoming the controlled textarea value.
  fireEvent.change(paste, { target: { value: 'x'.repeat(COURSE_STUDY_PROGRESS_LIMITS.bytes + 1) } });
  expect(paste.value).toBe('原本貼上的備份文字');
  expect(screen.getByRole('alert').textContent).toContain('超過 8 MiB');

  fireEvent.change(paste, { target: { value: '中'.repeat(Math.ceil(COURSE_STUDY_PROGRESS_LIMITS.bytes / 3) + 1) } });
  expect(paste.value).toBe('原本貼上的備份文字');
  expect(screen.getByRole('alert').textContent).toContain('超過 8 MiB');
  expect(screen.getByText(material.body)).toBeTruthy();
  expect(mocks.run).not.toHaveBeenCalled();

  fireEvent.change(paste, { target: { value: '已改用較小份的 JSON 草稿' } });
  expect(paste.value).toBe('已改用較小份的 JSON 草稿');
  expect(screen.queryByRole('alert')).toBeNull();
});

it('shows only a current source Markdown table and never treats copied values as model output', () => {
  const tableMaterial = {
    id: 'syllabus-credits',
    title: '學分原文表',
    body: [
      '下列為教材直接列出的欄位。',
      '| 科目 | 學分 |',
      '| --- | --- |',
      '| 資料庫 | 3 |',
    ].join('\n'),
  };
  const revised = { ...tableMaterial, body: '新版講義只有段落，不再提供表格。' };
  const view = render(<CourseStudyPanel scope={scope} courseTitle="資料庫"
    material={tableMaterial} onClose={vi.fn()} />);
  const table = screen.getByRole('table', { name: '原文第 2 行起的表格' });
  expect(within(table).getByRole('columnheader', { name: '學分' })).toBeTruthy();
  expect(within(table).getByText('3')).toBeTruthy();
  expect(screen.getByText(/沒有補算、推論或辨識圖片/)).toBeTruthy();
  expect(mocks.run).not.toHaveBeenCalled();

  fireEvent.change(screen.getByLabelText('用自己的話記下這一段'),
    { target: { value: '這個表格我還需要複習。' } });
  view.rerender(<CourseStudyPanel scope={scope} courseTitle="資料庫"
    material={revised} onClose={vi.fn()} />);
  expect(screen.getByRole('table')).toBeTruthy();
  expect(screen.getByRole('heading', { name: '要改讀另一份教材嗎？' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '確認改讀新教材' }));
  expect(screen.queryByRole('table')).toBeNull();
  expect((screen.getByLabelText('用自己的話記下這一段') as HTMLTextAreaElement).value).toBe('');
  expect(mocks.run).not.toHaveBeenCalled();
});
