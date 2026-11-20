/**
 * @jest-environment node
 *
 * 對 packages/shared/src/lms/quizScoring.ts 的完整單元測試。
 * 涵蓋：5 種題型、部分分制、人工評分補回、邊界輸入。
 */
import {
  scoreQuestion,
  scoreQuizAttempt,
  applyManualGrade,
  type ScoringQuestion,
  type UserAnswer,
} from '@campus/shared';

describe('scoreQuestion', () => {
  test('single_choice 答對給滿分', () => {
    const q: ScoringQuestion = {
      id: 'q1',
      type: 'single_choice',
      prompt: '台灣首都？',
      points: 10,
      options: [
        { id: 'a', label: '台北', value: 'tp', isCorrect: true },
        { id: 'b', label: '台中', value: 'tc' },
      ],
    };
    const r = scoreQuestion(q, { questionId: 'q1', value: 'a' });
    expect(r.earned).toBe(10);
    expect(r.isCorrect).toBe(true);
  });

  test('single_choice 答錯不給分', () => {
    const q: ScoringQuestion = {
      id: 'q1',
      type: 'single_choice',
      prompt: '',
      points: 5,
      options: [
        { id: 'a', label: 'A', value: 'a', isCorrect: true },
        { id: 'b', label: 'B', value: 'b' },
      ],
    };
    const r = scoreQuestion(q, { questionId: 'q1', value: 'b' });
    expect(r.earned).toBe(0);
    expect(r.isCorrect).toBe(false);
  });

  test('true_false 正確判斷', () => {
    const q: ScoringQuestion = {
      id: 'q1',
      type: 'true_false',
      prompt: '地球是圓的',
      points: 2,
      options: [
        { id: 't', label: '是', value: 'true', isCorrect: true },
        { id: 'f', label: '否', value: 'false' },
      ],
    };
    expect(scoreQuestion(q, { questionId: 'q1', value: 't' }).earned).toBe(2);
    expect(scoreQuestion(q, { questionId: 'q1', value: 'f' }).earned).toBe(0);
  });

  test('multiple_choice 部分分制（選對 2/3、選錯 0）→ 2/3 分', () => {
    const q: ScoringQuestion = {
      id: 'q1',
      type: 'multiple_choice',
      prompt: '哪些是奇數？',
      points: 9,
      options: [
        { id: '1', label: '1', value: '1', isCorrect: true },
        { id: '2', label: '2', value: '2' },
        { id: '3', label: '3', value: '3', isCorrect: true },
        { id: '4', label: '4', value: '4' },
        { id: '5', label: '5', value: '5', isCorrect: true },
      ],
    };
    const r = scoreQuestion(q, { questionId: 'q1', value: ['1', '3'] });
    expect(r.earned).toBe(6); // 9 * (2/3 - 0/2) = 6
  });

  test('multiple_choice 選對 + 選錯 → 扣分但不低於 0', () => {
    const q: ScoringQuestion = {
      id: 'q1',
      type: 'multiple_choice',
      prompt: '',
      points: 6,
      options: [
        { id: '1', label: '1', value: '1', isCorrect: true },
        { id: '2', label: '2', value: '2' },
        { id: '3', label: '3', value: '3', isCorrect: true },
      ],
    };
    // 只選 2（錯誤）：correctHits=0/2, wrongHits=1/1 → ratio = -1 → earned = 0（不為負）
    const r = scoreQuestion(q, { questionId: 'q1', value: ['2'] });
    expect(r.earned).toBe(0);
  });

  test('short_answer 不區分大小寫', () => {
    const q: ScoringQuestion = {
      id: 'q1',
      type: 'short_answer',
      prompt: '兩個 SQL 關鍵字 (JOIN)',
      points: 3,
      acceptableAnswers: ['JOIN', 'join', 'Join'],
    };
    expect(scoreQuestion(q, { questionId: 'q1', value: 'join' }).earned).toBe(3);
    expect(scoreQuestion(q, { questionId: 'q1', value: 'JOIN' }).earned).toBe(3);
    expect(scoreQuestion(q, { questionId: 'q1', value: '  Join  ' }).earned).toBe(3);
    expect(scoreQuestion(q, { questionId: 'q1', value: 'select' }).earned).toBe(0);
  });

  test('short_answer 區分大小寫', () => {
    const q: ScoringQuestion = {
      id: 'q1',
      type: 'short_answer',
      prompt: '',
      points: 1,
      caseSensitive: true,
      acceptableAnswers: ['Foo'],
    };
    expect(scoreQuestion(q, { questionId: 'q1', value: 'Foo' }).earned).toBe(1);
    expect(scoreQuestion(q, { questionId: 'q1', value: 'foo' }).earned).toBe(0);
  });

  test('essay 標記 needsManualGrading', () => {
    const q: ScoringQuestion = { id: 'q1', type: 'essay', prompt: '論述', points: 20 };
    const r = scoreQuestion(q, { questionId: 'q1', value: '一段論述...' });
    expect(r.needsManualGrading).toBe(true);
    expect(r.earned).toBe(0);
  });

  test('未作答時不給分', () => {
    const q: ScoringQuestion = { id: 'q1', type: 'single_choice', prompt: '', points: 5, options: [] };
    const r = scoreQuestion(q, undefined);
    expect(r.earned).toBe(0);
    expect(r.isCorrect).toBe(false);
  });
});

