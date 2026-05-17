import {
  computeStudentRisk,
  rankStudentsByRisk,
  type StudentRiskInput,
} from '../services/studentRiskEngine';

const healthyStudent: StudentRiskInput = {
  uid: 'a',
  name: 'A',
  attendanceRate: 0.95,
  missingHomeworkRate: 0.0,
  averageScore: 85,
  aiAcceptRate: 0.7,
  enrolledCourseCount: 5,
};

const criticalStudent: StudentRiskInput = {
  uid: 'z',
  name: 'Z',
  attendanceRate: 0.2,
  missingHomeworkRate: 0.8,
  averageScore: 25,
  aiAcceptRate: 0.0,
  enrolledCourseCount: 5,
};

describe('computeStudentRisk', () => {
  test('健康學生 → low tier', () => {
    const r = computeStudentRisk(healthyStudent);
    expect(r.tier).toBe('low');
    expect(r.score).toBeLessThan(30);
  });

  test('多重問題學生 → critical tier', () => {
    const r = computeStudentRisk(criticalStudent);
    expect(r.tier).toBe('critical');
    expect(r.score).toBeGreaterThanOrEqual(70);
  });

  test('每筆都有 contributors + suggestedActions', () => {
    const r = computeStudentRisk(criticalStudent);
    expect(r.contributors.length).toBe(4);
    expect(r.suggestedActions.length).toBeGreaterThan(0);
  });

  test('contributors 依貢獻排序', () => {
    const r = computeStudentRisk(criticalStudent);
    for (let i = 1; i < r.contributors.length; i++) {
      expect(r.contributors[i - 1].contribution).toBeGreaterThanOrEqual(
        r.contributors[i].contribution,
      );
    }
  });

  test('score 上限 100', () => {
    const r = computeStudentRisk({
      uid: 'extreme',
      name: 'Extreme',
      attendanceRate: 0,
      missingHomeworkRate: 1,
      averageScore: 0,
      aiAcceptRate: 0,
      enrolledCourseCount: 5,
    });
    expect(r.score).toBeLessThanOrEqual(100);
  });

  test('score 下限 0', () => {
    const r = computeStudentRisk({
      uid: 'perfect',
      name: 'Perfect',
      attendanceRate: 1,
      missingHomeworkRate: 0,
      averageScore: 100,
      aiAcceptRate: 1,
      enrolledCourseCount: 5,
    });
    expect(r.score).toBeGreaterThanOrEqual(0);
  });
});

describe('rankStudentsByRisk', () => {
  test('依分數降冪排序', () => {
    const result = rankStudentsByRisk([healthyStudent, criticalStudent]);
    expect(result[0].uid).toBe(criticalStudent.uid);
    expect(result[1].uid).toBe(healthyStudent.uid);
  });
});
