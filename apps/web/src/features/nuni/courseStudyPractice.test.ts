// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { StudyMode, StudyPassage, StudyTutorTurn } from '@/lib/studyTutor';
import { appendStudyLesson, emptyStudyPassage, STUDY_SESSION_LIMITS, type StudyPassageMemory } from './courseStudySession';
import {
  buildCourseStudyPracticeNotes,
  buildStudyPracticeDeck,
  courseStudyPracticeFilename,
  getStudyPracticeSummary,
  nextUnreviewedStudyPracticeIndex,
  previousUnreviewedStudyPracticeIndex,
  startStudyPracticeRound,
  updateStudyPracticeRound,
  type StudyPracticeAction,
  type StudyPracticeCard,
  type StudyPracticeRound,
} from './courseStudyPractice';

function sourcePassages(): StudyPassage[][] {
  return [
    [
      { id: 'page-3:part-1', label: '第 3 頁 · 第 1 段', text: '主鍵用來唯一識別紀錄。' },
      { id: 'page-3:part-2', label: '第 3 頁 · 第 2 段', text: '外鍵用來建立關聯。' },
    ],
    [{ id: 'page-7:part-1', label: '第 7 頁 · 第 1 段', text: '索引協助搜尋資料。' }],
  ];
}

function lessonTurn(passage: StudyPassage, tag: string): StudyTutorTurn {
  return {
    question: `講解時的追問：${tag}`,
    response: {
      title: tag, explanation: `講解：${tag}`, sourceQuote: passage.text,
      question: `複習題：${tag}`, answer: `參考答案秘密：${tag}`,
    },
  };
}

function markedMemory(passage: StudyPassage, tag: string, mode: StudyMode = 'understand'): StudyPassageMemory {
  return { ...appendStudyLesson(emptyStudyPassage(), mode, lessonTurn(passage, tag)), needsReview: true };
}

function practiceCards(count = 3): StudyPracticeCard[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `0:${index}:understand:${index + 1}`,
    sectionNumber: 0,
    partNumber: index,
    mode: 'understand',
    lessonId: index + 1,
    label: `第 7 頁 · 第 ${index + 1} 段`,
    question: `第 ${index + 1} 個自我檢查問題？`,
    answer: `參考答案秘密 ${index + 1}`,
    sourceQuote: `原文引句 ${index + 1}`,
    sourceText: `  原文引句 ${index + 1}\r\n更多教材內容 ${index + 1}。`,
  }));
}

function round(count = 3): StudyPracticeRound {
  return startStudyPracticeRound(17, 'understand', practiceCards(count))!;
}

function change(initial: StudyPracticeRound, ...actions: StudyPracticeAction[]): StudyPracticeRound {
  return actions.reduce(updateStudyPracticeRound, initial);
}

function decide(initial: StudyPracticeRound, outcome: 'again' | 'understood', attempt = '我自己的試答') {
  return change(initial, { type: 'attempt', value: attempt }, { type: 'toggle_answer' }, { type: 'decide', outcome });
}

