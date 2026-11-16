import { parseAssistantCalendarEvent } from '@campus/shared/src/assistantExecution';

export type AssistantCampusEventSource = 'school-club-events' | 'school-events' | 'legacy-events';
/** Display metadata is a selection hint. The server re-reads this exact source. */
export type AssistantCampusEventTarget = {
  schoolId: string;
  source: AssistantCampusEventSource;
  id: string;
  title: string;
  startsAt: string;
  endsAt?: string;
  href: string;
  checkedAt: string;
  location?: string;
};

export type CampusEventChoice =
  | { kind: 'index'; index: number }
  | { kind: 'single' }
  | { kind: 'title'; title: string };
export type CampusEventCommand =
  | { kind: 'discover'; index: number }
  | { kind: 'followup'; selection: CampusEventChoice; explicitActivity: boolean };

/** A complete, bounded instruction only. Unsupported filters, edits and extra
 * tasks cannot silently become a recent-feed query or an unrelated event. */
export function parseCampusEventCommand(question: string): CampusEventCommand | null {
  if (typeof question !== 'string' || !question.trim() || question.length > 360 ||
    /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(question)) return null;
  const value = question.normalize('NFKC').trim().replace(/[。!！?？]+$/, '').trim();
  const prefix = '(?:(?:請|麻煩(?:你)?|幫我|替我|我想)\\s*)*';
  const destination = '(?:我的|個人|我的個人)?(?:行事曆|行程|日曆)';
  const add = `(?:加入|加到|加進|放進|放到)\\s*${destination}`;
  const ordinal = '(十二|十一|十|一|二|兩|三|四|五|六|七|八|九|1[0-2]|[1-9])';
  const numerals: Record<string, number> = { 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5,
    六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 十一: 11, 十二: 12 };
  const number = (raw: string): number => numerals[raw] || Number(raw);
  const followup = (text: string): Extract<CampusEventCommand, { kind: 'followup' }> | null => {
    const outer = text.match(new RegExp(`^${prefix}(?:把|將)?\\s*(.+?)\\s*${add}$`));
    if (!outer) return null;
    const selected = outer[1].trim();
    const indexed = selected.match(new RegExp(`^(?:(?:上面|上方|剛才|剛剛)(?:的)?\\s*)?第\\s*${ordinal}\\s*(?:個|筆|場|項)(?:活動)?$`));
    if (indexed) return { kind: 'followup', selection: { kind: 'index', index: number(indexed[1]) },
      explicitActivity: /活動$/.test(selected) };
    if (/^(?:(?:上面|上方|剛才|剛剛)(?:的)?)?(?:那個|這個|那筆|這筆|那場|這場)(?:活動)?$/.test(selected))
      return { kind: 'followup', selection: { kind: 'single' }, explicitActivity: /活動$/.test(selected) };
    const named = selected.match(/^(?:活動)?(?:「([^「」]+)」|『([^『』]+)』|"([^\"]+)")(?:活動)?$/);
    const title = named?.[1] || named?.[2] || named?.[3];
    if (title && title.trim() === title && title.length <= 160)
      return { kind: 'followup', selection: { kind: 'title', title },
        explicitActivity: /^(?:活動)/.test(selected) || /活動$/.test(selected) };
    return null;
  };
  // Only a generic current feed may be selected by a new ordinal lookup.
  // Named schools, dates, registration and arbitrary query fragments stay out.
  const discovery = value.match(new RegExp(`^${prefix}(?:查詢|查看|查一下|看一下|看看|查|看|列出)\\s*(?:(?:目前|最近|最新|近期)(?:的)?\\s*)?(?:(?:校園|學校|公開)\\s*)?活動\\s*(?:[,，、;；]\\s*)?(?:並且|然後|接著|並|再|順便)\\s*(.+)$`));
  if (discovery) {
    const choice = followup(discovery[1]);
    return choice?.selection.kind === 'index' && choice.selection.index <= 5
      ? { kind: 'discover', index: choice.selection.index } : null;
  }
  return followup(value);
}

/** Selection is relative to displayed source rows, never the prose excerpt. */
export function selectCampusEventTarget(targets: AssistantCampusEventTarget[], choice: CampusEventChoice):
  { target: AssistantCampusEventTarget } | { message: string } {
  if (!targets.length) return { message: '目前沒有可承接的活動清單。請先查近期活動，或重新選擇活動來源。' };
  if (choice.kind === 'index') {
    const target = targets[choice.index - 1];
    return target ? { target } : { message: `這份清單只有 ${targets.length} 筆活動，沒有第 ${choice.index} 筆。請從下方選擇要加入的活動。` };
  }
  const selected = choice.kind === 'single' ? targets
    : targets.filter(target => target.title.normalize('NFKC') === choice.title);
  if (selected.length === 1) return { target: selected[0] };
  return { message: choice.kind === 'title' && !selected.length
    ? '目前清單中沒有完全符合這個名稱的活動。請從下方選擇；不會改用相似名稱。'
    : '目前有多筆可能的活動，請從下方選擇一筆，或指定第幾筆；尚未建立行程。' };
}

