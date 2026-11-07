import { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CourseStudyPractice } from './CourseStudyPractice';
import {
  startStudyPracticeRound,
  updateStudyPracticeRound,
  type StudyPracticeAction,
  type StudyPracticeCard,
  type StudyPracticeRound,
} from './courseStudyPractice';

const model = vi.hoisted(() => ({ run: vi.fn(), availability: vi.fn() }));
vi.mock('@/lib/studyTutorRuntime', () => ({ runStudyTutor: model.run, getStudyTutorAvailability: model.availability }));

const cards: StudyPracticeCard[] = [
  {
    id: '0:0:understand:1', sectionNumber: 0, partNumber: 0, mode: 'understand', lessonId: 1,
    label: '第 2 頁 · 第 1 段', question: '主鍵的用途是什麼？', answer: '用來唯一識別每筆資料，避免資料身分重複。',
    sourceQuote: '主鍵用來唯一識別資料', sourceText: '資料庫原文：主鍵用來唯一識別資料，並且不可重複。',
  },
  {
    id: '1:0:understand:3', sectionNumber: 1, partNumber: 0, mode: 'understand', lessonId: 3,
    label: '第 5 頁 · 第 1 段', question: '外鍵為什麼要參照另一張表？', answer: '用來建立資料表之間的關聯，並維持參照完整性。',
    sourceQuote: '外鍵參照另一張表', sourceText: '關聯原文：外鍵參照另一張表的主鍵。',
  },
  {
    id: '1:1:understand:2', sectionNumber: 1, partNumber: 1, mode: 'understand', lessonId: 2,
    label: '第 5 頁 · 第 2 段', question: '交易中的部分操作失敗，應如何處理？', answer: '讓整組操作復原，維持所有操作一起成功或失敗。',
    sourceQuote: '交易必須一起成功或失敗', sourceText: '交易原文：交易必須一起成功或失敗，失敗時全部復原。',
  },
];

const callbacks = () => ({ onExit: vi.fn(), onReadSource: vi.fn(), onDownload: vi.fn(), onAction: vi.fn() });
type Callbacks = ReturnType<typeof callbacks>;

function Controller({ deck = cards, initialRound, handlers = callbacks() }: {
  deck?: StudyPracticeCard[];
  initialRound?: StudyPracticeRound;
  handlers?: Callbacks;
}) {
  const [round, setRound] = useState(() => initialRound ?? startStudyPracticeRound(7, 'understand', deck)!);
  return <CourseStudyPractice round={round}
    onAction={(action: StudyPracticeAction) => {
      handlers.onAction(action);
      setRound((current) => updateStudyPracticeRound(current, action));
    }}
    onExit={handlers.onExit} onReadSource={handlers.onReadSource} onDownload={handlers.onDownload} />;
}

const answerInput = () => screen.getByLabelText('這一題，我的回答') as HTMLTextAreaElement;
const writeAnswer = (value = '我先用自己的話回答。') => fireEvent.change(answerInput(), { target: { value } });
const revealAnswer = () => fireEvent.click(screen.getByRole('button', { name: '對照參考回答' }));
const skip = () => fireEvent.click(screen.getByRole('button', { name: '略過這題' }));
const selectQuestion = (number: number) => fireEvent.click(within(screen.getByRole('navigation', { name: '本輪題目' }))
  .getByRole('button', { name: new RegExp(`^第 ${number} 題：`) }));

function decide(outcome: 'again' | 'understood') {
  writeAnswer();
  revealAnswer();
  fireEvent.click(screen.getByRole('button', { name: outcome === 'again' ? '還要加強' : '這題已理解' }));
}