describe('source-ordered review deck snapshots', () => {
  it('uses only marked passages and the selected branch of the requested reading mode', () => {
    const passages = sourcePassages();
    let selected = markedMemory(passages[0][0], '起點');
    selected = appendStudyLesson(selected, 'understand', lessonTurn(passages[0][0], '選取的分支'), 1);
    selected = appendStudyLesson(selected, 'understand', lessonTurn(passages[0][0], '較新的其他分支'), 1);
    selected.modes.understand.selectedLessonId = 2;
    selected = appendStudyLesson(selected, 'exam', lessonTurn(passages[0][0], '考前讀法'));
    const memories = {
      '9:9': markedMemory(passages[0][0], '來源外的舊資料'),
      '1:0': markedMemory(passages[1][0], '最後一段'),
      '0:1': { ...markedMemory(passages[0][1], '沒有標記'), needsReview: false },
      '0:0': selected,
    };
    const before = JSON.stringify({ passages, memories });
    const deck = buildStudyPracticeDeck(passages, memories, 'understand');
    expect(deck.markedCount).toBe(2);
    expect(deck.missingCount).toBe(0);
    expect(deck.cards.map((card) => card.id)).toEqual(['0:0:understand:2', '1:0:understand:1']);
    expect(deck.cards.map((card) => card.question)).toEqual(['複習題：選取的分支', '複習題：最後一段']);
    expect(deck.cards.map((card) => [card.sectionNumber, card.partNumber, card.label])).toEqual([
      [0, 0, '第 3 頁 · 第 1 段'], [1, 0, '第 7 頁 · 第 1 段'],
    ]);
    const exam = buildStudyPracticeDeck(passages, memories, 'exam');
    expect(exam.cards.map((card) => card.question)).toEqual(['複習題：考前讀法']);
    expect(exam).toMatchObject({ markedCount: 2, missingCount: 1 });
    expect(JSON.stringify({ passages, memories })).toBe(before);
  });

  it('counts missing selected lessons without borrowing another mode or a newer stored answer', () => {
    const passages = sourcePassages();
    const otherMode = markedMemory(passages[0][0], '別種讀法', 'practice');
    const noSelection = markedMemory(passages[0][1], '未選取');
    noSelection.modes.understand.selectedLessonId = null;
    const missingSelection = markedMemory(passages[1][0], '尚存但未選取');
    missingSelection.modes.understand.selectedLessonId = 99;
    const deck = buildStudyPracticeDeck(passages, {
      '0:0': otherMode, '0:1': noSelection, '1:0': missingSelection,
    }, 'understand');
    expect(deck).toEqual({ cards: [], markedCount: 3, missingCount: 3 });
    expect(startStudyPracticeRound(2, 'understand', deck.cards)).toBeNull();
  });

  it('retains actual section and part order rather than record insertion order', () => {
    const passages = sourcePassages();
    const memories = {
      '1:0': markedMemory(passages[1][0], '三'),
      '0:1': markedMemory(passages[0][1], '二'),
      '0:0': markedMemory(passages[0][0], '一'),
    };
    expect(buildStudyPracticeDeck(passages, memories, 'understand').cards.map((card) =>
      [card.sectionNumber, card.partNumber, card.question])).toEqual([
      [0, 0, '複習題：一'], [0, 1, '複習題：二'], [1, 0, '複習題：三'],
    ]);
  });

  it('copies primitive card data and starts clean even when the lecture already has an attempt and revealed answer', () => {
    const passages = sourcePassages();
    const memory = markedMemory(passages[0][0], '原講解');
    Object.assign(memory.modes.understand.lessons[0], { attempt: '閱讀時寫過的舊試答', answerVisible: true });
    const before = JSON.stringify(memory);
    const deck = buildStudyPracticeDeck(passages, { '0:0': memory }, 'understand');
    const started = startStudyPracticeRound(7, 'understand', deck.cards)!;
    expect(started).toMatchObject({ revision: 7, mode: 'understand', index: 0, finished: false });
    expect(started.responses[deck.cards[0].id]).toEqual({
      attempt: '', answerVisible: false, hintVisible: false, outcome: null,
    });
    expect(Object.values(deck.cards[0]).every((value) => typeof value === 'string' || typeof value === 'number')).toBe(true);
    expect(JSON.stringify(memory)).toBe(before);
    expect(buildCourseStudyPracticeNotes('資料庫', '講義', started).startsWith('nuni 讀書白板・本輪逐題複習\n')).toBe(true);
    expect(buildCourseStudyPracticeNotes('資料庫', '講義', started)).not.toContain('閱讀時寫過的舊試答');
    expect(buildCourseStudyPracticeNotes('資料庫', '講義', started)).not.toContain('參考答案秘密');
    memory.modes.understand.lessons[0].response.question = '稍後改變的問題';
    passages[0][0].text = '稍後替換的來源';
    expect(deck.cards[0].question).toBe('複習題：原講解');
    expect(deck.cards[0].sourceText).toBe('主鍵用來唯一識別紀錄。');
    deck.cards[0].question = '呼叫端改變題卡';
    deck.cards.push(practiceCards()[1]);
    expect(started.cards).toHaveLength(1);
    expect(started.cards[0].question).toBe('複習題：原講解');
  });
});

