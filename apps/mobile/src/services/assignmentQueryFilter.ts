import { stripAssignmentDeadlinePeriods } from './assignmentDeadlineWindow';

type AssignmentName = { groupName: string; title: string };

function normalize(value: string) {
  return value.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}

// These words describe the request. To find a saved title such as 「作業」, quote it.
const GENERIC = /^(?:的|還|要|作業|功課|課程|待辦|截止|待交作業|全部|所有|各科|各門課|各科目|哪些|什麼|未交|待交|已逾期|逾期)$/;
const DEADLINE = /(?:什麼時候|何時|幾點|哪天|哪一天|何日)(?:[要得需]?繳?交|到期|截止)?/;

function courseName(prefix: string) {
  const name = prefix.trim();
  // 「還沒交的作業」 has a status qualifier, not a course named 還沒交.
  if (name && !GENERIC.test(name) &&
      !/(?:\d+[年月日天]|\d+[/.-]\d+|期限|時間|截止|逾期|過期|未交|待交|待繳|要交|要繳|繳交|還沒|沒有|哪些|多少|幾份|什麼|所有|全部|最近|近期|目前|未完成|沒交)/.test(name)) return name;
}

function nameAt(text: string, name: string, offset: number) {
  // HW1 must not select HW10; Chinese names need no word separator.
  return text.startsWith(name, offset) &&
    !(/[a-z0-9]/.test(text.charAt(offset - 1)) && /^[a-z0-9]/.test(name)) &&
    !(/[a-z0-9]$/.test(name) && /[a-z0-9]/.test(text.charAt(offset + name.length)));
}

/** Scope only an already-authorized snapshot. Preserve source rows and same-title matches. */
export function filterAssignmentQuery<T extends AssignmentName>(question: string, items: readonly T[]): {
  scope: string | null; items: readonly T[];
} {
  const terms = new Set<string>();
  const unquoted = normalize(question).replace(/「([^」]+)」|『([^』]+)』|“([^”]+)”|"([^"]+)"/g,
    (_match, a, b, c, d) => { terms.add((a || b || c || d).trim()); return '「」'; });
  let rest = stripAssignmentDeadlinePeriods(unquoted).trim()
    .replace(/^(?:(?:請問|請|幫我|麻煩|我想|我要|查詢|查一下|查看|查|看看|看|列出|關於|我的?|找|那)\s*)+/, '');
  const groups = new Set(items.map((row) => normalize(row.groupName)));
  const titles = new Set(items.map((row) => normalize(row.title)));
  // In 「資料庫的期中報告什麼時候交」 the left and right sides constrain different fields.
  // Never let a missing course fall through to every other course with that report title.
  const dueQuestion = rest.match(DEADLINE);
  const introduction = dueQuestion ? rest.slice(0, dueQuestion.index).trim() : '';
  const marker = !titles.has(introduction) && rest.match(/^([^的，。！？?「」]{1,120}?)(?:這門課|這一科|的|(?:還有|有)(?:哪些|什麼)(?=作業|功課))/);
  const course = marker && courseName(marker[1]);
  let courseMatches: string[] | undefined;
  if (course && marker) {
    const requested = groups.has(course) ? [course] : course.split(/[和與、]/).map((part) => part.trim());
    courseMatches = [];
    for (const part of requested) {
      // Prefer the official name. A shorthand with no exact match may name multiple courses.
      const found = groups.has(part) ? [part] : [...groups].filter((group) =>
        part.length >= 2 && group.startsWith(part) && nameAt(group, part, 0));
      if (!found.length) return { scope: course, items: [] };
      courseMatches.push(...found);
    }
    rest = rest.slice(marker[0].length).replace(/^的/, '').trim();
  }
  if (dueQuestion) {
    const title = rest.split(DEADLINE, 1)[0].trim();
    if (title && !title.includes('「') && (titles.has(title) || courseName(title)) && !GENERIC.test(title)) terms.add(title);
  }
  const names = [...new Set([...groups, ...titles])].filter((name) => name.length >= 2 && !GENERIC.test(name))
    .sort((a, b) => b.length - a.length);
  for (let i = 0; i < rest.length; i++) {
    const name = names.find((candidate) => nameAt(rest, candidate, i));
    if (name) { terms.add(name); i += name.length - 1; }
  }
  if (!terms.size && !courseMatches) return { items, scope: null };
  const selected = [...terms];
  const scope = [...(course ? [course] : []), ...selected].join('、');
  if (selected.some((term) => !groups.has(term) && !titles.has(term))) return { scope, items: [] };
  const courses = selected.filter((term) => groups.has(term) && !titles.has(term));
  const assignments = selected.filter((term) => titles.has(term) && !groups.has(term));
  const ambiguous = selected.filter((term) => groups.has(term) && titles.has(term));
  return { scope, items: items.filter((row) => {
    const group = normalize(row.groupName), title = normalize(row.title);
    return (!courseMatches || courseMatches.includes(group)) && (!courses.length || courses.includes(group)) &&
      (!assignments.length || assignments.includes(title)) &&
      (!ambiguous.length || ambiguous.includes(group) || ambiguous.includes(title));
  }) };
}