function summaryCount(label: string): string | null | undefined {
  return within(screen.getByRole('region', { name: '本輪練習摘要' })).getByText(label).nextElementSibling?.textContent;
}

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('starts with an independent blank answer and keeps the source and reference answers out of the DOM', () => {
  const handlers = callbacks();
  render(<Controller handlers={handlers} />);
  expect(screen.getByRole('heading', { name: '第 1 題' })).toBeTruthy();
  expect(screen.getByRole('status').textContent).toBe('第 1 題／共 3 題');
  expect(screen.getByText('逐題複習 · 理解概念')).toBeTruthy();
  expect(answerInput().value).toBe('');
  expect(answerInput().maxLength).toBe(2000);
  expect(screen.getByRole('button', { name: '對照參考回答' }).hasAttribute('disabled')).toBe(true);
  expect(screen.getByRole('button', { name: '上一題' }).hasAttribute('disabled')).toBe(true);
  expect(screen.queryByRole('region', { name: '本題原文提示' })).toBeNull();
  expect(screen.queryByRole('region', { name: '本題參考回答' })).toBeNull();
  for (const card of cards) {
    expect(screen.queryByText(card.answer)).toBeNull();
    expect(screen.queryByText(card.sourceText)).toBeNull();
  }
  expect(screen.queryByRole('button', { name: '這題已理解' })).toBeNull();
  expect(handlers.onAction).not.toHaveBeenCalled();
  expect(screen.getByText('本輪回答獨立於原本試答，離開前可下載紀錄；閱讀進度檔不含本輪練習。')).toBeTruthy();
});

it('requires a nonblank answer before revealing and hides both reference and self-assessment when edited', () => {
  render(<Controller />);
  writeAnswer(' \n  ');
  expect(screen.getByRole('button', { name: '對照參考回答' }).hasAttribute('disabled')).toBe(true);
  revealAnswer();
  expect(screen.queryByText(cards[0].answer)).toBeNull();
  writeAnswer('主鍵代表一筆資料的身分。');
  revealAnswer();
  expect(screen.getByRole('region', { name: '本題參考回答' }).textContent).toContain(cards[0].answer);
  expect(screen.getByRole('button', { name: '收起參考回答' }).getAttribute('aria-expanded')).toBe('true');
  expect(screen.getByRole('group', { name: '本題自評' })).toBeTruthy();
  writeAnswer('修改：主鍵還不能重複。');
  expect(screen.queryByRole('region', { name: '本題參考回答' })).toBeNull();
  expect(screen.queryByRole('group', { name: '本題自評' })).toBeNull();
  expect(screen.getByRole('button', { name: '對照參考回答' }).getAttribute('aria-expanded')).toBe('false');
  expect(answerInput().value).toBe('修改：主鍵還不能重複。');
});

it('isolates drafts and hint visibility between questions and allows bounded previous navigation', () => {
  render(<Controller />);
  writeAnswer('第一題的草稿');
  fireEvent.click(screen.getByRole('button', { name: '查看原文提示' }));
  selectQuestion(2);
  expect(answerInput().value).toBe('');
  expect(screen.queryByRole('region', { name: '本題原文提示' })).toBeNull();
  writeAnswer('第二題的草稿');
  fireEvent.click(screen.getByRole('button', { name: '上一題' }));
  expect(answerInput().value).toBe('第一題的草稿');
  expect(screen.getByRole('region', { name: '本題原文提示' }).textContent).toContain(cards[0].sourceText);
  expect(screen.getByRole('button', { name: '上一題' }).hasAttribute('disabled')).toBe(true);
  selectQuestion(2);
  expect(answerInput().value).toBe('第二題的草稿');
  expect(screen.queryByText(cards[0].sourceText)).toBeNull();
  expect(screen.queryByRole('region', { name: '本題參考回答' })).toBeNull();
});

