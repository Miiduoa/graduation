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
    }>;
  };
  timetableUpdatedAt: string | null;
}

export interface CampusPlanChange {
  id: string;
  category: 'assignment' | 'timetable' | 'scope' | 'source';
  kind: 'added' | 'missing' | 'changed' | 'unverifiable' | 'window';
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
  comparableDates: number;
  limitations: string[];
}

type AssignmentBasis = CampusPlanComparisonBasis['assignments'];
type Assignment = AssignmentBasis['items'][number];

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

function assignmentText(item: Assignment): string {
  return (item.groupName ? item.groupName + '｜' : '') + item.title + '\n' +
    (timestamp(item.dueAt) === null ? '截止時間未確認' : '截止 ' + dateTime(item.dueAt));
}

function assignmentIndex(items: Assignment[]) {
  const rows = new Map<string, Assignment>();
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

function completeIdentities(basis: AssignmentBasis, index: ReturnType<typeof assignmentIndex>): boolean {
  return basis.status === 'complete' && basis.total === basis.items.length &&
    index.unidentified === 0 && index.duplicates.size === 0;
}

function compareAssignments(
  before: AssignmentBasis | undefined,
  after: AssignmentBasis | undefined,
  result: CampusPlanComparison,
  priorities: Map<string, number>,
): void {
  if (!before || !after) {
    result.changes.push({
      id: 'source:assignment-history', category: 'source', kind: 'unverifiable',
      title: '作業來源無法完整比對',
      detail: !before ? '原計畫未保存作業的來源識別，無法確認哪些是同一份作業。'
        : '本次沒有作業比對資料，請重新整理或開啟課程頁核對。',
      route: '/classroom',
    });
    result.limitations.push('未以同名、摘要順序或個人勾選推定作業的新增、延期或完成。');
    return;
  }

  const status = { complete: '完整摘要', partial: '部分摘要', unavailable: '來源不可用' };
  if (before.status !== 'complete' || after.status !== 'complete') {
    result.changes.push({
      id: 'source:assignment-coverage', category: 'source', kind: 'unverifiable',
      title: '作業資料仍有待核對', before: status[before.status], after: status[after.status],
      detail: after.status === 'unavailable' ? '這次無法讀取作業，未出現的項目不能視為已完成。'
        : before.status === 'unavailable' ? '原計畫沒有可用作業來源，無法確認本次列出的項目是否新增。'
          : '部分摘要可能漏列項目，只比對兩次都有來源識別的內容。',
      route: '/classroom',
    });
  }
  if (before.status === 'unavailable' || after.status === 'unavailable') return;

  const earlier = timestamp(before.checkedAt);
  const later = timestamp(after.checkedAt);
  if (earlier !== null && later !== null && later < earlier) {
    result.changes.push({
      id: 'source:assignment-time', category: 'source', kind: 'unverifiable',
      title: '本次作業資料較舊', before: dateTime(before.checkedAt), after: dateTime(after.checkedAt),
      detail: '本次摘要早於原計畫的來源，請更新資料後再核對變動。', route: '/classroom',
    });
    return;
  }
  if (earlier !== null && earlier === later) {
    result.limitations.push('本次沿用同一次作業同步資料，尚未取得較新的校方摘要。');
  } else if (earlier === null || later === null) {
    result.limitations.push('部分作業來源缺少同步時間，無法確認資料是否更新。');
  }

  const previous = assignmentIndex(before.items);
  const current = assignmentIndex(after.items);
  const ambiguous = new Set([...previous.duplicates, ...current.duplicates]);
  if (ambiguous.size || previous.unidentified || current.unidentified) {
    result.changes.push({
      id: 'source:assignment-identities', category: 'source', kind: 'unverifiable',
      title: '部分作業無法一一對照',
      detail: '有項目缺少來源識別或識別重複，已略過不確定的對應；不按同名或排列順序配對。',
      route: '/classroom',
    });
  }
  for (const [label, basis] of [['原計畫', before], ['本次', after]] as const) {
    if (basis.status === 'complete' && basis.total !== basis.items.length) {
      result.limitations.push(label + '的作業總數與已讀內容不一致，未據此判定新增或未列出項目。');
    }
  }

  for (const key of [...current.rows.keys()].sort()) {
    if (ambiguous.has(key)) continue;
    const next = current.rows.get(key)!;
    const prior = previous.rows.get(key);
    if (!prior) {
      const added = completeIdentities(before, previous);
      result.changes.push({
        id: 'assignment:current:' + key, category: 'assignment', kind: added ? 'added' : 'unverifiable',
        title: next.title, after: assignmentText(next),
        detail: added ? '本次摘要多出這項待辦，請開啟作業頁確認內容。'
          : '本次查到這項待辦；原資料不完整，無法判定是否新增。',
        route: '/classroom',
      });
      continue;
    }
    const nameChanged = prior.title !== next.title || prior.groupName !== next.groupName;
    const oldDue = timestamp(prior.dueAt);
    const newDue = timestamp(next.dueAt);
    if (!nameChanged && oldDue === newDue) {
      result.unchangedAssignments += 1;
      continue;
    }
    const deadline = oldDue === newDue ? ''
      : newDue === null ? '本次截止時間未確認，不能視為取消期限。'
        : oldDue === null ? '本次取得了可核對的截止時間。' : '截止時間有變動。';
    const id = 'assignment:changed:' + key;
    priorities.set(id, oldDue !== newDue && newDue !== null
      ? oldDue !== null && newDue < oldDue ? 0 : 1 : 2);
    result.changes.push({
      id, category: 'assignment',
      kind: !nameChanged && newDue === null ? 'unverifiable' : 'changed',
      title: next.title, before: assignmentText(prior), after: assignmentText(next),
      detail: (nameChanged ? '作業或課程名稱有更新。' : '') + deadline + '請開啟作業頁核對。',
      route: '/classroom',
    });
  }
  for (const key of [...previous.rows.keys()].sort()) {
    if (ambiguous.has(key) || current.rows.has(key)) continue;
    const prior = previous.rows.get(key)!;
    const missing = completeIdentities(after, current);
    result.changes.push({
      id: 'assignment:previous:' + key, category: 'assignment', kind: missing ? 'missing' : 'unverifiable',
      title: prior.title, before: assignmentText(prior),
      detail: missing ? '本次摘要未列出；這不能證明已繳交，請到課程頁核對。'
        : '本次資料不足以核對這項待辦，未判定為移除或完成。',
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
  const result: CampusPlanComparison = {
    previousCheckedAt: before.checkedAt,
    currentCheckedAt: after.checkedAt,
    changes: [], unchangedAssignments: 0, comparableDates: 0, limitations: [],
  };
  const priorities = new Map<string, number>();
  compareAssignments(before.comparisonBasis?.assignments, after.comparisonBasis?.assignments, result, priorities);
  compareTimetable(before, after, result);
  // Put verified deadline changes first, then retain source warnings before long lists of new rows.
  const rank = (change: CampusPlanChange) => priorities.get(change.id) ??
    (change.category === 'source' ? 3 : change.category === 'scope' ? 4 : change.category === 'timetable' ? 5
      : change.kind === 'added' ? 6 : change.kind === 'missing' ? 7 : 8);
  result.changes.sort((first, second) => rank(first) - rank(second));
  result.limitations = [...new Set(result.limitations)];
  return result;
}
