import { buildStudySummary } from '../services/buildStudySummary';

const base = { deadlines: [], attendanceRates: [], courseCount: 0, pendingTodoCount: 0 };
it('separates overdue work from upcoming deadlines and excludes completed work', () => {
  const summary = buildStudySummary({
    ...base,
    deadlines: [
      { title: '過期作業', remainingHours: -3, completed: false },
      { title: '即將到期', remainingHours: 24, completed: false },
      { title: '下週工作', remainingHours: 72, completed: false },
      { title: '已完成', remainingHours: -1, completed: true },
    ],
  });
  expect(summary).toContain('1 項待辦已過期限：過期作業');
  expect(summary).toContain('48 小時內有 1 項待辦到期：即將到期');
  expect(summary).toContain('接下來一週另有 1 項待辦');
  expect(summary).not.toContain('已完成');
});
it('does not present term course counts as classes held today or project a future GPA', () => {
  const summary = buildStudySummary({
    ...base,
    courseCount: 8,
    gpa: { current: 3.1, trend: 'declining' },
  });
  expect(summary).toContain('8 門進行中的課程');
  expect(summary).toContain('GPA 為 3.10');
  expect(summary).not.toMatch(/今天有|預測|下學期|AI/);
});
it('does not claim all tasks are complete when records are missing', () => {
  expect(buildStudySummary(base)).toContain('目前沒有可列出的提醒');
  expect(buildStudySummary({ ...base, pendingTodoCount: 2 })).toContain('2 項尚未完成的待辦');
});
it('ignores invalid rates and durations and treats the deadline itself as elapsed', () => {
  const summary = buildStudySummary({
    ...base,
    attendanceRates: [NaN, -1, 101, 60],
    deadlines: [
      { title: '現在截止', completed: false, remainingHours: 0 },
      { title: '缺資料', completed: false, remainingHours: NaN },
    ],
  });
  expect(summary).toContain('1 門課的出席率低於');
  expect(summary).toContain('已過期限：現在截止');
  expect(summary).not.toContain('缺資料');
});
