// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { StudySource } from '@/lib/studyTutor';
import { appendStudyLesson, emptyStudyPassage } from './courseStudySession';
import { parseCourseStudyProgress, serializeCourseStudyProgress, type CourseStudyProgressData } from './courseStudyProgress';
import { buildStudyPracticeDeck, startStudyPracticeRound, updateStudyPracticeRound } from './courseStudyPractice';
import {
  courseStudyPracticeCheckpointFilename,
  isStudyPracticeCheckpoint,
  parseStudyPracticeCheckpoint,
  serializeStudyPracticeCheckpoint,
} from './courseStudyPracticeCheckpoint';

const scope = { platformAccountId: 'pa_11111111-1111-4111-8111-111111111111',
  workspaceId: 'cw_11111111-1111-4111-8111-111111111111' };
const source: StudySource = { id: 'pasted', title: '期中考.pdf', warnings: [], sections: [
  { id: 'page-2', label: '第 2 頁', text: '主鍵用來唯一識別資料，不可以重複。' },
  { id: 'page-5', label: '第 5 頁', text: '交易失敗時必須將全部操作復原。' },
] };

function fixture(): CourseStudyProgressData {
  const first = appendStudyLesson(emptyStudyPassage(), 'understand', {
    question: '', response: { title: '主鍵', explanation: '主鍵能識別資料。', sourceQuote: '主鍵用來唯一識別資料',
      question: '主鍵有什麼作用？', answer: '主鍵能唯一識別一筆資料。' },
  });
  first.needsReview = true;
  first.note = '原本的閱讀筆記';
  const second = appendStudyLesson(emptyStudyPassage(), 'understand', {
    question: '', response: { title: '交易', explanation: '失敗時復原交易。', sourceQuote: '交易失敗時必須',
      question: '交易失敗時怎麼辦？', answer: '全部復原。' },
  });
  second.needsReview = true;
  return {
    scope, source, position: { sectionIndex: 1, passageIndex: 0, mode: 'understand' },
    passages: { '0:0': first, '1:0': second },
  };
}

function checkpoint() {
  const progress = fixture();
  const cards = buildStudyPracticeDeck(source.sections.map((section) => [{
    id: section.id, label: section.label + ' · 第 1 段', text: section.text,
  }]), progress.passages, 'understand').cards;
  let round = startStudyPracticeRound(42, 'understand', cards)!;
  round = updateStudyPracticeRound(round, { type: 'attempt', value: '第一題的試答' });
  round = updateStudyPracticeRound(round, { type: 'toggle_answer' });
  round = updateStudyPracticeRound(round, { type: 'decide', outcome: 'again' });
  round = updateStudyPracticeRound(round, { type: 'attempt', value: '第二題草稿😀' });
  return { progress, round };
}

function tamper(raw: string, change: (item: Record<string, any>) => void): string {
  const decoded = JSON.parse(raw);
  change(decoded);
  return JSON.stringify(decoded);
}