describe('finite independent practice rounds', () => {
  it('requires this round\'s nonblank attempt and explicit answer reveal before self-assessment', () => {
    const initial = round();
    expect(updateStudyPracticeRound(initial, { type: 'toggle_answer' })).toBe(initial);
    expect(updateStudyPracticeRound(initial, { type: 'decide', outcome: 'understood' })).toBe(initial);
    const blank = updateStudyPracticeRound(initial, { type: 'attempt', value: ' \n\t' });
    expect(updateStudyPracticeRound(blank, { type: 'toggle_answer' })).toBe(blank);
    expect(updateStudyPracticeRound(blank, { type: 'decide', outcome: 'again' })).toBe(blank);
    const attempted = updateStudyPracticeRound(blank, { type: 'attempt', value: '我認為主鍵不會重複。' });
    expect(updateStudyPracticeRound(attempted, { type: 'decide', outcome: 'understood' })).toBe(attempted);
    const revealed = updateStudyPracticeRound(attempted, { type: 'toggle_answer' });
    const assessed = updateStudyPracticeRound(revealed, { type: 'decide', outcome: 'understood' });
    expect(assessed.index).toBe(1);
    expect(assessed.responses[assessed.cards[0].id]).toMatchObject({ answerVisible: true, outcome: 'understood' });
    expect(initial.responses[initial.cards[0].id].attempt).toBe('');
  });

  it('keeps attempts, hint and reveal state isolated while moving backward and forward', () => {
    const initial = round();
    const before = JSON.stringify(initial);
    const first = decide(change(initial, { type: 'toggle_hint' }), 'again', '第一題的試答');
    const second = change(first, { type: 'attempt', value: '第二題的試答' }, { type: 'go', index: 0 });
    expect(second.responses[second.cards[0].id]).toEqual({
      attempt: '第一題的試答', answerVisible: true, hintVisible: true, outcome: 'again',
    });
    expect(second.responses[second.cards[1].id]).toEqual({
      attempt: '第二題的試答', answerVisible: false, hintVisible: false, outcome: null,
    });
    const forward = updateStudyPracticeRound(second, { type: 'go', index: 1 });
    expect(forward.responses).toBe(second.responses);
    expect(JSON.stringify(initial)).toBe(before);
  });

  it('invalidates prior self-assessment when the attempt changes or the learner hides the answer', () => {
    const assessed = updateStudyPracticeRound(decide(round(), 'understood', '原試答'), { type: 'go', index: 0 });
    const id = assessed.cards[0].id;
    const edited = updateStudyPracticeRound(assessed, { type: 'attempt', value: '新的完整試答' });
    expect(edited.responses[id]).toMatchObject({ attempt: '新的完整試答', answerVisible: false, outcome: null });
    const hidden = updateStudyPracticeRound(assessed, { type: 'toggle_answer' });
    expect(hidden.responses[id]).toMatchObject({ attempt: '原試答', answerVisible: false, outcome: null });
    expect(getStudyPracticeSummary(hidden).pending).toBe(3);
    expect(updateStudyPracticeRound(assessed, { type: 'attempt', value: '原試答' })).toBe(assessed);
    expect(assessed.responses[id]).toMatchObject({ answerVisible: true, outcome: 'understood' });
  });

  it('rejects an oversized attempt as a whole and accepts the exact character boundary', () => {
    const initial = change(round(), { type: 'attempt', value: '保留的完整試答' }, { type: 'toggle_answer' });
    expect(updateStudyPracticeRound(initial, {
      type: 'attempt', value: '字'.repeat(STUDY_SESSION_LIMITS.attemptCharacters + 1),
    })).toBe(initial);
    const accepted = updateStudyPracticeRound(initial, {
      type: 'attempt', value: '字'.repeat(STUDY_SESSION_LIMITS.attemptCharacters),
    });
    expect(accepted.responses[accepted.cards[0].id].attempt).toHaveLength(STUDY_SESSION_LIMITS.attemptCharacters);
    expect(accepted.responses[accepted.cards[0].id].answerVisible).toBe(false);
  });

  it('can show source hints without revealing an answer or claiming understanding', () => {
    const initial = round();
    const shown = updateStudyPracticeRound(initial, { type: 'toggle_hint' });
    expect(shown.responses[shown.cards[0].id]).toEqual({
      attempt: '', answerVisible: false, hintVisible: true, outcome: null,
    });
    const hidden = updateStudyPracticeRound(shown, { type: 'toggle_hint' });
    expect(hidden.responses).toEqual(initial.responses);
    expect(shown.responses[shown.cards[0].id].hintVisible).toBe(true);
  });

  it('skips without exposing an answer and preserves the learner\'s existing draft and hint state', () => {
    const attempted = change(round(), { type: 'attempt', value: '還沒想好' }, { type: 'toggle_hint' }, { type: 'toggle_answer' });
    const skipped = updateStudyPracticeRound(attempted, { type: 'skip' });
    expect(skipped.index).toBe(1);
    expect(skipped.responses[skipped.cards[0].id]).toEqual({
      attempt: '還沒想好', answerVisible: false, hintVisible: true, outcome: 'skipped',
    });
    expect(attempted.responses[attempted.cards[0].id].answerVisible).toBe(true);
  });

  it('finishes at the last decision or skip and ignores further answer actions until explicit navigation', () => {
    let completed = round(3);
    completed = decide(completed, 'understood');
    expect(completed).toMatchObject({ index: 1, finished: false });
    completed = decide(completed, 'again');
    expect(completed).toMatchObject({ index: 2, finished: false });
    completed = updateStudyPracticeRound(completed, { type: 'skip' });
    expect(completed).toMatchObject({ index: 2, finished: true });
    const blocked: StudyPracticeAction[] = [
      { type: 'attempt', value: '完成後的改寫' }, { type: 'toggle_answer' }, { type: 'toggle_hint' },
      { type: 'decide', outcome: 'understood' }, { type: 'skip' },
    ];
    for (const action of blocked) expect(updateStudyPracticeRound(completed, action)).toBe(completed);
    const revisited = updateStudyPracticeRound(completed, { type: 'go', index: 2 });
    expect(revisited).toMatchObject({ index: 2, finished: false });
    expect(revisited.responses).toBe(completed.responses);
    expect(decide(round(1), 'again')).toMatchObject({ index: 0, finished: true });
  });

  it.each([-1, 3, 0.5, Number.NaN, Number.POSITIVE_INFINITY])('ignores an invalid target index (%s)', (index) => {
    const initial = round();
    const completed = change(initial, { type: 'go', index: 2 }, { type: 'skip' });
    expect(updateStudyPracticeRound(initial, { type: 'go', index })).toBe(initial);
    expect(updateStudyPracticeRound(completed, { type: 'go', index })).toBe(completed);
  });

  it('summarizes self-assessment separately from attempts and retains unanswered cards in the pending count', () => {
    let current = decide(round(4), 'understood', '第一題');
    current = decide(current, 'again', '第二題');
    current = updateStudyPracticeRound(current, { type: 'skip' });
    expect(getStudyPracticeSummary(current)).toEqual({
      total: 4, answered: 2, understood: 1, again: 1, skipped: 1, unreviewed: 1, pending: 3,
    });
    current = updateStudyPracticeRound(current, { type: 'attempt', value: '最後一題還沒自評' });
    expect(getStudyPracticeSummary(current)).toEqual({
      total: 4, answered: 3, understood: 1, again: 1, skipped: 1, unreviewed: 1, pending: 3,
    });
  });

  it('restarts only pending cards in original order and clears every prior round disclosure', () => {
    let current = decide(round(4), 'understood', '第一題');
    current = decide(current, 'again', '第二題');
    current = change(current, { type: 'toggle_hint' }, { type: 'skip' }, { type: 'attempt', value: '未自評的試答' });
    const before = JSON.stringify(current);
    const retried = updateStudyPracticeRound(current, { type: 'restart', scope: 'pending' });
    expect(retried.cards.map((card) => card.id)).toEqual(current.cards.slice(1).map((card) => card.id));
    expect(retried).toMatchObject({ revision: 17, mode: 'understand', index: 0, finished: false });
    expect(Object.keys(retried.responses)).toEqual(retried.cards.map((card) => card.id));
    expect(Object.values(retried.responses)).toEqual(Array.from({ length: 3 }, () => ({
      attempt: '', answerVisible: false, hintVisible: false, outcome: null,
    })));
    expect(getStudyPracticeSummary(retried)).toMatchObject({ total: 3, understood: 0, answered: 0, pending: 3, unreviewed: 3 });
    expect(JSON.stringify(current)).toBe(before);
    expect(updateStudyPracticeRound(retried, { type: 'restart', scope: 'all' }).cards).toEqual(current.cards);
  });

  it('can recover the original source-ordered questions after multiple pending-only retries', () => {
    const original = round(3);
    let current = decide(original, 'understood', '第一題已理解');
    current = decide(current, 'again', '第二題需要加強');
    current = updateStudyPracticeRound(current, { type: 'skip' });
    const firstRetry = updateStudyPracticeRound(current, { type: 'restart', scope: 'pending' });
    expect(firstRetry.cards.map((card) => card.id)).toEqual(original.cards.slice(1).map((card) => card.id));

    current = decide(firstRetry, 'understood', '第二題後來理解了');
    current = updateStudyPracticeRound(current, { type: 'skip' });
    const secondRetry = updateStudyPracticeRound(current, { type: 'restart', scope: 'pending' });
    expect(secondRetry.cards.map((card) => card.id)).toEqual([original.cards[2].id]);
    const restoredFull = updateStudyPracticeRound(secondRetry, { type: 'restart', scope: 'all' });
    expect(restoredFull.cards.map((card) => card.id)).toEqual(original.cards.map((card) => card.id));
    expect(restoredFull.allCards).toEqual(original.allCards);
    expect(Object.values(restoredFull.responses)).toEqual(Array.from({ length: 3 }, () => ({
      attempt: '', answerVisible: false, hintVisible: false, outcome: null,
    })));
    expect(getStudyPracticeSummary(restoredFull)).toMatchObject({ total: 3, pending: 3, understood: 0 });
    expect(firstRetry.cards).toHaveLength(2);
    expect(original.cards).toHaveLength(3);
  });

  it('keeps a completed round when there is no pending card and can explicitly restart all cards', () => {
    const completed = decide(decide(round(2), 'understood'), 'understood');
    expect(updateStudyPracticeRound(completed, { type: 'restart', scope: 'pending' })).toBe(completed);
    const restarted = updateStudyPracticeRound(completed, { type: 'restart', scope: 'all' });
    expect(restarted).toMatchObject({ index: 0, finished: false, revision: 17 });
    expect(restarted.cards).toEqual(completed.cards);
    expect(restarted.cards).not.toBe(completed.cards);
    expect(getStudyPracticeSummary(restarted)).toMatchObject({ answered: 0, understood: 0, pending: 2 });
    expect(getStudyPracticeSummary(completed).understood).toBe(2);
  });
});

