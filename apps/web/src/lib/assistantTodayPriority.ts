import type { PersonalTodayEntry } from '@campus/shared/src/imports/today';
import type { NuniStudyTask } from '@campus/shared/src/nuniStudyAgenda';
import { pickTodayPriority } from '@campus/shared/src/todayPriority';
import { formatTaipeiDateTime, parseTaipeiInstant } from '@campus/shared/src/taipeiTime';
import { validClassDate } from '@campus/shared/src/timetable/classExceptions';
import { parseAssistantCourseworkTargets } from './assistantCoursework';
import type { LocalAssistantResult } from './assistantLocalActions';

const taskKey = (task: NuniStudyTask) => JSON.stringify([task.courseId, task.kind, task.id]);

type SourceStatus = 'partial' | 'missing' | 'ready';

export function assistantTodayPriority({
  entries, tasks, scheduleStatus, courseworkStatus, now,
}: {
  entries: readonly PersonalTodayEntry[];
  tasks: readonly NuniStudyTask[];
  scheduleStatus: SourceStatus;
  courseworkStatus: SourceStatus;
  now: Date;
}): LocalAssistantResult {
  const classes = entries.map(({ row, startAt, endAt }) => ({
    id: row.id, title: row.title, location: row.location || '', startAt, endAt,
  }));
  const open = tasks.filter(task => task.state === 'open' && task.submittedAt === null);
  let undated = false;
  const todos = open.flatMap(task => {
    const dueAt = task.dueAt && validClassDate(task.dueAt.slice(0, 10)) ? parseTaipeiInstant(task.dueAt) : null;
    if (dueAt === null) {
      undated = true;
      return [];
    }
    return [{ id: taskKey(task), title: task.title, courseName: task.courseTitle, courseId: task.courseId, dueAt }];
  });
  const priority = pickTodayPriority(classes, todos, now);
  const lines = priority ? [priority.title, priority.reason]
    : [scheduleStatus !== 'ready' || courseworkStatus !== 'ready'
      ? '目前讀到的資料裡，沒有可列為優先的項目。'
      : '今天剩餘的課表沒有課，也沒有讀到今天截止的未完成作業或測驗。'];
  if (scheduleStatus === 'missing') lines.push('這台裝置還沒有這所學校的課表。匯入課表後，就能核對截止時間是否碰上課堂。');
  if (scheduleStatus === 'partial') lines.push('這台裝置的本學期課表尚未完整，可能還有其他課。');
  if (courseworkStatus === 'missing') lines.push('目前沒有已連結的學生課程，可從「課程與作業」加入班級。');
  if (courseworkStatus === 'partial') lines.push('所選校園的 nuni 課程待辦尚未完整核對。');
  if (undated)
    lines.push('有待辦缺少可核對的截止時間，未列入這次排序。');
  lines.push(`資料來源：此帳號在本機保存的課表、所選校園的 nuni 作業與測驗。查詢時間：${formatTaipeiDateTime(now, { seconds: false })}。`);

  // Only the exact selected, future-due source may open a preparation plan.
  const selected = priority?.todo ? open.filter(task => taskKey(task) === priority.todo?.id) : [];
  const task = selected.length === 1 ? selected[0] : null;
  const courseworkTargets = task && priority?.todo?.dueAt && priority.todo.dueAt > now.getTime()
    ? parseAssistantCourseworkTargets([{ workspaceId: task.courseId, taskId: task.id, kind: task.kind,
        title: task.title, courseTitle: task.courseTitle, dueAt: task.dueAt }])
    : [];
  return { kind: 'personal', content: lines.join('\n'), serviceIds: scheduleStatus === 'missing' ? ['import', 'classroom'] : ['timetable', 'classroom'], courseworkTargets };
}