describe('versioned independent review checkpoint', () => {
  it('restores the exact question index, drafts, reveal and self-assessments without modifying the lecture', () => {
    const saved = checkpoint();
    const raw = serializeStudyPracticeCheckpoint(saved);
    const loaded = parseStudyPracticeCheckpoint(raw, scope);
    expect(isStudyPracticeCheckpoint(raw)).toBe(true);
    expect(isStudyPracticeCheckpoint(serializeCourseStudyProgress(saved.progress))).toBe(false);
    expect(loaded.round).toMatchObject({ index: 1, finished: false, revision: 0, mode: 'understand' });
    expect(loaded.round.responses[loaded.round.cards[0].id]).toMatchObject({
      attempt: '第一題的試答', answerVisible: true, outcome: 'again',
    });
    expect(loaded.round.responses[loaded.round.cards[1].id]).toMatchObject({
      attempt: '第二題草稿😀', answerVisible: false, outcome: null,
    });
    expect(loaded.progress.passages).toEqual(parseCourseStudyProgress(serializeCourseStudyProgress(saved.progress), scope).passages);
    expect(loaded.progress.passages['0:0'].note).toBe('原本的閱讀筆記');
    expect(raw).toContain('"version":1');
    expect(JSON.parse(raw).progress.version).toBe(2);
  });

  it('restores an explicit self-assessment after the learner hides the reference answer', () => {
    const saved = checkpoint();
    saved.round = updateStudyPracticeRound(saved.round, { type: 'go', index: 0 });
    saved.round = updateStudyPracticeRound(saved.round, { type: 'toggle_answer' });
    const firstId = saved.round.cards[0].id;
    expect(saved.round.responses[firstId]).toMatchObject({
      attempt: '第一題的試答', outcome: 'again', answerVisible: false,
    });
    const raw = serializeStudyPracticeCheckpoint(saved);
    const restored = parseStudyPracticeCheckpoint(raw, scope);
    expect(restored.round.responses[firstId]).toMatchObject({
      attempt: '第一題的試答', outcome: 'again', answerVisible: false,
    });
    // Editing a hidden, previously assessed answer must still invalidate its rating.
    const edited = updateStudyPracticeRound(restored.round, { type: 'attempt', value: '修正後的試答' });
    expect(edited.responses[firstId]).toMatchObject({ outcome: null, answerVisible: false });
  });

  it('retains an ordered pending subset and never borrows an unrelated lesson', () => {
    const saved = checkpoint();
    const fullIds = saved.round.cards.map((card) => card.id);
    saved.round = updateStudyPracticeRound(saved.round, { type: 'go', index: 0 });
    saved.round = updateStudyPracticeRound(saved.round, { type: 'decide', outcome: 'understood' });
    saved.round = updateStudyPracticeRound(saved.round, { type: 'skip' });
    saved.round = updateStudyPracticeRound(saved.round, { type: 'restart', scope: 'pending' });
    expect(saved.round.cards.map((card) => card.id)).toEqual([fullIds[1]]);
    const loaded = parseStudyPracticeCheckpoint(serializeStudyPracticeCheckpoint(saved), scope);
    expect(loaded.round.cards.map((card) => card.id)).toEqual([fullIds[1]]);
    expect(loaded.round.responses[loaded.round.cards[0].id].attempt).toBe('');
    const returnedToAll = updateStudyPracticeRound(loaded.round, { type: 'restart', scope: 'all' });
    expect(returnedToAll.cards.map((card) => card.id)).toEqual(fullIds);
    expect(returnedToAll.responses[fullIds[0]].attempt).toBe('');
    expect(returnedToAll.responses[fullIds[1]].answerVisible).toBe(false);
  });

  it('rejects a different account or course before replacing any session state', () => {
    const raw = serializeStudyPracticeCheckpoint(checkpoint());
    expect(() => parseStudyPracticeCheckpoint(raw, { ...scope, workspaceId: 'other' })).toThrow(/帳號或課程/);
    expect(() => parseStudyPracticeCheckpoint(raw, { ...scope, platformAccountId: 'other' })).toThrow(/帳號或課程/);
  });

  it('rejects unknown versions, extra fields, malformed JSON and oversized files', () => {
    const raw = serializeStudyPracticeCheckpoint(checkpoint());
    expect(() => parseStudyPracticeCheckpoint(tamper(raw, (item) => { item.version = 999; }), scope)).toThrow();
    expect(() => parseStudyPracticeCheckpoint(tamper(raw, (item) => { item.unexpected = true; }), scope)).toThrow();
    expect(() => parseStudyPracticeCheckpoint(tamper(raw, (item) => { item.practice.mode = 'exam'; }), scope)).toThrow(/練習模式/);
    expect(() => parseStudyPracticeCheckpoint('{bad', scope)).toThrow();
    expect(() => parseStudyPracticeCheckpoint('x'.repeat(8 * 1024 * 1024 + 1), scope)).toThrow(/8 MiB/);
  });

  it('rejects card injection, duplicate/out-of-order IDs and invalid response disclosure', () => {
    const raw = serializeStudyPracticeCheckpoint(checkpoint());
    for (const altered of [
      (item: any) => { item.practice.cardIds.reverse(); },
      (item: any) => { item.practice.cardIds = [item.practice.cardIds[0], item.practice.cardIds[0]]; },
      (item: any) => { item.practice.cardIds[0] = '0:0:exam:1'; },
      (item: any) => { item.practice.responses[item.practice.cardIds[1]].attempt = ''; item.practice.responses[item.practice.cardIds[1]].answerVisible = true; },
      (item: any) => { item.practice.responses[item.practice.cardIds[0]].attempt = ''; },
      (item: any) => { item.practice.index = 99; },
      (item: any) => { item.practice.extra = 'injected'; },
    ]) {
      expect(() => parseStudyPracticeCheckpoint(tamper(raw, altered), scope)).toThrow();
    }
  });

  it('rejects a forged finished summary but restores actual last-question completion and revisits', () => {
    const unfinished = checkpoint();
    const raw = serializeStudyPracticeCheckpoint(unfinished);
    expect(() => parseStudyPracticeCheckpoint(tamper(raw, (item) => {
      item.practice.finished = true;
    }), scope)).toThrow(/最後一題/);

    const completed = checkpoint();
    completed.round = updateStudyPracticeRound(completed.round, { type: 'skip' });
    expect(completed.round.finished).toBe(true);
    const resumed = parseStudyPracticeCheckpoint(serializeStudyPracticeCheckpoint(completed), scope);
    expect(resumed.round.finished).toBe(true);
    expect(resumed.round.responses[resumed.round.cards[1].id].outcome).toBe('skipped');

    const revisited = updateStudyPracticeRound(completed.round, { type: 'go', index: 1 });
    expect(revisited.finished).toBe(false);
    expect(() => parseStudyPracticeCheckpoint(serializeStudyPracticeCheckpoint({
      progress: completed.progress, round: revisited,
    }), scope)).not.toThrow();
  });

  it('rejects a corrupted underlying lesson or source instead of trusting cached answer text', () => {
    const raw = serializeStudyPracticeCheckpoint(checkpoint());
    expect(() => parseStudyPracticeCheckpoint(tamper(raw, (item) => {
      item.progress.passages['0:0'].modes.understand.lessons[0].response.sourceQuote = '不存在的原文';
    }), scope)).toThrow(/講解/);
    expect(() => parseStudyPracticeCheckpoint(tamper(raw, (item) => {
      item.progress.source.sections[0].text = '改掉的教材';
    }), scope)).toThrow();
  });

  it('creates a safe Unicode filename and treats malformed data as not-a-checkpoint', () => {
    expect(courseStudyPracticeCheckpointFilename('../資料庫.pdf')).toBe('資料庫-逐題練習.campus-practice.json');
    expect(courseStudyPracticeCheckpointFilename('資料庫.markdown')).toBe('資料庫-逐題練習.campus-practice.json');
    expect(courseStudyPracticeCheckpointFilename('😀'.repeat(100))).toBe('😀'.repeat(48) + '-逐題練習.campus-practice.json');
    expect(isStudyPracticeCheckpoint('{oops')).toBe(false);
  });

  it('rejects over-limit UTF-16 and multi-byte UTF-8 payloads before JSON parsing', () => {
    // 3 MiB of Han characters fits the 8 MiB UTF-16 length guard but uses
    // over 9 MiB on disk. Format detection must not parse it on mobile.
    const multibyte = JSON.stringify({
      format: 'campus-one-study-practice',
      payload: '中'.repeat(3 * 1024 * 1024),
    });
    expect(multibyte.length).toBeLessThan(8 * 1024 * 1024);
    expect(new TextEncoder().encode(multibyte).byteLength).toBeGreaterThan(8 * 1024 * 1024);
    const parse = vi.spyOn(JSON, 'parse');
    try {
      expect(isStudyPracticeCheckpoint(' '.repeat(8 * 1024 * 1024 + 1))).toBe(false);
      expect(isStudyPracticeCheckpoint(multibyte)).toBe(false);
      expect(parse).not.toHaveBeenCalled();
    } finally {
      parse.mockRestore();
    }
    // A small, valid Chinese backup must still be recognized and restored.
    const valid = serializeStudyPracticeCheckpoint(checkpoint());
    expect(isStudyPracticeCheckpoint(valid)).toBe(true);
    expect(parseStudyPracticeCheckpoint(valid, scope).round.cards).toHaveLength(2);
  });
});