it('only reveals the source on request and marks the exact first quotation', () => {
  const sourceText = `前文，${cards[0].sourceQuote}。後文又說${cards[0].sourceQuote}。`;
  render(<Controller deck={[{ ...cards[0], sourceText }]} />);
  const hint = screen.getByRole('button', { name: '查看原文提示' });
  expect(hint.getAttribute('aria-expanded')).toBe('false');
  fireEvent.click(hint);
  const source = screen.getByRole('region', { name: '本題原文提示' });
  expect(source.querySelector('blockquote')?.textContent).toBe(sourceText);
  expect(source.querySelectorAll('mark')).toHaveLength(1);
  expect(source.querySelector('mark')?.textContent).toBe(cards[0].sourceQuote);
  expect(within(source).getByText('相同引句在本段出現 2 處，目前標示第一處。')).toBeTruthy();
  expect(screen.queryByText(cards[0].answer)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '收起原文提示' }));
  expect(screen.queryByRole('region', { name: '本題原文提示' })).toBeNull();
});

it('shows each self-assessment count after a finite round without inventing a score', () => {
  render(<Controller />);
  skip();
  decide('again');
  decide('understood');
  expect(screen.getByRole('status').textContent).toBe('本輪結束，共 3 題');
  expect(screen.queryByLabelText('這一題，我的回答')).toBeNull();
  expect(summaryCount('自評理解')).toBe('1 題');
  expect(summaryCount('還要加強')).toBe('1 題');
  expect(summaryCount('略過')).toBe('1 題');
  expect(summaryCount('未完成')).toBe('0 題');
  expect(screen.getByText('以下是你的自評紀錄，不是答題正確率；未完成的題目仍可從下方回看。')).toBeTruthy();
  expect(screen.queryByText(/\d\s*%/)).toBeNull();
  expect(screen.getByRole('button', { name: '重練待加強題（2 題）' })).toBeTruthy();
  expect(screen.getByRole('button', { name: '下載本輪練習' })).toBeTruthy();
  expect(screen.getByRole('button', { name: '回到閱讀' })).toBeTruthy();
});

it('counts untouched questions as unfinished when jumping to the last card and allows returning from the summary', () => {
  render(<Controller />);
  selectQuestion(3);
  skip();
  expect(summaryCount('未完成')).toBe('2 題');
  expect(summaryCount('略過')).toBe('1 題');
  selectQuestion(1);
  expect(screen.queryByRole('region', { name: '本輪練習摘要' })).toBeNull();
  expect(screen.getByRole('heading', { name: '第 1 題' })).toBeTruthy();
  expect(answerInput().value).toBe('');
});

it('retries only cards not marked understood in source order with fresh drafts and hidden disclosures', () => {
  render(<Controller />);
  decide('understood');
  fireEvent.click(screen.getByRole('button', { name: '查看原文提示' }));
  decide('again');
  writeAnswer('略過前先記下第三題的想法');
  revealAnswer();
  skip();
  fireEvent.click(screen.getByRole('button', { name: '重練待加強題（2 題）' }));
  expect(screen.getByRole('status').textContent).toBe('第 1 題／共 2 題');
  expect(screen.getByText(cards[1].question)).toBeTruthy();
  expect(screen.queryByText(cards[0].question)).toBeNull();
  expect(answerInput().value).toBe('');
  expect(screen.queryByRole('region', { name: '本題原文提示' })).toBeNull();
  expect(screen.queryByRole('region', { name: '本題參考回答' })).toBeNull();
  expect(screen.queryByRole('button', { name: '這題已理解' })).toBeNull();
  selectQuestion(2);
  expect(screen.getByText(cards[2].question)).toBeTruthy();
  expect(answerInput().value).toBe('');
  expect(within(screen.getByRole('navigation', { name: '本輪題目' })).getAllByRole('button')).toHaveLength(2);
});

it('can restart the entire current round and disables pending retry when every card is self-marked understood', () => {
  render(<Controller deck={cards.slice(0, 2)} />);
  decide('understood');
  decide('understood');
  expect(screen.getByRole('button', { name: '重練待加強題（0 題）' }).hasAttribute('disabled')).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '重練本輪全部' }));
  expect(screen.getByRole('status').textContent).toBe('第 1 題／共 2 題');
  expect(answerInput().value).toBe('');
  expect(screen.queryByRole('region', { name: '本題參考回答' })).toBeNull();
  expect(within(screen.getByRole('navigation', { name: '本輪題目' })).getAllByText('未完成')).toHaveLength(2);
});

