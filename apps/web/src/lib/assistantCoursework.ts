/** A selection hint, never proof of current course access or permission to write. */
export type AssistantCourseworkTarget = {
  workspaceId: string;
  taskId: string;
  kind: 'assignment' | 'quiz';
  title: string;
  courseTitle: string;
  dueAt: string;
};

export type AssistantCourseworkSelection = {
  target: AssistantCourseworkTarget;
  date?: string;
};

const identifier = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;
const plainLabel = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.trim().length > 0 &&
  value.length <= 500 &&
  !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value);

/** Keep only the bounded metadata the user needs to select an exact assignment. */
export function parseAssistantCourseworkTargets(value: unknown): AssistantCourseworkTarget[] {
  if (!Array.isArray(value) || value.length > 12) return [];
  const result: AssistantCourseworkTarget[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
    const row = raw as Record<string, unknown>;
    if (
      typeof row.workspaceId !== 'string' ||
      !identifier.test(row.workspaceId) ||
      typeof row.taskId !== 'string' ||
      !identifier.test(row.taskId) ||
      (row.kind !== 'assignment' && row.kind !== 'quiz') ||
      !plainLabel(row.title) ||
      !plainLabel(row.courseTitle) ||
      typeof row.dueAt !== 'string' ||
      row.dueAt.length > 40 ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(
        row.dueAt,
      ) ||
      !Number.isFinite(Date.parse(row.dueAt))
    )
      return [];
    const day = row.dueAt.slice(0, 10);
    if (new Date(day + 'T00:00:00Z').toISOString().slice(0, 10) !== day) return [];
    const key = JSON.stringify([row.workspaceId, row.kind, row.taskId]);
    if (seen.has(key)) return [];
    seen.add(key);
    result.push({
      workspaceId: row.workspaceId,
      taskId: row.taskId,
      kind: row.kind,
      title: row.title,
      courseTitle: row.courseTitle,
      dueAt: row.dueAt,
    });
  }
  return result;
}

/** Understand a narrow follow-up without exporting private reader output to a model. */
export function courseworkStudyFollowup(
  question: string,
  now = new Date(),
): { date?: string } | null {
  if (
    !Number.isFinite(now.getTime()) ||
    question.length > 240 ||
    /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}「」『』“”"'`]/u.test(question)
  )
    return null;
  const text = question.normalize('NFKC').replace(/[\s，,。．！？?!、]/g, '');
  // A quoted example, negative instruction or different operation is not a scheduling request.
  if (
    !/(?:30分鐘|三十分鐘|半小時)/.test(text) ||
    !/找|安排|幫我排|替我排|準備|複習|讀書/.test(text)
  )
    return null;
  const withoutDueHint = text.replace(/(?:今天|今日|明天|明日|後天)(?:要交|要繳|截止)/g, '');
  const dayWords = withoutDueHint.match(/今天|今日|明天|明日|後天/g) ?? [];
  if (dayWords.length > 1) return null;
  const terms =
    /(?:剛才那份|剛剛那份|剛才這份|剛剛這份|三十分鐘|30分鐘|半小時|這份|那份|這個|上面|作業|測驗|今天|今日|明天|明日|後天|幫我排|替我排|可不可以|能不能|可以|幫我|替我|麻煩|請問|請|幫|替|我|找出|找|安排|準備|複習|讀書|空堂|空檔|時段|時間|一段|一個|哪|能|的|嗎|呢|吧)/uy;
  let offset = 0;
  while (offset < withoutDueHint.length) {
    terms.lastIndex = offset;
    const match = terms.exec(withoutDueHint);
    if (!match) return null;
    offset = terms.lastIndex;
  }
  if (!dayWords.length) return {};
  const dayWord = dayWords[0] ?? '';
  const days = /後天/.test(dayWord) ? 2 : /明天|明日/.test(dayWord) ? 1 : 0;
  return {
    date: new Date(now.getTime() + 8 * 60 * 60 * 1000 + days * 86400000).toISOString().slice(0, 10),
  };
}

export function courseworkStudyTarget(selection: AssistantCourseworkSelection) {
  return {
    workspaceId: selection.target.workspaceId,
    taskId: selection.target.taskId,
    kind: selection.target.kind,
    ...(selection.date ? { date: selection.date } : {}),
  };
}
