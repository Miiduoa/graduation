import { classDate } from '@campus/shared/src/timetable/classExceptions';
import type { OnDeviceSchoolContext, SavedClassOccurrence } from './onDeviceSchoolContext';

export type SavedClassRead = {
  uid: string;
  owner?: string;
  schoolId: string;
  classes: SavedClassOccurrence[];
  updatedAt: string | null;
  focus?: 'room' | 'time';
  currentAt?: string;
};

type ClassQuery = {
  window: 'current' | 'next' | 'today';
  focus?: SavedClassRead['focus'];
  followUp?: boolean;
};

export function savedClassQuery(question: string, previous?: SavedClassRead): ClassQuery | null {
  const text = question.trim().replace(/[？?！!。]+$/, '').replace(/\s+/g, '')
    .replace(/^(?:請問|幫我查一下|幫我查|想知道)/, '');
  const current = text.replace(/^(?:今天)?我?/, '');
  if (/^(?:現在|目前|這個時段|這一?節(?:課)?)(?:我)?(?:有(?:沒有)?(?:要上|在上|上)?課|(?:要|在|正在)?上課(?:了)?|(?:是|有|要上|在上|正在上|上)?(?:什麼課|哪(?:一)?(?:堂|門|節)課))(?:嗎|呢|啊)?$/.test(current) ||
      /^正在上(?:什麼課|哪(?:一)?(?:堂|門|節)課)(?:呢)?$/.test(current)) return { window: 'current' };
  const next = text.match(/^(今天)?(?:我的?)?(?:下(?:一)?[堂節](?:課)?|接下來的?課)(.*)$/);
  if (next && /^(?:是?(?:什麼課?|哪(?:一)?(?:堂|門)(?:課)?|什麼時候|在哪(?:裡|一?[間個]教室)?(?:上課)?|幾點(?:開始|上課)?)|要?上什麼(?:課)?|的?教室在哪(?:裡)?|在什麼地方|呢)?$/.test(next[2])) {
    return { window: next[1] ? 'today' : 'next' };
  }
  // A time word alone does not turn a question about the student's location into a timetable lookup.
  const explicitCurrent = /^我?(?:現在|目前)的?(?:這一?[堂節門](?:課)?|上的課|課程|課|(?=在哪(?:裡|邊|[間個]教室)?上課|幾點(?:下課|上課)))/;
  const detail = text.replace(explicitCurrent, '').replace(/^(?:所以|那麼)?(?:[這那]一?[堂節門](?:課)?|那)?的?/, '');
  const currentDetail = explicitCurrent.test(text) || (!previous?.classes.length && /^這一?[堂節](?:課)?/.test(text));
  if (!currentDetail && !previous?.classes.length) return null;
  const window = currentDetail || previous?.currentAt ? 'current' : 'next';
  if (/^(?:在哪(?:裡|邊|兒)?(?:上課)?|在哪(?:一)?[間個](?:教室)?(?:上課)?|哪(?:一)?[間個]教室|教室在哪(?:裡)?|上課地點)(?:呢|啊|呀)?$/.test(detail)) {
    return { window, focus: 'room', followUp: !currentDetail };
  }
  if (/^(?:幾點(?:開始|上課|下課|結束)?|什麼時候(?:開始|上課|下課|結束)|上課時間)(?:呢|啊|呀)?$/.test(detail)) {
    return { window, focus: 'time', followUp: !currentDetail };
  }
  return null;
}

type SavedClassAnswer = {
  tool: 'saved-timetable';
  content: string;
  route?: '/timetable' | '/timetable/import';
  savedClassRead?: SavedClassRead;
};

function sameOccurrence(a: SavedClassOccurrence, b: SavedClassOccurrence) {
  return a.term === b.term && a.courseId === b.courseId && a.date === b.date && a.startTime === b.startTime;
}

export function answerSavedClassQuery(
  query: ClassQuery, context: OnDeviceSchoolContext, uid: string, previous?: SavedClassRead, owner?: string,
): SavedClassAnswer {
  const { timetable, schoolId } = context;
  const fallback = (content: string): SavedClassAnswer => ({
    tool: 'saved-timetable', content, route: '/timetable',
  });
  if (!uid && !owner) return fallback('請先登入校園帳號，再從「我的課表」確認這台手機儲存的課程。');
  const current = query.window === 'current';
  const classes = current ? timetable.currentClasses : timetable.nextClasses;
  if (owner && timetable.source === 'not-available') {
    return { tool: 'saved-timetable', route: '/timetable/import', content: '這個 nuni 帳號在這台手機還沒有可核對的課表。匯入本學期的課表後，就能查時間和教室。' };
  }
  if (timetable.source === 'unreadable') return fallback('這台手機暫時讀不到已存的課表。請開啟「我的課表」重新讀取。');
  if (!classes) return fallback(timetable.source === 'not-available'
    ? '這台手機還沒有可核對的個人課表。請先開啟「我的課表」匯入或儲存課程。'
    : `手機課表的資料不足，無法確認${current ? '這個時段的課程' : '下一堂課'}。請開啟「我的課表」核對學期與上課時間。`);
  if (query.followUp && (!previous || previous.uid !== uid || previous.owner !== owner || previous.schoolId !== schoolId ||
      previous.classes.length !== classes.length ||
      !previous.classes.every((prior) => classes.some((item) => sameOccurrence(prior, item))))) {
    return fallback(`手機課表已無法核對剛才那堂課的原時段。可以再問一次「${current ? '我現在有課嗎？' : '下一堂課是什麼？'}」查看目前的安排。`);
  }
  const savedClassRead: SavedClassRead = {
    uid, ...(owner && { owner }), schoolId, classes, updatedAt: timetable.updatedAt,
    ...(classes.length && query.focus ? { focus: query.focus } : {}), ...(current ? { currentAt: context.checkedAt } : {}),
  };
  if (!classes.length) {
    if (current) return { ...fallback('依這份手機課表，這個時段沒有排課。'), savedClassRead };
    return fallback('這份手機課表在接下來七天沒有已排定、尚未開始的課程。');
  }
  if (query.window === 'today' && classes[0].date !== classDate(new Date(context.checkedAt))) {
    return fallback('依這份手機課表，今天剩下的時間沒有尚未開始的課程。');
  }
  const content = classes.map((item) =>
    `${item.name}｜${item.date} ${item.startTime}–${item.endTime <= item.startTime ? '隔日 ' : ''}${item.endTime}｜${item.room || '教室未填'}`,
  ).join('\n');
  return {
    tool: 'saved-timetable',
    content,
    savedClassRead,
  };
}