describe('unreviewed question navigation', () => {
  it('navigates backward over skipped cards and wraps without mutating draft or assessment', () => {
    let current = round(4);
    current = updateStudyPracticeRound(current, { type: 'attempt', value: '第一題原本的草稿' });
    current = updateStudyPracticeRound(current, { type: 'go', index: 1 });
    current = updateStudyPracticeRound(current, { type: 'skip' });
    current = updateStudyPracticeRound(current, { type: 'skip' });
    const before = JSON.stringify(current);
    expect(previousUnreviewedStudyPracticeIndex(current)).toBe(0);
    expect(JSON.stringify(current)).toBe(before);
    current = updateStudyPracticeRound(current, { type: 'go', index: 0 });
    expect(previousUnreviewedStudyPracticeIndex(current)).toBe(3);
    expect(current.responses[current.cards[0].id].attempt).toBe('第一題原本的草稿');
    expect(current.responses[current.cards[1].id].outcome).toBe('skipped');
    expect(current.responses[current.cards[2].id].outcome).toBe('skipped');
  });

  it('limits reverse unreviewed navigation to the pending retry deck and stops on a single card', () => {
    let current = decide(round(3), 'understood');
    current = updateStudyPracticeRound(current, { type: 'skip' });
    current = updateStudyPracticeRound(current, { type: 'skip' });
    const retry = updateStudyPracticeRound(current, { type: 'restart', scope: 'pending' });
    expect(retry.cards).toHaveLength(2);
    expect(previousUnreviewedStudyPracticeIndex(retry)).toBe(1);
    expect(previousUnreviewedStudyPracticeIndex(updateStudyPracticeRound(retry, { type: 'go', index: 1 }))).toBe(0);
    expect(previousUnreviewedStudyPracticeIndex(round(1))).toBeNull();
  });

  it('wraps to an earlier unanswered question without mutating drafts, assessments or source order', () => {
    let current = decide(round(3), 'understood');
    current = updateStudyPracticeRound(current, { type: 'go', index: 2 });
    const before = JSON.stringify(current);
    expect(nextUnreviewedStudyPracticeIndex(current)).toBe(1);
    const jumped = updateStudyPracticeRound(current, { type: 'go', index: nextUnreviewedStudyPracticeIndex(current)! });
    expect(jumped.index).toBe(1);
    expect(jumped.responses[jumped.cards[0].id].outcome).toBe('understood');
    expect(jumped.responses[jumped.cards[1].id].outcome).toBeNull();
    expect(jumped.responses[jumped.cards[2].id].outcome).toBeNull();
    expect(JSON.stringify(current)).toBe(before);
  });

  it('treats a draft without self-assessment as unreviewed, ignores skipped cards, and stops when no other card qualifies', () => {
    let current = round(3);
    current = updateStudyPracticeRound(current, { type: 'attempt', value: '先寫第一題草稿' });
    current = updateStudyPracticeRound(current, { type: 'go', index: 1 });
    current = updateStudyPracticeRound(current, { type: 'skip' });
    expect(current.index).toBe(2);
    expect(nextUnreviewedStudyPracticeIndex(current)).toBe(0);
    current = updateStudyPracticeRound(current, { type: 'go', index: 0 });
    expect(nextUnreviewedStudyPracticeIndex(current)).toBe(2);
    current = updateStudyPracticeRound(current, { type: 'go', index: 2 });
    current = updateStudyPracticeRound(current, { type: 'skip' });
    expect(current.finished).toBe(true);
    expect(nextUnreviewedStudyPracticeIndex(current)).toBe(0);
    current = updateStudyPracticeRound(current, { type: 'go', index: 0 });
    expect(nextUnreviewedStudyPracticeIndex(current)).toBeNull();
    expect(current.responses[current.cards[0].id].attempt).toBe('先寫第一題草稿');
  });

  it('does not jump outside a retry subset or leave a single-card round', () => {
    let current = decide(round(3), 'understood');
    current = updateStudyPracticeRound(current, { type: 'skip' });
    current = updateStudyPracticeRound(current, { type: 'skip' });
    const retry = updateStudyPracticeRound(current, { type: 'restart', scope: 'pending' });
    expect(retry.cards).toHaveLength(2);
    expect(nextUnreviewedStudyPracticeIndex(retry)).toBe(1);
    expect(nextUnreviewedStudyPracticeIndex(updateStudyPracticeRound(retry, { type: 'go', index: 1 }))).toBe(0);
    expect(nextUnreviewedStudyPracticeIndex(round(1))).toBeNull();
  });
});