it('renders question, source, quote and reference markup as literal text', () => {
  const malicious = {
    ...cards[0], question: '<img src=x onerror=alert(1)> 這題要怎麼答？', answer: '<script>alert(2)</script>',
    sourceQuote: '<iframe src="https://example.com"></iframe>',
    sourceText: '教材原文：<iframe src="https://example.com"></iframe>，仍應只呈現文字。',
  };
  const { container } = render(<Controller deck={[malicious]} />);
  expect(screen.getByText(malicious.question)).toBeTruthy();
  expect(container.querySelector('img, script, iframe')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '查看原文提示' }));
  expect(screen.getByRole('region', { name: '本題原文提示' }).querySelector('mark')?.textContent).toBe(malicious.sourceQuote);
  writeAnswer('我自己的回答');
  revealAnswer();
  expect(screen.getByText(malicious.answer)).toBeTruthy();
  expect(container.querySelector('img, script, iframe')).toBeNull();
});

it('dispatches explicit download, read-source and exit callbacks without loading or calling the model', () => {
  const worker = vi.fn();
  vi.stubGlobal('Worker', worker);
  const handlers = callbacks();
  render(<Controller handlers={handlers} />);
  expect(handlers.onDownload).not.toHaveBeenCalled();
  expect(handlers.onExit).not.toHaveBeenCalled();
  expect(handlers.onReadSource).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '下載本輪練習' }));
  expect(handlers.onDownload).toHaveBeenCalledTimes(1);
  selectQuestion(2);
  fireEvent.click(screen.getByRole('button', { name: '回白板看這段' }));
  expect(handlers.onReadSource).toHaveBeenCalledWith(cards[1]);
  fireEvent.click(screen.getByRole('button', { name: '回到閱讀' }));
  expect(handlers.onExit).toHaveBeenCalledTimes(1);
  selectQuestion(3);
  skip();
  fireEvent.click(screen.getByRole('button', { name: '下載本輪練習' }));
  fireEvent.click(screen.getByRole('button', { name: '回到閱讀' }));
  expect(handlers.onDownload).toHaveBeenCalledTimes(2);
  expect(handlers.onExit).toHaveBeenCalledTimes(2);
  expect(model.run).not.toHaveBeenCalled();
  expect(model.availability).not.toHaveBeenCalled();
  expect(worker).not.toHaveBeenCalled();
});

it('moves focus on question and summary transitions without stealing focus while typing', () => {
  render(<Controller deck={cards.slice(0, 2)} />);
  expect(document.activeElement).toBe(screen.getByRole('heading', { name: '第 1 題' }));
  answerInput().focus();
  writeAnswer('輸入中不應跳走');
  expect(document.activeElement).toBe(answerInput());
  skip();
  expect(document.activeElement).toBe(screen.getByRole('heading', { name: '第 2 題' }));
  skip();
  expect(document.activeElement).toBe(screen.getByRole('heading', { name: '本輪練習摘要' }));
  selectQuestion(1);
  expect(document.activeElement).toBe(screen.getByRole('heading', { name: '第 1 題' }));
  expect(answerInput().value).toBe('輸入中不應跳走');
});

it('focuses the heading for a replacement round even when it reuses the same card IDs', () => {
  const handlers = callbacks();
  const first = startStudyPracticeRound(1, 'understand', cards)!;
  const view = render(<CourseStudyPractice round={first} {...handlers} />);
  answerInput().focus();
  view.rerender(<CourseStudyPractice round={startStudyPracticeRound(2, 'understand', cards)!} {...handlers} />);
  expect(document.activeElement).toBe(screen.getByRole('heading', { name: '第 1 題' }));
  expect(answerInput().value).toBe('');
});
