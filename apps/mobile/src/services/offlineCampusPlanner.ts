import type { OnDeviceSchoolContext } from './onDeviceSchoolContext';
import type { CampusSenseSnapshot } from './campusSenseSnapshot';
import { CAMPUS_SENSE_MAX_AGE_MS } from './campusSenseSnapshot';
import {
  buildCampusStudyAgenda,
  formatCampusStudyAgenda,
  periodLabel,
  resolveStudyWindow,
  taipeiDayNumber,
  type CampusStudyAgenda,
} from './campusStudyAgenda';

/** A plan is read-only; local reminder creation has its own explicit confirmation. */
export type CampusPlanRoute = '/classroom' | '/timetable' | '/announcements';
export type CampusPlanPriority = 'overdue' | 'urgent' | 'soon' | 'normal' | 'verify';
export type CampusPlanEvidence = 'authorized-assignments' | 'saved-timetable' | 'authorized-announcements' | 'verification';

export interface CampusPlanStep {
  id: string;
  title: string;
  detail: string;
  priority: CampusPlanPriority;
  evidence: CampusPlanEvidence;
  route: CampusPlanRoute;
  /** Only server-authorized assignment steps may carry a verified deadline. */
  dueAt?: string;
  groupName?: string;
}

export interface CampusEvidencePlan {
  title: string;
  overview: string;
  checkedAt: string;
  steps: CampusPlanStep[];
  limitations: string[];
  /** Complete dated view; optional for existing clients and stored replies. */
  agenda?: CampusStudyAgenda;
  /** Plain-text fallback for text-to-speech and non-card clients. */
  content: string;
}

const DAY_MS = 86_400_000;
const DAY_NAMES = ['日', '一', '二', '三', '四', '五', '六'];

function cleaned(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 130);
}

function wantsSourceBackedPlan(question: string): boolean {
  const planning = /安排|規劃|計畫|今日重點|今天要做|今天要先|今天先做|今天該做|先處理|先完成|優先順序|待辦摘要|校園摘要|本週重點|這週重點|接下來七天|未來七天|讀書進度|怎麼分配/.test(question);
  const scope = /今天|明天|今日|這週|本週|下週|下星期|下禮拜|七天|7天|課表|空堂|作業|待交|待繳|截止|學習|讀書|複習|報告|待辦|校園/.test(question);
  const write = /(?:幫我|替我|直接|立刻).{0,22}(?:送出|提交|請假|下單|付款|發訊息|訂餐|報修|刪除|改成已讀)/.test(question);
  return planning && scope && !write;
}

function validAuthorizedSnapshot(
  snapshot: CampusSenseSnapshot | null | undefined,
  context: OnDeviceSchoolContext,
  uid: string,
  now: number,
): CampusSenseSnapshot | null {
  if (!uid || !snapshot || snapshot.userId !== uid || snapshot.schoolId !== context.schoolId) return null;
  const checkedAt = Date.parse(snapshot.checkedAt);
  if (!Number.isFinite(checkedAt) || checkedAt > now + 30_000 || now - checkedAt > CAMPUS_SENSE_MAX_AGE_MS) return null;
  return snapshot;
}

function localDate(value: string): string {
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(new Date(value));
}

function dueTimestamp(value: string | null): number {
  if (!value || !/T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) return NaN;
  return Date.parse(value);
}

function duePriority(dueAt: string | null, now: number): CampusPlanPriority {
  const due = dueTimestamp(dueAt);
  if (!Number.isFinite(due)) return 'verify';
  if (due < now) return 'overdue';
  if (due - now <= DAY_MS) return 'urgent';
  if (due - now <= 3 * DAY_MS) return 'soon';
  return 'normal';
}

function priorityLabel(priority: CampusPlanPriority): string {
  switch (priority) {
    case 'overdue': return '截止時間已過';
    case 'urgent': return '24 小時內截止';
    case 'soon': return '三天內截止';
    case 'normal': return '即將到期';
    default: return '需要查證';
  }
}

