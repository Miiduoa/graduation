import { periodLabel, scheduledClassTimeLabel, type AgendaCourse, type AgendaScheduledClass } from './campusStudyAgenda';
import type { CampusEvidencePlan, CampusPlanRoute } from './offlineCampusPlanner';

/** Saved evidence is for comparison only. It never restores permission to open or change a record. */
export interface CampusPlanComparisonBasis {
  assignments: {
    status: 'complete' | 'partial' | 'unavailable';
    checkedAt: string | null;
    total: number | null;
    items: Array<{
      identity: [string, string] | null;
      title: string;
      groupName: string;
      dueAt: string | null;
      /** Only the platform parser may confirm a receipt belonging to the current user. */
      activity?: {
        state: 'open' | 'closed';
        receipt: { submittedAt: string | null } | null;
      };
    }>;
  };
  /** Kept separate so a failed or older quiz read cannot change assignment conclusions. */
  quizzes?: CampusPlanComparisonBasis['assignments'];
  timetableUpdatedAt: string | null;
}

export interface CampusPlanChange {
  id: string;
  category: 'assignment' | 'quiz' | 'timetable' | 'scope' | 'source';
  kind: 'added' | 'missing' | 'changed' | 'receipt' | 'unverifiable' | 'window';
  title: string;
  before?: string;
  after?: string;
  detail: string;
  route?: CampusPlanRoute;
}

export interface CampusPlanComparison {
  previousCheckedAt: string;
  currentCheckedAt: string;
  changes: CampusPlanChange[];
  unchangedAssignments: number;
  /** Absent when neither plan inspected a quiz source. */
  unchangedQuizzes?: number;
  comparableDates: number;
  limitations: string[];
}

type TaskBasis = CampusPlanComparisonBasis['assignments'];
type Task = TaskBasis['items'][number];
type TaskKind = 'assignment' | 'quiz';

