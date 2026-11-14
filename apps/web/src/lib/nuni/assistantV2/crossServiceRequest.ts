import type { AssistantServiceId } from '@campus/shared/src/assistantServices';
import { publicCourseCompoundRequest } from '@campus/shared/src/publicCourseCompound';
import { publicCourseAssistantSource, type PublicCourseAssistantIntent } from '@campus/shared/src/publicCourseAssistant';
import { addDays, date, taipeiDate, type Obj } from './contracts';
import { directReads, type DirectRead } from './directRead';
import { informationReads, type InformationRead } from './information';
import { studyWindow } from './tools';
import { publicCourseArguments } from './publicCourses';

export type CrossServiceOperation = {
  id: string;
  label: string;
  serviceId: AssistantServiceId;
  kind: 'read' | 'study' | 'free-time' | 'materials' | 'clubs' | 'transit' | 'reorder' | 'handoff' | 'public-course';
  tool?: string;
  args: Obj;
  dependsOn: string[];
  directRead?: DirectRead;
  informationRead?: InformationRead;
  question?: string;
  publicCourseIntent?: PublicCourseAssistantIntent;
};
export type CrossServiceRequest = { operations: CrossServiceOperation[] };

const READ_LABELS: Record<DirectRead['kind'], string> = {
  schedule: '核對課表', 'next-class': '查下一堂課', calendar: '核對個人行程', 'due-work': '查待繳作業與測驗',
};
const READ_SERVICES: Record<DirectRead['kind'], AssistantServiceId> = {
  schedule: 'timetable', 'next-class': 'timetable', calendar: 'calendar', 'due-work': 'classroom',
};
const HANDOFFS: readonly [RegExp, AssistantServiceId][] = [
  [/^(?:圖書館|借書|借閱紀錄|還書|館藏|館藏查詢|圖書館開館時間)$/, 'library'], [/^(?:地圖|校園地圖|導航)$/, 'map'],
  [/^(?:校園)?公告$/, 'announcements'], [/^(?:校園活動|活動|活動報名|報名活動)$/, 'events'], [/^(?:宿舍|宿舍服務|宿舍報修|報修)$/, 'dormitory'],
  [/^(?:申請)?請假$/, 'leave'], [/^(?:課程)?申訴$/, 'appeals'], [/^(?:私訊|私人訊息|訊息|傳訊息)$/, 'messages'],
  [/^(?:我的)?通知$/, 'notifications'], [/^(?:校園社群|社群|貼文|發文)$/, 'community'], [/^(?:學分|學分規劃)$/, 'credits'],
  [/^(?:學校資格|綁定學校)$/, 'school-account'], [/^(?:數位)?學生證$/, 'student-card'],
  [/^(?:玩課雲|TronClass|tronclass)(?:作業|課程)?$/, 'school-lms'], [/^(?:失物|失物招領|招領)$/, 'lost-found'],
  [/^好友$/, 'friends'], [/^群組$/, 'groups'], [/^(?:店家|商家)(?:工作區)?$/, 'merchant'],
  [/^(?:助理權限|AI權限)$/, 'assistant-permissions'], [/^設定$/, 'settings'], [/^帳號$/, 'account'],
  [/^(?:學期)?成績$/, 'grades'], [/^(?:點餐|菜單|下單)$/, 'food'],
];

/** A clause retains its own date. An ambiguous date never defaults to today. */
function requestedDay(text: string, now: number): string | undefined | null {
  const explicit = [...text.matchAll(/\d{4}-\d{1,2}-\d{1,2}/g)].map(match => match[0]);
  const offsets = [/今天|今日|今晚|今早/, /明天|明日|明晚|明早/, /後天|後日/]
    .flatMap((pattern, offset) => pattern.test(text) ? [offset] : []);
  if (explicit.length > 1 || offsets.length > 1 || (explicit.length && offsets.length)) return null;
  if (explicit.length) {
    try { return date(explicit[0]); } catch { return null; }
  }
  return offsets.length ? addDays(taipeiDate(now), offsets[0]) : undefined;
}

