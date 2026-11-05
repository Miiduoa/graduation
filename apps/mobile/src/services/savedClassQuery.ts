import { classDate } from '@campus/shared/src/timetable/classExceptions';
import type { OnDeviceSchoolContext, SavedClassOccurrence } from './onDeviceSchoolContext';

export type SavedClassRead = {
  uid: string;
  schoolId: string;
  classes: SavedClassOccurrence[];
  updatedAt: string | null;
  focus?: 'room' | 'time';
};

type ClassQuery = 'next' | 'today' | 'room' | 'time';

export function savedClassQuery(question: string, previous?: SavedClassRead): ClassQuery | null {
  const text = question.trim().replace(/[？?！!。]+$/, '').replace(/\s+/g, '')
    .replace(/^(?:請問|幫我查一下|幫我查|想知道)/, '');
  const next = text.match(/^(今天)?(?:我的?)?(?:下(?:一)?[堂節](?:課)?|接下來的?課)(.*)$/);
  if (next && /^(?:是?(?:什麼課?|哪(?:一)?(?:堂|門)(?:課)?|什麼時候|在哪(?:裡|一?[間個]教室)?(?:上課)?|幾點(?:開始|上課)?)|要?上什麼(?:課)?|的?教室在哪(?:裡)?|在什麼地方|呢)?$/.test(next[2])) {
    return next[1] ? 'today' : 'next';
  }
  if (!previous) return null;
  const followUp = text.replace(/^(?:所以|那麼)?(?:[這那][堂門](?:課)?|那)?/, '');
  if (/^(?:在哪(?:裡|邊|兒)?(?:上課)?|在哪(?:一)?[間個](?:教室)?(?:上課)?|哪(?:一)?[間個]教室|教室在哪(?:裡)?|上課地點)(?:呢|啊|呀)?$/.test(followUp)) return 'room';
  if (/^(?:幾點(?:開始|上課|下課|結束)?|什麼時候(?:開始|上課|下課|結束)|上課時間)(?:呢|啊|呀)?$/.test(followUp)) return 'time';
  return null;
}

type SavedClassAnswer = {
  tool: 'saved-timetable';
  content: string;
  route?: '/timetable';
  savedClassRead?: SavedClassRead;
};

function sameOccurrence(a: SavedClassOccurrence, b: SavedClassOccurrence) {
  return a.term === b.term && a.courseId === b.courseId && a.date === b.date && a.startTime === b.startTime;
}

export function answerSavedClassQuery(
  query: ClassQuery, context: OnDeviceSchoolContext, uid: string, previous?: SavedClassRead,
): SavedClassAnswer {
  const { timetable, schoolId } = context;
  const fallback = (content: string): SavedClassAnswer => ({
    tool: 'saved-timetable', content, route: '/timetable',
  });
  if (!uid) return fallback('請先登入校園帳號，再從「我的課表」確認這台手機儲存的課程。');
  const classes = timetable.nextClasses;
  if (!classes) return fallback(timetable.source === 'not-available'
    ? '這台手機還沒有可核對的個人課表。請先開啟「我的課表」匯入或儲存課程。'
    : '目前無法從手機課表確認下一堂課。請開啟「我的課表」核對本學期與上課時間。');
  const followUp = query === 'room' || query === 'time';
  if (followUp && (!previous || previous.uid !== uid || previous.schoolId !== schoolId ||
      previous.classes.length !== classes.length ||
      !previous.classes.every((prior) => classes.some((item) => sameOccurrence(prior, item))))) {
    return fallback('手機課表已無法核對剛才那堂課的原時段。可以再問一次「下一堂課是什麼？」查看目前的安排。');
  }
  if (!classes.length) return fallback('這份手機課表在接下來七天沒有已排定、尚未開始的課程。');
  if (query === 'today' && classes[0].date !== classDate(new Date(context.checkedAt))) {
    return fallback('依這份手機課表，今天剩下的時間沒有尚未開始的課程。');
  }
  const content = classes.map((item) =>
    `${item.name}｜${item.date} ${item.startTime}–${item.endTime <= item.startTime ? '隔日 ' : ''}${item.endTime}｜${item.room || '教室未填'}`,
  ).join('\n');
  return {
    tool: 'saved-timetable',
    content,
    savedClassRead: { uid, schoolId, classes, updatedAt: timetable.updatedAt, ...(followUp ? { focus: query } : {}) },
  };
}
