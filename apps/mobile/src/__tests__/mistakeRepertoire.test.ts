/**
 * @jest-environment node
 *
 * 對 packages/shared/src/lms/mistakeRepertoire.ts 完整單元測試。
 */
import {
  addMistake,
  recordPractice,
  dueToday,
  statsOf,
  recommendDailyPracticeSet,
  importFromExamWrongAnswers,
  type MistakeEntry,
} from '@campus/shared';

const NOW = '2026-05-15T10:00:00+08:00';
const FUTURE_2D = '2026-05-17T10:00:00+08:00';
const FUTURE_4D = '2026-05-19T10:00:00+08:00';
const FUTURE_31D = '2026-06-15T10:00:00+08:00';

function mkEntry(over: Partial<MistakeEntry>): MistakeEntry {
  return {
    id: over.id ?? 'q1',
    courseId: over.courseId ?? 'c1',
    courseName: over.courseName ?? 'ML',
    examId: over.examId ?? 'e1',
    examTitle: over.examTitle ?? '期中考',
    questionText: over.questionText ?? 'What is overfitting?',
    kind: over.kind ?? 'short_answer',
    studentAnswer: over.studentAnswer ?? '',
    correctAnswer: over.correctAnswer ?? '',
    explanation: over.explanation,
    tags: over.tags ?? [],
    box: over.box ?? 0,
    lastPracticedAt: over.lastPracticedAt ?? NOW,
    correctCount: over.correctCount ?? 0,
    wrongCount: over.wrongCount ?? 1,
    retired: over.retired ?? false,
  };
}

describe('addMistake', () => {
  it('新題加入 → box 0, wrongCount 1', () => {
    const result = addMistake(
      [],
      {
        id: 'q1',
        courseId: 'c1',
        courseName: 'ML',
        examId: 'e1',
        examTitle: '期中考',
        questionText: 'Q1?',
        kind: 'mcq',
        studentAnswer: 'A',
        correctAnswer: 'B',
        tags: [],
      },
      NOW,
    );
    expect(result).toHaveLength(1);
    expect(result[0].box).toBe(0);
    expect(result[0].wrongCount).toBe(1);
    expect(result[0].correctCount).toBe(0);
  });

  it('同 id 再錯一次 → wrongCount + 1，box reset', () => {
    const initial = [mkEntry({ id: 'q1', box: 3, wrongCount: 1 })];
    const result = addMistake(
      initial,
      {
        id: 'q1',
        courseId: 'c1',
        courseName: 'ML',
        examId: 'e1',
        examTitle: '期中考',
        questionText: 'Q1?',
        kind: 'mcq',
        studentAnswer: 'B',
        correctAnswer: 'A',
        tags: [],
      },
      NOW,
    );
    expect(result).toHaveLength(1);
    expect(result[0].box).toBe(0);
    expect(result[0].wrongCount).toBe(2);
  });
});

describe('recordPractice', () => {
  it('答對 → box+1，correctCount+1', () => {
    const initial = [mkEntry({ id: 'q1', box: 1, correctCount: 1, wrongCount: 1 })];
    const result = recordPractice(initial, {
      entryId: 'q1',
      isCorrect: true,
      attemptedAt: FUTURE_2D,
    });
    expect(result[0].box).toBe(2);
    expect(result[0].correctCount).toBe(2);
  });

  it('答錯 → box reset 到 0', () => {
    const initial = [mkEntry({ id: 'q1', box: 3, correctCount: 3 })];
    const result = recordPractice(initial, {
      entryId: 'q1',
      isCorrect: false,
      attemptedAt: FUTURE_2D,
    });
    expect(result[0].box).toBe(0);
    expect(result[0].wrongCount).toBe(2);
  });

  it('在 box 4 又答對且 correctCount ≥ 3 → retired', () => {
    const initial = [mkEntry({ id: 'q1', box: 4, correctCount: 2 })];
    const result = recordPractice(initial, {
      entryId: 'q1',
      isCorrect: true,
      attemptedAt: FUTURE_2D,
    });
    expect(result[0].retired).toBe(true);
    expect(result[0].box).toBe(4);
  });

  it('box 4 答對但 correctCount 不夠 → 不 retire', () => {
    const initial = [mkEntry({ id: 'q1', box: 4, correctCount: 0 })];
    const result = recordPractice(initial, {
      entryId: 'q1',
      isCorrect: true,
      attemptedAt: FUTURE_2D,
    });
    expect(result[0].retired).toBe(false);
  });
});