/** No backend calls, no persistent state, and no mutation of either source. */
export function buildOfflineCampusPlan(input: {
  question: string;
  context: OnDeviceSchoolContext;
  snapshot?: CampusSenseSnapshot | null;
  uid: string;
}): CampusEvidencePlan | null {
  const question = input.question.trim().slice(0, 1600);
  if (!wantsSourceBackedPlan(question)) return null;
  const now = Date.parse(input.context.checkedAt);
  if (!Number.isFinite(now)) return null;
  const sense = validAuthorizedSnapshot(input.snapshot, input.context, input.uid, now);
  const hasTimetable = input.context.timetable.source === 'saved-device-copy';
  if (!sense && !hasTimetable) return null;
  const window = resolveStudyWindow(question, now);
  if (!window) return null;
  const { startDay, endDay, title } = window;
  const limitations: string[] = [];
  const steps: CampusPlanStep[] = [];
  const agenda = buildCampusStudyAgenda({
    window, now,
    courses: hasTimetable ? input.context.timetable.courses : null,
    assignments: sense?.assignments.status === 'available' ? sense.assignments.items : null,
  });

  if (sense?.assignments.status === 'available') {
    const rows = [...sense.assignments.items].sort((a, b) => {
      const first = dueTimestamp(a.dueAt);
      const second = dueTimestamp(b.dueAt);
      return (Number.isFinite(first) ? first : Infinity) - (Number.isFinite(second) ? second : Infinity);
    });
    const relevant = rows.filter((item) => {
      const due = dueTimestamp(item.dueAt);
      if (!Number.isFinite(due)) return true;
      const dueDay = taipeiDayNumber(due);
      return due < now || (dueDay >= startDay && dueDay < endDay);
    });
    const selected = (relevant.length ? relevant : rows.slice(0, 1)).slice(0, 3);
    for (const [index, assignment] of selected.entries()) {
      const confirmedDueAt = Number.isFinite(dueTimestamp(assignment.dueAt)) ? assignment.dueAt : null;
      const priority = duePriority(confirmedDueAt, now);
      const due = confirmedDueAt
        ? '截止 ' + localDate(confirmedDueAt) + '；' + priorityLabel(priority)
        : '來源沒有可核對的截止日期；請先核對作業頁';
      steps.push({
        id: 'assignment-' + index,
        title: cleaned(assignment.title),
        detail: (assignment.groupName ? cleaned(assignment.groupName) + '｜' : '') +
          due + '。請到課程頁確認繳交方式與最新狀態。',
        priority, evidence: 'authorized-assignments', route: '/classroom',
        ...(confirmedDueAt ? { dueAt: confirmedDueAt } : {}),
        ...(assignment.groupName ? { groupName: assignment.groupName } : {}),
      });
    }
    if (sense.assignments.count !== null && sense.assignments.count > sense.assignments.items.length) {
      limitations.push('本次僅同步部分作業摘要；還有項目需至課程頁核對。');
    }
    if (sense.assignments.count === 0) {
      limitations.push('已串接課程這次沒有列出待交作業，不代表所有學校系統都已完成。');
    }
  } else {
    limitations.push('尚無可用的已授權作業摘要，無法判定是否有作業待交。');
  }

  if (hasTimetable) {
    const firstDay = agenda.days.find((day) => day.courses.length > 0);
    if (firstDay) {
      const weekday = new Date(firstDay.date + 'T00:00:00Z').getUTCDay();
      const lessons = firstDay.courses;
      const names = lessons.slice(0, 3).map((course) => cleaned(course.name)).join('、');
      const gap = firstDay.gaps.length
        ? '已排課程之間有' + firstDay.gaps.map(periodLabel).join('、') + '空檔，可評估安排複習；'
        : '';
      const conflict = firstDay.conflicts.length
        ? '課表重疊：' + firstDay.conflicts.map(periodLabel).join('、') + '，請先核對；'
        : '';
      const isToday = agenda.days.length === 1 && startDay === taipeiDayNumber(now);
      steps.push({
        id: 'timetable-review',
        title: (isToday ? '今日手機課表副本' : '課表副本') + '｜星期' + DAY_NAMES[weekday],
        detail: lessons.length + ' 門已保存課程（' + names + (lessons.length > 3 ? '等' : '') +
          '）。' + conflict + gap + '實際鐘點、停課或調課仍須核對正式課表。',
        priority: firstDay.conflicts.length ? 'verify' : 'normal',
        evidence: 'saved-timetable', route: '/timetable',
      });
    } else {
      limitations.push('手機課表副本在這個期間沒有排課，不代表校方正式課表沒有課。');
    }
  } else {
    limitations.push('這台手機尚未儲存可確認的個人課表副本。');
  }

  if (sense?.announcements.status === 'available' && sense.announcements.items.length) {
    steps.push({
      id: 'announcement-review', title: '核對最新校園通知',
      detail: '上次同步含 ' + sense.announcements.items.length +
        ' 則公告摘要；先確認與你的課程及期限是否有關，不把舊公告當作最新消息。',
      priority: 'verify', evidence: 'authorized-announcements', route: '/announcements',
    });
  } else {
    limitations.push('沒有可確認的新公告摘要，請至公告頁核對是否有更新。');
  }
  if (!steps.length) {
    steps.push({
      id: 'verify-course', title: '先核對課程與作業來源',
      detail: '目前缺少足夠資訊，先開啟已登入的課程頁查核，再決定今天的工作。',
      priority: 'verify', evidence: 'verification', route: '/classroom',
    });
  }
  const checked = sense ? '上次主動同步：' + localDate(sense.checkedAt) : '只使用手機內已保存課表';
  const overview = checked + '。以下是依現有資料整理的行動建議，不是校方即時紀錄。';
  const content = [
    title, overview,
    ...steps.slice(0, 5).map((step, i) => (i + 1) + '. ' + step.title + '：' + step.detail),
    '逐日安排（台灣時間）：', ...formatCampusStudyAgenda(agenda),
    ...(agenda.outsideWindow.length ? ['另有 ' + agenda.outsideWindow.length + ' 項作業的期限未確認或不在這個日期範圍，請開啟課程頁核對。'] : []),
    ...limitations.slice(0, 3).map((item) => '資料提醒：' + item),
    '建議下一步：開啟相應服務核對，沒有替你提交任何作業、申請或行事曆事件。',
  ].join('\n');
  return {
    title, overview, checkedAt: input.context.checkedAt,
    steps: steps.slice(0, 5), limitations: limitations.slice(0, 4), agenda, content,
  };
}