describe('practice note disclosure and filenames', () => {
  it('does not export answers or source hints before this round has disclosed them', () => {
    const started = round();
    const notes = buildCourseStudyPracticeNotes('資料庫系統', '第 7 頁講義.pdf', started);
    expect(notes).toContain('課程：資料庫系統\n講義：第 7 頁講義.pdf\n讀法：理解概念');
    expect(notes).toContain('本輪試答：\n（尚未作答）');
    expect(notes).toContain('原文提示：未展開');
    expect(notes).not.toContain('參考答案秘密');
    expect(notes).not.toContain('原文引句 1');
    expect(notes).not.toContain('更多教材內容');
    expect(notes).toContain('沒有自動評分');
  });

  it.each([
    { attempt: '', answerVisible: false, included: false },
    { attempt: ' \n\t', answerVisible: true, included: false },
    { attempt: '本輪試答', answerVisible: false, included: false },
    { attempt: '本輪試答', answerVisible: true, included: true },
  ])('guards reference answers with the current attempt and visible state (%#)', ({ attempt, answerVisible, included }) => {
    const started = round(1);
    Object.assign(started.responses[started.cards[0].id], { attempt, answerVisible });
    const before = JSON.stringify(started);
    const notes = buildCourseStudyPracticeNotes('資料庫', '講義', started);
    expect(notes.includes('參考答案秘密 1')).toBe(included);
    expect(notes.includes('參考回答（本輪已展開）：')).toBe(included);
    expect(notes.includes('原文引句 1')).toBe(included);
    expect(JSON.stringify(started)).toBe(before);
  });

  it('exports a requested source hint independently of the hidden answer and stops exporting it when hidden', () => {
    const shown = updateStudyPracticeRound(round(1), { type: 'toggle_hint' });
    const notes = buildCourseStudyPracticeNotes('資料庫', '講義', shown);
    expect(notes).toContain('原文提示：已展開');
    expect(notes).toContain(`本段原文：\n${shown.cards[0].sourceText}`);
    expect(notes).not.toContain('參考答案秘密');
    const hidden = updateStudyPracticeRound(shown, { type: 'toggle_hint' });
    expect(buildCourseStudyPracticeNotes('資料庫', '講義', hidden)).not.toContain('原文引句 1');
  });

  it('exports ordered positions, reading modes, own assessments and multiline attempts without leaking another card\'s answer', () => {
    const attempt = '  第一行 😀\r\n第二行 <img src=x>  ';
    let current = decide(round(3), 'understood', attempt);
    current = updateStudyPracticeRound(current, { type: 'skip' });
    current = decide(current, 'again', '第三題的試答');
    const before = JSON.stringify(current);
    const notes = buildCourseStudyPracticeNotes('資料庫', '我的講義', current);
    expect(notes).toContain('本輪狀態：本輪結束；共 3 題');
    expect(notes).toContain('本人自評：已理解 1 題、再練一次 1 題、略過 1 題、尚未自評 0 題。');
    expect(notes).toContain(`本輪試答：\n${attempt}\n本人自評：我已理解`);
    expect(notes).toContain('讀法：理解概念・第 1 次講解');
    expect(notes).toContain('原文位置：第 7 頁 · 第 1 段');
    expect(notes.indexOf('第 2 題／共 3 題')).toBeGreaterThan(notes.indexOf('第 1 題／共 3 題'));
    expect(notes.indexOf('第 3 題／共 3 題')).toBeGreaterThan(notes.indexOf('第 2 題／共 3 題'));
    expect(notes).toContain('參考答案秘密 1');
    expect(notes).not.toContain('參考答案秘密 2');
    expect(notes).toContain('參考答案秘密 3');
    expect(notes).not.toContain('&lt;img');
    expect(notes.endsWith('\n')).toBe(true);
    expect(JSON.stringify(current)).toBe(before);
  });

  it('removes a once-visible reference answer from export after hiding it or editing the attempt', () => {
    const assessed = updateStudyPracticeRound(decide(round(1), 'understood'), { type: 'go', index: 0 });
    const hidden = updateStudyPracticeRound(assessed, { type: 'toggle_answer' });
    const edited = updateStudyPracticeRound(assessed, { type: 'attempt', value: '修正試答' });
    expect(buildCourseStudyPracticeNotes('課程', '講義', assessed)).toContain('參考答案秘密 1');
    expect(buildCourseStudyPracticeNotes('課程', '講義', hidden)).not.toContain('參考答案秘密');
    expect(buildCourseStudyPracticeNotes('課程', '講義', edited)).not.toContain('參考答案秘密');
  });

  it('reuses safe text filename rules and preserves complete Unicode characters', () => {
    expect(courseStudyPracticeFilename('../私密\\教材\u0000\n<>:"|?*\u202e\u2067.pdf')).toBe('私密 教材-逐題複習.txt');
    expect(courseStudyPracticeFilename('  ..  ')).toBe('讀書白板-逐題複習.txt');
    expect(courseStudyPracticeFilename('資料庫.MD')).toBe('資料庫-逐題複習.txt');
    const filename = courseStudyPracticeFilename('😀'.repeat(150));
    expect(filename).toBe(`${'😀'.repeat(48)}-逐題複習.txt`);
    expect(Buffer.byteLength(filename, 'utf8')).toBeLessThan(255);
  });
});