describe('dueToday', () => {
  it('box 0 + 1+ 天前練習過 → due', () => {
    const result = dueToday([mkEntry({ box: 0, lastPracticedAt: NOW })], FUTURE_2D);
    expect(result).toHaveLength(1);
  });

  it('box 4 + 30+ 天前練習 → due', () => {
    const result = dueToday(
      [mkEntry({ box: 4, lastPracticedAt: NOW })],
      FUTURE_31D,
    );
    expect(result).toHaveLength(1);
  });

  it('box 1 + 剛練習 → not due', () => {
    const result = dueToday([mkEntry({ box: 1, lastPracticedAt: NOW })], NOW);
    expect(result).toHaveLength(0);
  });

  it('retired 題目永遠不 due', () => {
    const result = dueToday(
      [mkEntry({ box: 0, lastPracticedAt: NOW, retired: true })],
      FUTURE_4D,
    );
    expect(result).toHaveLength(0);
  });
});

describe('statsOf', () => {
  it('回傳 byBox / byCourse / byKind 統計', () => {
    const entries = [
      mkEntry({ id: '1', box: 0, courseId: 'c1', courseName: 'ML', kind: 'mcq' }),
      mkEntry({ id: '2', box: 2, courseId: 'c1', courseName: 'ML', kind: 'mcq' }),
      mkEntry({ id: '3', box: 4, courseId: 'c2', courseName: 'OS', kind: 'essay', retired: true }),
    ];
    const r = statsOf(entries, NOW);
    expect(r.total).toBe(3);
    expect(r.active).toBe(2);
    expect(r.retired).toBe(1);
    expect(r.byBox[0]).toBe(1);
    expect(r.byBox[2]).toBe(1);
    expect(r.byBox[4]).toBe(1);
    expect(r.byCourse[0].courseId).toBe('c1');
    expect(r.byCourse[0].count).toBe(2);
    expect(r.byKind.mcq).toBe(2);
    expect(r.masteryRate).toBeCloseTo(0.33, 1);
  });
});

describe('recommendDailyPracticeSet', () => {
  it('優先排 box 低的', () => {
    const entries = [
      mkEntry({ id: '1', box: 3, lastPracticedAt: '2026-04-01T00:00:00+08:00' }),
      mkEntry({ id: '2', box: 0, lastPracticedAt: NOW }),
    ];
    const r = recommendDailyPracticeSet(entries, FUTURE_2D, 10);
    expect(r[0].id).toBe('2'); // box 0 first
  });

  it('limit 生效', () => {
    const entries = Array.from({ length: 20 }).map((_, i) =>
      mkEntry({ id: `q${i}`, box: 0, lastPracticedAt: '2026-04-01T00:00:00+08:00' }),
    );
    const r = recommendDailyPracticeSet(entries, FUTURE_2D, 5);
    expect(r).toHaveLength(5);
  });
});

describe('importFromExamWrongAnswers', () => {
  it('從考試錯題一次匯入多題', () => {
    const r = importFromExamWrongAnswers(
      [],
      { examId: 'e1', examTitle: '期中考', courseId: 'c1', courseName: 'ML' },
      [
        { questionId: 'q1', questionText: 'Q1', kind: 'mcq', studentAnswer: 'A', correctAnswer: 'B' },
        { questionId: 'q2', questionText: 'Q2', kind: 'short_answer', studentAnswer: '', correctAnswer: 'X' },
      ],
      NOW,
    );
    expect(r).toHaveLength(2);
    expect(r[0].id).toBe('e1_q1');
    expect(r[1].id).toBe('e1_q2');
  });
});
