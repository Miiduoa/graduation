/**
 * @jest-environment node
 *
 * 對 packages/shared/src/lms/gradebookCompute.ts 完整單元測試。
 */
import {
  computeGradebook,
  quizAttemptToStudentScore,
  type GradeItem,
  type StudentGradeInput,
} from '@campus/shared';

const ITEMS: GradeItem[] = [
  { id: 'hw1', title: '作業 1', weight: 30, maxScore: 100 },
  { id: 'mid', title: '期中考', weight: 30, maxScore: 100 },
  { id: 'fin', title: '期末考', weight: 40, maxScore: 100 },
];

const STUDENTS: StudentGradeInput[] = [
  {
    uid: 'u1',
    displayName: '阿明',
    scores: [
      { gradeItemId: 'hw1', score: 90 },
      { gradeItemId: 'mid', score: 80 },
      { gradeItemId: 'fin', score: 70 },
    ],
  },
  {
    uid: 'u2',
    displayName: '小華',
    scores: [
      { gradeItemId: 'hw1', score: 50 },
      { gradeItemId: 'mid', score: 55 },
      { gradeItemId: 'fin', score: 50 },
    ],
  },
];

describe('computeGradebook', () => {
  test('基本加權計算', () => {
    const r = computeGradebook(ITEMS, STUDENTS);
    const ming = r.rows.find((x) => x.uid === 'u1')!;
    // 90*0.3 + 80*0.3 + 70*0.4 = 27 + 24 + 28 = 79
    expect(ming.finalScore).toBe(79);
    expect(ming.passed).toBe(true);
  });

  test('未通過判定（< 60）', () => {
    const r = computeGradebook(ITEMS, STUDENTS);
    const hua = r.rows.find((x) => x.uid === 'u2')!;
    // 50*0.3 + 55*0.3 + 50*0.4 = 15 + 16.5 + 20 = 51.5
    expect(hua.finalScore).toBe(51.5);
    expect(hua.passed).toBe(false);
  });

  test('weight 加總不等於 100 時自動正規化', () => {
    const items: GradeItem[] = [
      { id: 'a', title: 'A', weight: 1 },
      { id: 'b', title: 'B', weight: 1 },
    ];
    const stu: StudentGradeInput[] = [
      { uid: 'u', displayName: 'U', scores: [{ gradeItemId: 'a', score: 80 }, { gradeItemId: 'b', score: 60 }] },
    ];
    const r = computeGradebook(items, stu);
    expect(r.rows[0].finalScore).toBe(70); // (80+60)/2
  });

  test('全部沒設 weight 時平均分配', () => {
    const items: GradeItem[] = [
      { id: 'a', title: 'A', weight: 0 },
      { id: 'b', title: 'B', weight: 0 },
    ];
    const stu: StudentGradeInput[] = [
      { uid: 'u', displayName: 'U', scores: [{ gradeItemId: 'a', score: 100 }, { gradeItemId: 'b', score: 50 }] },
    ];
    const r = computeGradebook(items, stu);
    expect(r.rows[0].finalScore).toBe(75);
  });

  test('免修（excused）會重新分配剩餘權重', () => {
    const stu: StudentGradeInput[] = [
      {
        uid: 'u',
        displayName: 'U',
        scores: [
          { gradeItemId: 'hw1', score: 90 },
          { gradeItemId: 'mid', score: 0, excused: true },
          { gradeItemId: 'fin', score: 70 },
        ],
      },
    ];
    const r = computeGradebook(ITEMS, stu);
    // 排除 mid (30%) 後，hw1=30、fin=40 → 重新正規化 hw1=42.857%、fin=57.143%
    // 90*0.42857 + 70*0.57143 = 38.57 + 40 = 78.57
    expect(r.rows[0].finalScore).toBeCloseTo(78.57, 1);
  });

  test('班級平均與通過率', () => {
    const r = computeGradebook(ITEMS, STUDENTS);
    // (79 + 51.5) / 2 = 65.25
    expect(r.classAverage).toBe(65.25);
    expect(r.passRate).toBe(50); // 2 人 1 人通過 = 50%
  });

  test('發布狀態', () => {
    const r = computeGradebook(ITEMS, STUDENTS, { published: true });
    expect(r.published).toBe(true);
    expect(r.rows.every((row) => row.published)).toBe(true);
    expect(r.publishedAt).toBeTruthy();
  });

  test('未繳交（score=null）視為 0 但仍計入分母', () => {
    const stu: StudentGradeInput[] = [
      {
        uid: 'u',
        displayName: 'U',
        scores: [
          { gradeItemId: 'hw1', score: 100 },
          { gradeItemId: 'mid', score: null },
          { gradeItemId: 'fin', score: null },
        ],
      },
    ];
    const r = computeGradebook(ITEMS, stu);
    // 只有 hw1 給分：finalScore 只反映 hw1 的貢獻 = 100 * 30% = 30
    expect(r.rows[0].finalScore).toBe(30);
    expect(r.rows[0].gradedItemCount).toBe(1);
  });
});

describe('quizAttemptToStudentScore', () => {
  test('換算成 100 分制', () => {
    const s = quizAttemptToStudentScore('q1', { earnedPoints: 18, totalPoints: 30 });
    expect(s.score).toBe(60);
  });

  test('滿分為 0 時不會除零', () => {
    const s = quizAttemptToStudentScore('q1', { earnedPoints: 0, totalPoints: 0 });
    expect(s.score).toBe(0);
  });

  test('保留 isLate 旗標', () => {
    const s = quizAttemptToStudentScore('q1', { earnedPoints: 10, totalPoints: 10 }, { isLate: true });
    expect(s.isLate).toBe(true);
  });
});