const timestampFormat = new Intl.DateTimeFormat('zh-TW', {
  timeZone: 'Asia/Taipei', year: 'numeric', month: 'numeric', day: 'numeric',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

function timestamp(value: string | null): number | null {
  if (typeof value !== 'string' || !/T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function dateTime(value: string | null): string {
  const time = timestamp(value);
  if (time === null) return '時間未確認';
  const parts = timestampFormat.formatToParts(new Date(time));
  const part = (name: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === name)?.value ?? '';
  const fraction = new Date(time).getUTCMilliseconds();
  const seconds = part('second') !== '00' || fraction ? ':' + part('second') : '';
  return part('year') + '/' + part('month') + '/' + part('day') + ' ' + part('hour') + ':' + part('minute') +
    seconds + (fraction ? '.' + String(fraction).padStart(3, '0') : '');
}

function taskText(item: Task, kind: TaskKind): string {
  const deadline = kind === 'quiz' ? '參考期限' : '截止時間';
  return (item.groupName ? item.groupName + '｜' : '') + item.title + '\n' +
    (timestamp(item.dueAt) === null ? deadline + '未確認' :
      (kind === 'quiz' ? '參考期限 ' : '截止 ') + dateTime(item.dueAt));
}

function activityText(item: Task, kind: TaskKind): string {
  const activity = item.activity;
  const record = kind === 'quiz' ? '作答紀錄' : '繳交紀錄';
  const context = (item.groupName ? item.groupName + '｜' : '') + item.title + '\n';
  if (!activity) return context + '未保存平台狀態與本人' + record;
  return context + '平台狀態：' + (activity.state === 'closed' ? '關閉' : '開放') + '\n' +
    (activity.receipt ? '本人' + record + '：' + dateTime(activity.receipt.submittedAt)
      : '未回傳本人' + record);
}

function activityChange(
  prior: Task, next: Task, key: string, kind: TaskKind,
  earlier: number | null, later: number | null,
): CampusPlanChange | null {
  const before = prior.activity;
  const after = next.activity;
  const previousTime = before?.receipt ? timestamp(before.receipt.submittedAt) : null;
  const currentTime = after?.receipt ? timestamp(after.receipt.submittedAt) : null;
  if (before?.state === after?.state && Boolean(before?.receipt) === Boolean(after?.receipt) &&
      previousTime === currentTime) return null;

  const name = kind === 'quiz' ? '測驗' : '作業';
  const record = kind === 'quiz' ? '作答紀錄' : '繳交紀錄';
  const fresh = earlier !== null && later !== null && later > earlier;
  const receiptChanged = Boolean(before?.receipt) !== Boolean(after?.receipt) || previousTime !== currentTime;
  const stateDetail = before && after && before.state !== after.state
    ? after.state === 'closed' ? name + '已關閉；關閉不代表本人已完成。'
      : name + '已重新開放；請到課程頁確認是否仍需處理。' : '';
  let changeKind: CampusPlanChange['kind'] = 'unverifiable';
  let detail: string;
  if (!after) {
    detail = '本次未取得平台狀態與本人' + record + '，無法核對原計畫的紀錄；不能據此推定已撤回或未完成。';
  } else if (before?.receipt && !after.receipt) {
    detail = '本次未回傳本人' + record + '；不能據此推定已撤回或未完成。' +
      (fresh ? stateDetail : '兩次來源未確認為先後更新的同步資料，平台狀態變化仍待核對。');
  } else if (!fresh) {
    detail = '兩次來源未確認為先後更新的同步資料，無法判定本人' + record + '或平台狀態何時改變；請重新整理後核對。';
  } else if (after.receipt && currentTime !== null && later !== null && currentTime > later) {
    detail = '本人' + record + '的時間晚於本次來源同步時間，資料時間不一致；無法確認本次完成，請到課程頁核對。';
  } else if (after.receipt && (!before || receiptChanged)) {
    changeKind = 'receipt';
    detail = !before
      ? '原計畫未保存平台狀態與本人' + record + '；本次平台確認有本人紀錄，無法判定是否在兩次規劃之間完成。'
      : before.receipt
        ? '平台回傳的本人' + record + '時間有更新；無法僅憑時間變更判定是否重新送出。'
        : '本次平台回傳本人' + record + '，可到課程頁核對提交內容。';
    if (currentTime === null) detail += '紀錄時間未確認，無法判定何時完成。';
    else if (earlier !== null && currentTime <= earlier && !before?.receipt) {
      detail += '紀錄時間早於或等於原來源同步時間，不能視為這次新完成。';
    }
    detail += stateDetail;
  } else if (!before) {
    detail = '原計畫未保存平台狀態與本人' + record + '；本次未回傳本人紀錄，無法判定期間內的狀態變化。' +
      (after.state === 'closed' ? name + '關閉不代表本人已完成。' : '');
  } else {
    changeKind = 'changed';
    detail = stateDetail;
  }
  return {
    id: kind + ':activity:' + key, category: kind, kind: changeKind,
    title: next.title, before: activityText(prior, kind), after: activityText(next, kind),
    detail, route: '/classroom',
  };
}

function taskIndex(items: Task[]) {
  const rows = new Map<string, Task>();
  const duplicates = new Set<string>();
  let unidentified = 0;
  for (const item of items) {
    if (!Array.isArray(item.identity) || item.identity.length !== 2 ||
        item.identity.some((value) => typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value))) {
      unidentified += 1;
      continue;
    }
    const key = JSON.stringify(item.identity);
    if (rows.has(key)) duplicates.add(key);
    else rows.set(key, item);
  }
  return { rows, duplicates, unidentified };
}

function completeIdentities(basis: TaskBasis, index: ReturnType<typeof taskIndex>): boolean {
  return basis.status === 'complete' && basis.total === basis.items.length &&
    index.unidentified === 0 && index.duplicates.size === 0;
}

function compareTasks(
  before: TaskBasis | undefined,
  after: TaskBasis | undefined,
  result: CampusPlanComparison,
  priorities: Map<string, number>,
  kind: TaskKind,
): void {
  const name = kind === 'quiz' ? '測驗' : '作業';
  if (!before || !after) {
    result.changes.push({
      id: 'source:' + kind + '-history', category: 'source', kind: 'unverifiable',
      title: name + '來源無法完整比對',
      detail: !before ? kind === 'quiz'
        ? '原計畫未保存測驗來源，這次開始納入；無法判定哪些測驗是新發布或曾經完成。' +
          (after?.status === 'unavailable' ? '這次測驗來源也不可用，請稍後重新整理。' : '')
        : '原計畫未保存作業的來源識別，無法確認哪些是同一份作業。'
        : '本次沒有' + name + '比對資料，請重新整理或開啟課程頁核對。',
      route: '/classroom',
    });
    result.limitations.push('未以同名、摘要順序或個人勾選推定' + name + '的新增、延期或完成。');
    return;
  }

  const status = { complete: '完整摘要', partial: '部分摘要', unavailable: '來源不可用' };
  if (before.status !== 'complete' || after.status !== 'complete') {
    result.changes.push({
      id: 'source:' + kind + '-coverage', category: 'source', kind: 'unverifiable',
      title: name + '資料仍有待核對', before: status[before.status], after: status[after.status],
      detail: after.status === 'unavailable' ? '這次無法讀取' + name + '，未出現的項目不能視為已完成。'
        : before.status === 'unavailable' ? '原計畫沒有可用' + name + '來源，無法確認本次列出的項目是否新增。'
          : '部分' + (kind === 'quiz' ? '測驗' : '') + '摘要可能漏列項目，只比對兩次都有來源識別的內容。',
      route: '/classroom',
    });
  }
  if (before.status === 'unavailable' || after.status === 'unavailable') return;

  const earlier = timestamp(before.checkedAt);
  const later = timestamp(after.checkedAt);
  if (earlier !== null && later !== null && later < earlier) {
    result.changes.push({
      id: 'source:' + kind + '-time', category: 'source', kind: 'unverifiable',
      title: '本次' + name + '資料較舊', before: dateTime(before.checkedAt), after: dateTime(after.checkedAt),
      detail: '本次' + (kind === 'quiz' ? '測驗' : '') + '摘要早於原計畫的來源，請更新資料後再核對變動。', route: '/classroom',
    });
    return;
  }
  if (earlier !== null && earlier === later) {
    result.limitations.push('本次沿用同一次' + name + '同步資料，尚未取得較新的校方摘要。');
  } else if (earlier === null || later === null) {
    result.limitations.push('部分' + name + '來源缺少同步時間，無法確認資料是否更新。');
  }

  const previous = taskIndex(before.items);
  const current = taskIndex(after.items);
  const ambiguous = new Set([...previous.duplicates, ...current.duplicates]);
  if (ambiguous.size || previous.unidentified || current.unidentified) {
    result.changes.push({
      id: 'source:' + kind + '-identities', category: 'source', kind: 'unverifiable',
      title: '部分' + name + '無法一一對照',
      detail: '有' + (kind === 'quiz' ? '測驗' : '') + '項目缺少來源識別或識別重複，已略過不確定的對應；不按同名或排列順序配對。',
      route: '/classroom',
    });
  }
  for (const [label, basis] of [['原計畫', before], ['本次', after]] as const) {
    if (basis.status === 'complete' && basis.total !== basis.items.length) {
      result.limitations.push(label + '的' + name + '總數與已讀內容不一致，未據此判定新增或未列出項目。');
    }
  }

  for (const key of [...current.rows.keys()].sort()) {
    if (ambiguous.has(key)) continue;
    const next = current.rows.get(key)!;
    const prior = previous.rows.get(key);
    if (!prior) {
      const added = completeIdentities(before, previous);
      result.changes.push({
        id: kind + ':current:' + key, category: kind, kind: added ? 'added' : 'unverifiable',
        title: next.title, after: taskText(next, kind),
        detail: added ? '本次摘要多出這項' + (kind === 'quiz' ? '測驗' : '待辦') + '，請開啟' + name + '頁確認內容。'
          : '本次查到這項' + (kind === 'quiz' ? '測驗' : '待辦') + '；原資料不完整，無法判定是否新增。',
        route: '/classroom',
      });
      continue;
    }
    const nameChanged = prior.title !== next.title || prior.groupName !== next.groupName;
    const oldDue = timestamp(prior.dueAt);
    const newDue = timestamp(next.dueAt);
    const activity = activityChange(prior, next, key, kind, earlier, later);
    if (activity) {
      priorities.set(activity.id, 2);
      result.changes.push(activity);
    }
    if (!nameChanged && oldDue === newDue) {
      if (!activity) {
        if (kind === 'quiz') result.unchangedQuizzes = (result.unchangedQuizzes ?? 0) + 1;
        else result.unchangedAssignments += 1;
      }
      continue;
    }
    const deadlineLabel = kind === 'quiz' ? '測驗參考期限' : '截止時間';
    const deadline = oldDue === newDue ? ''
      : newDue === null ? '本次' + deadlineLabel + '未確認，不能視為取消期限。'
        : oldDue === null ? '本次取得了可核對的' + deadlineLabel + '。' : deadlineLabel + '有變動。';
    const id = kind + ':changed:' + key;
    priorities.set(id, oldDue !== newDue && newDue !== null
      ? oldDue !== null && newDue < oldDue ? 0 : 1 : 2);
    result.changes.push({
      id, category: kind,
      kind: !nameChanged && newDue === null ? 'unverifiable' : 'changed',
      title: next.title, before: taskText(prior, kind), after: taskText(next, kind),
      detail: (nameChanged ? name + '或課程名稱有更新。' : '') + deadline + '請開啟' + name + '頁核對。',
      route: '/classroom',
    });
  }
  for (const key of [...previous.rows.keys()].sort()) {
    if (ambiguous.has(key) || current.rows.has(key)) continue;
    const prior = previous.rows.get(key)!;
    const missing = completeIdentities(after, current);
    result.changes.push({
      id: kind + ':previous:' + key, category: kind, kind: missing ? 'missing' : 'unverifiable',
      title: prior.title, before: taskText(prior, kind),
      detail: missing ? kind === 'quiz'
        ? '本次摘要未列出這項測驗；這不能證明已作答或完成，請到課程頁核對。'
        : '本次摘要未列出；這不能證明已繳交，請到課程頁核對。'
        : '本次資料不足以核對這項' + (kind === 'quiz' ? '測驗' : '待辦') + '，未判定為移除或完成。',
      route: '/classroom',
    });
  }
}

function courseKey(course: AgendaCourse): string {
  return JSON.stringify([course.name, course.day, course.start, course.end, course.room ?? '']);
}

function courseText(courses: AgendaCourse[]): string {
  if (!courses.length) return '這份手機課表副本未列課程';
  return [...courses].sort((a, b) => a.start - b.start || a.end - b.end || courseKey(a).localeCompare(courseKey(b)))
    .map((course) => periodLabel(course) + '｜' + course.name + (course.room ? ' · ' + course.room : '')).join('\n');
}

function scheduledClassKey(course: AgendaScheduledClass): string {
  return JSON.stringify([course.name, timestamp(course.startAt), timestamp(course.endAt), course.room]);
}

function scheduledClassText(courses: AgendaScheduledClass[], date: string): string {
  if (!courses.length) return '這份手機課表副本未列課程';
  return [...courses].sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt) ||
    Date.parse(a.endAt) - Date.parse(b.endAt) || scheduledClassKey(a).localeCompare(scheduledClassKey(b)))
    .map((course) => scheduledClassTimeLabel(course, date) + '｜' + course.name + (course.room ? ' · ' + course.room : '')).join('\n');
}

function dateRange(dates: string[]): string {
  const formatted = dates.map((date) => date.replace(/-/g, '/'));
  return formatted.length > 1 ? formatted[0] + '–' + formatted[formatted.length - 1] : formatted[0];
}

function compareTimetable(before: CampusEvidencePlan, after: CampusEvidencePlan, result: CampusPlanComparison): void {
  const previous = before.agenda;
  const current = after.agenda;
  if (!previous || !current) {
    result.limitations.push(!previous ? '原計畫沒有逐日課表，無法按日期核對課程。'
      : '本次沒有逐日課表，無法核對課程變動。');
    return;
  }
  const previousDays = new Map(previous.days.map((day) => [day.date, day]));
  const currentDays = new Map(current.days.map((day) => [day.date, day]));
  const previousDates = [...previousDays.keys()].sort();
  const currentDates = [...currentDays.keys()].sort();
  const commonDates = currentDates.filter((date) => previousDays.has(date));
  if (JSON.stringify(previousDates) !== JSON.stringify(currentDates)) {
    result.changes.push({
      id: 'scope:dates', category: 'scope', kind: 'window', title: '規劃日期已更新',
      before: dateRange(previousDates), after: dateRange(currentDates),
      detail: commonDates.length ? '只核對共同的 ' + commonDates.length + ' 天；日期移出範圍不代表停課。'
        : '兩份計畫沒有重疊日期，無法逐日比較課程。',
    });
  }
  if (!previous.timetableAvailable || !current.timetableAvailable) {
    result.changes.push({
      id: 'source:timetable', category: 'source', kind: 'unverifiable', title: '課表來源無法核對',
      before: previous.timetableAvailable ? '有手機課表副本' : '課表來源不可用',
      after: current.timetableAvailable ? '有手機課表副本' : '課表來源不可用',
      detail: '課表未出現不能當作課程已取消，請先核對個人課表。', route: '/timetable',
    });
    return;
  }
  if (previous.ignoredCourses || current.ignoredCourses) {
    result.limitations.push('課表含未排時段或格式不完整的課程，只核對已列出的課程。');
  }
  const incompatibleDates: string[] = [];
  for (const date of commonDates) {
    const oldDay = previousDays.get(date)!;
    const newDay = currentDays.get(date)!;
    const oldScheduled = oldDay.scheduledClasses;
    const newScheduled = newDay.scheduledClasses;
    if ((oldScheduled !== undefined) !== (newScheduled !== undefined)) {
      incompatibleDates.push(date);
      continue;
    }
    result.comparableDates += 1;
    const clockFormat = oldScheduled !== undefined && newScheduled !== undefined;
    const oldKeys = clockFormat ? oldScheduled.map(scheduledClassKey) : oldDay.courses.map(courseKey);
    const newKeys = clockFormat ? newScheduled.map(scheduledClassKey) : newDay.courses.map(courseKey);
    // Keep duplicate counts. Two same-name courses must not collapse into one meeting.
    if (JSON.stringify(oldKeys.sort()) === JSON.stringify(newKeys.sort())) continue;
    result.changes.push({
      id: 'timetable:' + date, category: 'timetable', kind: 'changed', title: date.replace(/-/g, '/') + ' 課表有差異',
      before: clockFormat ? scheduledClassText(oldScheduled, date) : courseText(oldDay.courses),
      after: clockFormat ? scheduledClassText(newScheduled, date) : courseText(newDay.courses),
      detail: '這天的手機課表副本內容不同，請核對正式課表與教室。', route: '/timetable',
    });
  }
  if (incompatibleDates.length) {
    result.changes.push({
      id: 'source:timetable-format', category: 'source', kind: 'unverifiable', title: '課表時間格式無法對照',
      detail: '共同日期中有 ' + incompatibleDates.length + ' 天使用不同時間格式：一份是節次，一份是鐘點。未換算節次，也未以同名猜測同一堂課。',
      route: '/timetable',
    });
  }
  const oldTime = timestamp(before.comparisonBasis?.timetableUpdatedAt ?? null);
  const newTime = timestamp(after.comparisonBasis?.timetableUpdatedAt ?? null);
  if (oldTime !== null && oldTime === newTime) {
    result.limitations.push('課表仍是同一保存時間的手機副本，未向校方即時查證。');
  } else if (oldTime === null || newTime === null) {
    result.limitations.push('部分課表未保留保存時間，差異只代表兩份計畫所列內容。');
  } else if (newTime < oldTime) {
    result.limitations.push('本次手機課表的保存時間較早，請確認是否使用了舊副本。');
  }
}

/** Compare displayed evidence only; never copy progress, refresh a source or execute an action. */
export function compareCampusPlans(before: CampusEvidencePlan, after: CampusEvidencePlan): CampusPlanComparison {
  const hasQuizzes = before.comparisonBasis?.quizzes !== undefined || after.comparisonBasis?.quizzes !== undefined;
  const result: CampusPlanComparison = {
    previousCheckedAt: before.checkedAt,
    currentCheckedAt: after.checkedAt,
    changes: [], unchangedAssignments: 0, comparableDates: 0, limitations: [],
    ...(hasQuizzes ? { unchangedQuizzes: 0 } : {}),
  };
  const priorities = new Map<string, number>();
  compareTasks(before.comparisonBasis?.assignments, after.comparisonBasis?.assignments, result, priorities, 'assignment');
  if (hasQuizzes) compareTasks(before.comparisonBasis?.quizzes, after.comparisonBasis?.quizzes, result, priorities, 'quiz');
  compareTimetable(before, after, result);
  // Put verified deadline changes first, then retain source warnings before long lists of new rows.
  const rank = (change: CampusPlanChange) => priorities.get(change.id) ??
    (change.category === 'source' ? 3 : change.category === 'scope' ? 4 : change.category === 'timetable' ? 5
      : change.kind === 'added' ? 6 : change.kind === 'missing' ? 7 : 8);
  result.changes.sort((first, second) => rank(first) - rank(second));
  result.limitations = [...new Set(result.limitations)];
  return result;
}