describe('scoreQuizAttempt', () => {
  const questions: ScoringQuestion[] = [
    {
      id: 'q1',
      type: 'single_choice',
      prompt: '',
      points: 10,
      options: [
        { id: 'a', label: 'A', value: 'a', isCorrect: true },
        { id: 'b', label: 'B', value: 'b' },
      ],
    },
    {
      id: 'q2',
      type: 'short_answer',
      prompt: '',
      points: 5,
      acceptableAnswers: ['SQL'],
    },
    { id: 'q3', type: 'essay', prompt: '', points: 15 },
  ];

  test('混合題型彙總正確', () => {
    const answers: UserAnswer[] = [
      { questionId: 'q1', value: 'a' },
      { questionId: 'q2', value: 'sql' },
      { questionId: 'q3', value: '我寫了一段論述' },
    ];
    const r = scoreQuizAttempt(questions, answers);
    expect(r.totalPoints).toBe(30);
    expect(r.autoGradedPoints).toBe(15); // 10 + 5
    expect(r.pendingManualPoints).toBe(15); // essay
    expect(r.needsManualGrading).toBe(true);
  });

  test('全部自動可判題時 needsManualGrading=false', () => {
    const onlyAuto = questions.slice(0, 2);
    const r = scoreQuizAttempt(onlyAuto, [
      { questionId: 'q1', value: 'a' },
      { questionId: 'q2', value: 'SQL' },
    ]);
    expect(r.needsManualGrading).toBe(false);
    expect(r.percentage).toBe(100);
  });
});

describe('applyManualGrade', () => {
  test('教師打 essay 分數，補回後 needsManualGrading=false', () => {
    const questions: ScoringQuestion[] = [
      { id: 'q1', type: 'essay', prompt: '', points: 20 },
    ];
    const attempt = scoreQuizAttempt(questions, [{ questionId: 'q1', value: '...' }]);
    expect(attempt.needsManualGrading).toBe(true);

    const after = applyManualGrade(attempt, { q1: 17 });
    expect(after.needsManualGrading).toBe(false);
    expect(after.earnedPoints).toBe(17);
    expect(after.percentage).toBe(85);
  });

  test('超過滿分會 clamp 到滿分', () => {
    const questions: ScoringQuestion[] = [{ id: 'q1', type: 'essay', prompt: '', points: 10 }];
    const attempt = scoreQuizAttempt(questions, [{ questionId: 'q1', value: '' }]);
    const after = applyManualGrade(attempt, { q1: 999 });
    expect(after.earnedPoints).toBe(10);
  });

  test('負分被夾到 0', () => {
    const questions: ScoringQuestion[] = [{ id: 'q1', type: 'essay', prompt: '', points: 10 }];
    const attempt = scoreQuizAttempt(questions, [{ questionId: 'q1', value: '' }]);
    const after = applyManualGrade(attempt, { q1: -5 });
    expect(after.earnedPoints).toBe(0);
  });
});
