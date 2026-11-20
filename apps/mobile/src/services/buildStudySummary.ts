type SummaryInput = {
  deadlines: { title: string; remainingHours: number; completed: boolean }[];
  attendanceRates: number[];
  courseCount: number;
  pendingTodoCount: number;
  gpa?: { current: number; trend: string };
};

/** Summarize retrieved records; this is not a prediction or a completeness check. */
export function buildStudySummary(input: SummaryInput): string {
  const parts: string[] = [];
  const rates = input.attendanceRates.filter(
    (rate) => Number.isFinite(rate) && rate >= 0 && rate <= 100,
  );
  const lowAttendance = rates.filter((rate) => rate < 70);
  if (lowAttendance.length)
    parts.push(`${lowAttendance.length} 門課的出席率低於 70%。請查看各課程的出席規定與紀錄。`);
  const pending = input.deadlines.filter(
    (item) => !item.completed && Number.isFinite(item.remainingHours),
  );
  const overdue = pending.filter((item) => item.remainingHours <= 0);
  const soon = pending.filter((item) => item.remainingHours > 0 && item.remainingHours < 48);
  const week = pending.filter((item) => item.remainingHours >= 48 && item.remainingHours < 168);
  if (overdue.length)
    parts.push(
      `${overdue.length} 項待辦已過期限：${overdue
        .slice(0, 3)
        .map((item) => item.title)
        .join('、')}。請回課程確認是否仍可補交。`,
    );
  if (soon.length)
    parts.push(
      `48 小時內有 ${soon.length} 項待辦到期：${soon
        .slice(0, 3)
        .map((item) => item.title)
        .join('、')}。`,
    );
  if (week.length) parts.push(`接下來一週另有 ${week.length} 項待辦。`);
  if (
    input.gpa &&
    Number.isFinite(input.gpa.current) &&
    input.gpa.current > 0 &&
    ['declining', 'improving'].includes(input.gpa.trend)
  ) {
    parts.push(
      `已讀取的 GPA 為 ${input.gpa.current.toFixed(2)}，近期${input.gpa.trend === 'declining' ? '下降' : '上升'}。正式成績請以學校紀錄為準。`,
    );
  }
  if (input.courseCount > 0)
    parts.push(`目前有 ${input.courseCount} 門進行中的課程。上課日期與教室請查看課表。`);
  if (!pending.length && input.pendingTodoCount > 0)
    parts.push(`課程中另有 ${input.pendingTodoCount} 項尚未完成的待辦，請開啟課程確認。`);
  return parts.length ? parts.join('\n\n') : '目前沒有可列出的提醒。可開啟課程查看最新作業與公告。';
}