const fields = ['schoolId', 'source', 'id', 'title', 'startsAt', 'endsAt', 'href', 'checkedAt', 'location'];
const required = fields.filter(field => field !== 'endsAt' && field !== 'location');
const plain = (value: unknown, max: number): value is string => typeof value === 'string' &&
  value.length > 0 && value.length <= max && value.trim() === value && !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value);
const instant = (value: unknown): value is string => typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;

function dataObject(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const prototype = Object.getPrototypeOf(raw);
  if (prototype !== null && prototype !== Object.prototype) return null;
  const descriptors = Object.getOwnPropertyDescriptors(raw);
  const copy: Record<string, unknown> = Object.create(null);
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== 'string' || !fields.includes(key)) return null;
    const descriptor = descriptors[key];
    if (!descriptor.enumerable || !('value' in descriptor) || descriptor.value === undefined) return null;
    copy[key] = descriptor.value;
  }
  return required.every(key => Object.hasOwn(copy, key)) ? copy : null;
}

export function campusEventIdentity(target: AssistantCampusEventTarget) {
  return { schoolId: target.schoolId, source: target.source, id: target.id };
}

export function campusEventTargetKey(target: AssistantCampusEventTarget): string {
  return JSON.stringify([target.schoolId, target.source, target.id]);
}

/** Accept the entire bounded list or none. Never invoke response getters or use a supplied arbitrary URL. */
export function parseAssistantCampusEventTargets(raw: unknown, schoolId?: string): AssistantCampusEventTarget[] {
  try {
    if (!Array.isArray(raw) || Object.getPrototypeOf(raw) !== Array.prototype || raw.length > 12) return [];
    const descriptors = Object.getOwnPropertyDescriptors(raw);
    if (Reflect.ownKeys(descriptors).length !== raw.length + 1) return [];
    const result: AssistantCampusEventTarget[] = [], seen = new Set<string>();
    for (let index = 0; index < raw.length; index++) {
      const descriptor = descriptors[String(index)];
      if (!descriptor?.enumerable || !('value' in descriptor)) return [];
      const item = dataObject(descriptor.value);
      if (!item || typeof item.schoolId !== 'string' || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(item.schoolId) ||
        item.schoolId === 'personal' || (schoolId !== undefined && item.schoolId !== schoolId) ||
        typeof item.source !== 'string' || !['school-club-events', 'school-events', 'legacy-events'].includes(item.source) ||
        !plain(item.id, 200) || item.id.includes('/') || ['.', '..', '__proto__', 'prototype', 'constructor'].includes(item.id) ||
        !plain(item.title, 160) || !instant(item.startsAt) || !instant(item.checkedAt) ||
        (item.endsAt !== undefined && !instant(item.endsAt)) ||
        (item.location !== undefined && !plain(item.location, 120))) return [];
      const source = item.source as AssistantCampusEventSource;
      const href = `/events/${encodeURIComponent(item.id)}?${new URLSearchParams({ schoolId: item.schoolId, source })}`;
      if (item.href !== href) return [];
      const target: AssistantCampusEventTarget = { schoolId: item.schoolId, source, id: item.id,
        title: item.title, startsAt: item.startsAt, checkedAt: item.checkedAt, href,
        ...(item.endsAt !== undefined ? { endsAt: item.endsAt as string } : {}),
        ...(item.location !== undefined ? { location: item.location as string } : {}) };
      const key = campusEventTargetKey(target);
      if (seen.has(key)) return [];
      seen.add(key);
      result.push(target);
    }
    return result;
  } catch { return []; }
}

/** Eligibility only; the server independently validates the current source before issuing a card. */
export function campusEventPreviewIssue(target: AssistantCampusEventTarget, now: number): string | null {
  const start = Date.parse(target.startsAt), end = Date.parse(target.endsAt ?? '');
  if (!target.endsAt) return '來源沒有完整的結束時間，請先查看活動來源；不會猜測活動長度。';
  if (!Number.isFinite(now) || !Number.isFinite(start) || !Number.isFinite(end) || end <= start)
    return '活動起訖時間尚無法完整核對，請先查看活動來源。';
  if (start <= now) return '這個活動已開始，請重新查詢近期活動。';
  if (start % 60_000 || end % 60_000 || target.title.length > 120)
    return '這份活動的時間精度或名稱超出目前行程支援範圍，請從來源核對後手動建立。';
  try {
    const localStart = new Date(start + 28_800_000).toISOString(), localEnd = new Date(end + 28_800_000).toISOString();
    const date = localStart.slice(0, 10), endDate = localEnd.slice(0, 10);
    if (Date.parse(endDate) - Date.parse(date) > 31 * 86_400_000) throw new Error('Unsupported span');
    parseAssistantCalendarEvent({ title: target.title, date, allDay: false,
      startTime: localStart.slice(11, 16), endTime: localEnd.slice(11, 16),
      ...(endDate !== date ? { endDate } : {}) });
  } catch {
    return '活動日期超出目前行程支援範圍，請從來源核對後手動建立。';
  }
  return null;
}