function genericStudy(clause: string): boolean {
  if (!/(?:安排|規劃|幫我排|幫我留|找).{0,40}(?:讀書|作業|準備|學習|空堂|空檔)/.test(clause)) return false;
  // Named subjects, exact appointments and unspecified changes need the normal
  // planner. Do not silently replace them with the first outstanding assignment.
  const rest = clause.replace(/\d{4}-\d{2}-\d{2}/g, '')
    .replace(/\d{1,2}[:：]\d{2}/g, '')
    .replace(/(?:幫我|替我|請|麻煩|安排|規劃|讀書|作業|準備|學習|時間|時段|找|空堂|空檔|未交|未繳|待繳|到期|截止|最早|優先|這些|上述|各|每份|一份|兩份|三份|四份|\d+份|\d+分鐘|半小時|一小時|兩小時|今天|今日|明天|明日|後天|後日|今晚|今早|明晚|明早|早上|上午|中午|下午|晚上|晚間|從|到|至|在|的|和|與|再|先|我|排|留|用|把|了|一下|\s)/g, '');
  return !rest;
}

function studyOptions(clause: string): Obj | null {
  const durations = [...clause.matchAll(/\d+\s*分鐘|半小時|一小時|兩小時/g)];
  const clocks = [...clause.matchAll(/\d{1,2}[:：]\d{2}/g)];
  const periods = ([
    [/早上|上午|早晨|今早|明早/, '08:00', '12:00'],
    [/中午/, '11:00', '13:00'], [/下午/, '13:00', '18:00'],
    [/晚上|晚間|今晚|今夜|明晚/, '18:00', '22:00'],
  ] as const).filter(([pattern]) => pattern.test(clause));
  if (durations.length > 1 || (clocks.length && clocks.length !== 2) ||
      clocks.some(match => !/^([01]?\d|2[0-3])[:：][0-5]\d$/.test(match[0])) ||
      periods.length > 1) return null;
  const window = studyWindow(clause);
  if (window.from >= window.to) return null;
  if (clocks.length && periods.length && (window.from < periods[0][1] || window.to > periods[0][2])) return null;
  const minutes = clause.match(/(\d+)\s*分鐘/);
  const windowMinutes = clocks.length ? (Number(window.to.slice(0, 2)) * 60 + Number(window.to.slice(3))) -
    (Number(window.from.slice(0, 2)) * 60 + Number(window.from.slice(3))) : undefined;
  const duration = minutes ? Number(minutes[1]) : /半小時/.test(clause) ? 30
    : /兩小時/.test(clause) ? 120 : /一小時/.test(clause) ? 60 : windowMinutes ?? 60;
  if (duration < 15 || duration > 180 || (windowMinutes && duration > windowMinutes)) return null;
  const count = clause.match(/([一兩二三四\d]+)份/);
  const numbers: Record<string, number> = { 一: 1, 兩: 2, 二: 2, 三: 3, 四: 4 };
  const limit = count ? numbers[count[1]] || Number(count[1])
    : (durations.length || clocks.length) && !/各|每份/.test(clause) ? 1 : 4;
  if (!Number.isInteger(limit) || limit < 1 || limit > 4) return null;
  return { minMinutes: duration, taskLimit: limit };
}

const genericPrefix = /^(?:(?:幫我|替我|請問|請|麻煩|我想|我的|我|再|先|查詢|查看|查一下|看一下|看看|查|看|找|核對|今天的|目前的|現在的|最近的)\s*)+/;

/** Bounded, explicit compound requests only. Unconsumed clauses stay on the
 * existing conversational path; a familiar keyword cannot swallow another task.
 */
export function crossServiceRequest(question: string, now: number, schoolId = ''): CrossServiceRequest | null {
  if (!Number.isFinite(new Date(now).getTime()) || !question.trim() || question.length > 1000 ||
      /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(question)) return null;
  const text = question.normalize('NFKC').trim();
  if (/不要|不用|不必|不需要|無須|別幫|先別|不是要|翻譯|這句話|假設|如果|例如|範例|之前|曾經|昨天|前天|剛才|剛剛|每天|每日|每週|每月|自動|持續/.test(text)) return null;
  const split = (value: string) => value.split(/(?:然後|接著|順便|並且|另外|同時|以及|也幫我|再幫我|並幫我|[，,；;。！!？?、和與])+/)
    .map(part => part.trim()).filter(Boolean).map(question => ({ question, publicCourseIntent: null }));
  const compound = publicCourseCompoundRequest(text, schoolId);
  const clauses: { question: string; publicCourseIntent: PublicCourseAssistantIntent | null }[] = compound
    ? compound.clauses.flatMap(clause => clause.publicCourseIntent ? [clause] : split(clause.question))
    : split(text);
  if (!clauses.length || clauses.length > 12) return null;
  // A weekday filter or a quoted course title belongs to its public source,
  // not the private calendar's date or the remaining task grammar.
  if (clauses.some(clause => !clause.publicCourseIntent &&
      /[「」『』“”"'`]|週|周|禮拜|月底|本月|下月|明年|今年/.test(clause.question))) return null;
  const days = clauses.map(clause => clause.publicCourseIntent ? undefined : requestedDay(clause.question, now));
  if (days.includes(null)) return null;
  const inheritedDays = [...new Set(days.filter((day): day is string => typeof day === 'string'))];
  const inheritedDay = inheritedDays.length === 1 ? inheritedDays[0] : taipeiDate(now);
  const requested: CrossServiceOperation[] = [];
  const add = (operation: Omit<CrossServiceOperation, 'id' | 'dependsOn'>) =>
    requested.push({ ...operation, id: 'task-' + (requested.length + 1), dependsOn: [] });
  for (let index = 0; index < clauses.length; index++) {
    const publicCourseIntent = clauses[index].publicCourseIntent;
    if (publicCourseIntent) {
      const source = publicCourseIntent.kind === 'search' ? publicCourseAssistantSource(publicCourseIntent) : null;
      add({ kind: 'public-course', serviceId: 'school-courses',
        label: source ? `查${source.schoolName}公開課程` : '核對公開課程查詢條件',
        args: publicCourseIntent.kind === 'search' ? publicCourseArguments(publicCourseIntent) : {}, publicCourseIntent });
      continue;
    }
    const clause = clauses[index].question.replace(/^先(?=查|看|幫我)/, '');
    const readClause = /^(?:個人行程|個人行事曆|行事曆|課表|未交作業|待繳作業|作業|測驗)$/.test(clause)
      ? '查' + clause : clause;
    const reads = directReads(readClause, now);
    if (reads.length) {
      for (const read of reads) {
        if (!days[index] && inheritedDays.length > 1 && ['schedule', 'calendar'].includes(read.kind) &&
            !/目前|現在|下一堂|下堂|最近/.test(clause)) return null;
        if (!days[index] && inheritedDays.length === 1 && ['schedule', 'calendar'].includes(read.kind) &&
            !/目前|現在|下一堂|下堂|最近/.test(clause)) read.args = { from: inheritedDay, to: inheritedDay };
        add({ kind: 'read', label: READ_LABELS[read.kind], serviceId: READ_SERVICES[read.kind],
          tool: read.tool, args: read.args, directRead: read });
      }
      continue;
    }
    const information = informationReads(clause, now);
    if (information.length) {
      for (const read of information) {
        if (!days[index] && inheritedDays.length === 1 && read.kind === 'schedule' && !read.view &&
            !/目前|現在|最近/.test(clause)) read.args = { from: inheritedDay, to: inheritedDay };
        add({ kind: 'read', label: read.kind === 'orders' ? '查訂單進度' : read.kind === 'work' ? '查課程待辦' : '核對課表',
          serviceId: read.kind === 'orders' ? 'orders' : read.kind === 'work' ? 'classroom' : 'timetable',
          tool: read.name, args: read.args, informationRead: read });
      }
      continue;
    }
    if (genericStudy(clause)) {
      const options = studyOptions(clause);
      if (!options || (!days[index] && inheritedDays.length > 1)) return null;
      const findOnly = !/安排|規劃|幫我排|幫我留/.test(clause);
      add({ kind: findOnly ? 'free-time' : 'study', label: findOnly ? '找可用的讀書時段' : '安排作業準備時間', serviceId: 'calendar',
        args: { ...options, ...studyWindow(clause), date: days[index] || inheritedDay }, question: clause });
      continue;
    }
    const short = clause.replace(genericPrefix, '').replace(/(?:一下|有哪些|有什麼|在哪裡|資訊|資料|嗎|呢)$/g, '').trim();
    if (/^(?:午餐|晚餐|早餐|校園餐廳|餐廳|吃什麼|哪裡吃飯)$/.test(short)) {
      add({ kind: 'read', label: '查校園餐廳', serviceId: 'cafeteria', tool: 'get_dining', args: {} }); continue;
    }
    if (/^(?:公車|交通|公車到站|公車站牌|公車站點|到站資訊|公車到站資訊)$/.test(short)) {
      add({ kind: 'transit', label: '查公車資訊', serviceId: 'bus', args: { action: 'campus' } }); continue;
    }
    if (/^(?:社團|社團目錄|社團動態|已加入的社團)$/.test(short)) {
      add({ kind: 'clubs', label: /動態/.test(short) ? '查社團動態' : '查社團', serviceId: 'clubs',
        args: { membership: /目錄/.test(short) ? 'all' : 'joined', feed: /動態/.test(short) } }); continue;
    }
    if (/^(?:相關|對應|這些作業的|作業相關的)?教材$/.test(short)) {
      add({ kind: 'materials', label: '找課程教材', serviceId: 'classroom', args: {}, question: clause }); continue;
    }
    if (/^(?:再點|幫我再點|點)(?:一次)?(?:上次|跟上次)(?:一樣|相同)的?(?:餐點|午餐|晚餐|早餐)?$/.test(clause) ||
        /^(?:上次|跟上次)一樣的?(?:餐點|午餐|晚餐|早餐)$/.test(short)) {
      add({ kind: 'reorder', label: '準備上次的餐點', serviceId: 'food', args: {}, question: clause }); continue;
    }
    if (/^(?:我)?(?:匯入|保存|儲存)的?(?:成績|學分)(?:紀錄)?$/.test(short)) {
      add({ kind: 'read', label: '核對匯入的學業紀錄', serviceId: 'import', tool: 'get_imported_academics', args: {} }); continue;
    }
    const handoffClause = short.replace(/^(?:開啟|打開|前往|進入)/, '');
    const handoffs = HANDOFFS.filter(([pattern]) => pattern.test(handoffClause));
    // An unsupported service operation remains a visible handoff, never a
    // completed task. Ambiguous multi-service clauses remain conversational.
    const services = [...new Set(handoffs.map(([, service]) => service))];
    if (services.length !== 1) return null;
    add({ kind: 'handoff', label: '', serviceId: services[0], args: {} });
  }
  if (requested.length < 2 || requested.length > 12 ||
      new Set(requested.map(op => op.kind === 'public-course' ? op.kind + ':' + JSON.stringify(op.args)
        : op.kind === 'read' ? op.tool : op.kind + ':' + op.serviceId)).size < 2) return null;
  const operations: CrossServiceOperation[] = [];
  let serial = requested.length;
  const prerequisite = (tool: string, args: Obj, label: string, serviceId: AssistantServiceId) => {
    const previous = operations.find(op => op.tool === tool && JSON.stringify(op.args) === JSON.stringify(args));
    if (previous) return previous;
    const operation: CrossServiceOperation = { id: 'task-' + (++serial), kind: 'read', tool, args, label, serviceId, dependsOn: [] };
    operations.push(operation);
    return operation;
  };
  for (const operation of requested) {
    if (operation.kind === 'study' || operation.kind === 'free-time') {
      const day = String(operation.args.date);
      const schedule = prerequisite('get_schedule', { from: day, to: day }, '核對安排當日課表', 'timetable');
      const calendar = prerequisite('get_calendar', { from: day, to: day }, '核對安排當日行程', 'calendar');
      if (operation.kind === 'free-time') {
        delete operation.args.taskLimit;
        operation.dependsOn = [schedule.id, calendar.id];
        operations.push(operation);
        continue;
      }
      let work = operations.filter(op => op.tool === 'get_due_work');
      if (!work.length) work = [prerequisite('get_due_work', { from: taipeiDate(now), to: addDays(day, 6) }, '查待繳作業與測驗', 'classroom')];
      const free: CrossServiceOperation = { id: 'task-' + (++serial), kind: 'free-time', label: '找可用的讀書時段',
        serviceId: 'calendar', args: { date: day, from: operation.args.from, to: operation.args.to,
          minMinutes: operation.args.minMinutes }, question: operation.question, dependsOn: [schedule.id, calendar.id] };
      operations.push(free);
      operation.dependsOn = [...work.map(op => op.id), free.id];
    }
    if (operation.kind === 'materials') {
      operation.dependsOn = operations.filter(op => op.tool === 'get_due_work').map(op => op.id);
      if (!operation.dependsOn.length && /相關|對應|這些/.test(operation.question || ''))
        operation.dependsOn = operations.filter(op => op.kind === 'public-course').map(op => op.id);
    }
    operations.push(operation);
  }
  return operations.length <= 16 ? { operations } : null;
}
