import {
  formatPublicCatalogFetchedAt,
  isPublicCourseCatalog,
  type PublicCatalogCourse,
} from './publicCourseCatalog';
import {
  isPublicCourseOperationQuery,
  resolvePublicCourseOperation,
  type PublicCourseOperationSchoolId,
} from './publicCourseOperations';
import { mockSchools } from './schools';
import { extractPublicCourseAssistantFilters } from './publicCourseAssistantFilters';
import { splitPublicCourseClauses } from './publicCourseClauses';
import {
  hasPublicCourseFilters,
  parsePublicCourseFilters,
  publicCourseFilterLabel,
  publicCourseWeekdays,
  type PublicCourseFilters,
} from './publicCourseFilters';

export type PublicCourseAssistantSearch = {
  kind: 'search';
  schoolId: PublicCourseOperationSchoolId;
  query: string;
  filters?: PublicCourseFilters;
};
export type PublicCourseAssistantIntent =
  | PublicCourseAssistantSearch
  | {
      kind: 'clarify';
      content: string;
    };

type ReadSource = {
  schoolId: PublicCourseOperationSchoolId;
  schoolName: string;
  query: string;
  filters?: PublicCourseFilters;
  href: string;
  sourceUrl: string;
};
export type PublicCourseAssistantRead = ReadSource &
  (
    | {
        status: 'ready';
        fetchedAt?: string;
        matchCount: number;
        truncated: boolean;
        courses: PublicCatalogCourse[];
        unresolvedCount?: number;
      }
    | { status: 'unavailable' }
  );
export type PublicCourseAssistantAnswer = { content: string; read?: PublicCourseAssistantRead };

const schools = [
  {
    id: 'nthu',
    name: '國立清華大學',
    aliases: ['國立清華大學', '清華大學', '清大', '清華', 'NTHU'],
  },
  {
    id: 'ncnu',
    name: '國立暨南國際大學',
    aliases: ['國立暨南國際大學', '暨南國際大學', '暨南大學', '暨大', '暨南', 'NCNU'],
  },
] as const;
const clarify = (content: string): PublicCourseAssistantIntent => ({ kind: 'clarify', content });
const queryHelp = '請提供一個課名、課號、系所或老師姓名，例如「幫我找清大的資料庫課程」。';
const otherSchoolNames = mockSchools
  .filter(
    (school) =>
      school.id !== 'nthu' && !school.id.includes('demo') && !school.name.includes('示範'),
  )
  .flatMap((school) => [
    school.name,
    school.name.replace(/^(國立|市立|私立)/, ''),
    school.shortName,
    school.code,
    ...(school.aliases ?? []),
  ])
  .filter((name): name is string => !!name && name.length > 1);

function startsWithOtherSchool(text: string): boolean {
  return otherSchoolNames.some((name) => {
    if (!text.toLowerCase().startsWith(name.toLowerCase())) return false;
    return !/^[A-Za-z]+$/.test(name) || !/^[A-Za-z]/.test(text.slice(name.length));
  });
}

function takeSchool(text: string) {
  for (const school of schools) {
    for (const alias of school.aliases) {
      if (!text.toLowerCase().startsWith(alias.toLowerCase())) continue;
      if (/^[A-Z]+$/.test(alias) && /^[A-Za-z]/.test(text.slice(alias.length))) continue;
      return { schoolId: school.id, rest: text.slice(alias.length).trim() };
    }
  }
  return null;
}

/** Only complete public lookup requests are handled here; private coursework stays on its existing path. */
export function resolvePublicCourseAssistantIntent(
  question: string,
  selectedSchoolId?: string | null,
): PublicCourseAssistantIntent | null {
  if (typeof question !== 'string' || !question.trim() || question.length > 2000) return null;
  let text = question
    .normalize('NFKC')
    .trim()
    .replace(/[?？!！。]+$/, '')
    .trim();
  const requestWords = text
    .replace(/[「『“"][^「」『』“”"]*[」』”"]/g, '')
    .replace(/我的學校/g, '本校');
  if (
    /^(?:請|幫我|麻煩)?\s*(?:翻譯|解釋|改寫|分析|朗讀)|這句話|不要(?:查|找|搜尋)|不用(?:查|找|搜尋)|別(?:查|找|搜尋)|先別|\b(?:translate|explain)\b/i.test(
      text,
    )
  )
    return null;
  if (
    /我的|本人|我(?:今天|明天|後天|這週|本週|下週|已選|已修|修|選了|這學期|本學期|上學期|下學期)|已(?:選|修)|修過|所選|選上的|下一堂|下堂課|目前這堂|課表|這堂課|期中考|期末考|考試時間|考試日期|(?:課程|課堂)(?:的)?(?:作業(?!系統)|教材|考試|測驗|報告|筆記|成績)|作業(?:$|截止|期限|繳交|內容)|功課|\b(?:my|timetable|homework|next class)\b/i.test(
      requestWords,
    )
  )
    return null;
  text = text.replace(
    /^(?:(?:請問|請|幫我|替我|麻煩你?|我想要?|想要?|可以幫我|能不能幫我|能幫我)\s*)+/,
    '',
  );
  const command =
    /^(?:查詢|查一下|查課|查|找一下|找|搜尋|搜索|列出|看看|看一下|search\s+(?:for\s+)?|find\s+|list\s+)/i;
  const hadCommand = command.test(text);
  text = text
    .replace(command, '')
    .replace(/^[:：]\s*/, '')
    .trim();
  let explicit = takeSchool(text.replace(/^在\s*/, ''));
  if (explicit) text = explicit.rest;
  else {
    const suffix = text.match(
      /^(.*?)[(,]\s*((?:國立)?(?:清華大學|暨南國際大學)|清大|清華|暨大|暨南(?:大學)?|NTHU|NCNU)(?:的)?\s*\)?$/i,
    );
    if (suffix) {
      explicit = takeSchool(suffix[2]);
      text = suffix[1].trim();
    }
  }
  const hasCourseWord = /課程|開課|課號|課名|查課|學分|的課|課[?？!！。]*$|courses?\b/i.test(
    question,
  );
  // A school name alone does not turn a library, dining or other service question into a course lookup.
  if (
    !hasCourseWord &&
    /圖書館|餐廳|食堂|宿舍|公車|公告|活動|地址|電話|成績|學費|放假|申請|招生|在哪|哪裡|哪裏|何時|什麼時候|有什麼|有哪些|怎麼|如何|為什麼/.test(
      requestWords,
    )
  )
    return null;

  if ((explicit || hasCourseWord) && (splitPublicCourseClauses(question)?.length ?? 0) > 1)
    return clarify('這句包含多項需求，不能合併成一個課程關鍵字。此公開課程查詢一次處理一個條件；其他需求尚未執行。');

  // An explicit second campus cannot be silently folded into one school's keyword.
  const outsideQuotes = text
    .replace(/[「『“"][^「」『』“”"]*[」』”"]/g, '')
    .replace(/^的\s*/, '')
    .replace(/^(?:有沒有|有哪些|有什麼|是否有)\s*/, '')
    // A filter prefix before 大學英文 is not the name of another university.
    .replace(
      /^(?:(?:星期|禮拜|週|周)\s*[一二三四五六日天1-7](?:\s*(?:有課|上課))?\s*|(?:\d+(?:\.\d+)?|[零〇一二兩三四五六七八九十百點]+)\s*(?:個)?學分\s*|的\s*|在\s*|[、,\s])+/,
      '',
    );
  const mentionsAnotherSchool = schools.some((school) =>
    school.aliases.some((alias) =>
      /^[A-Z]+$/.test(alias)
        ? new RegExp('\\b' + alias + '\\b', 'i').test(outsideQuotes)
        : outsideQuotes.includes(alias),
    ),
  );
  const otherSchoolWords =
    /(?:台大|臺大|政大|成大|中興大學|中山大學|陽交大|交大|台科大|臺科大|北科大|靜宜|\bNTU\b|\bNCKU\b|\bNCHU\b|\bNYCU\b|\bPU\b)|[^\s「」『』"']{1,16}(?:科技大學|大學|科大|學院)/i;
  if (
    explicit &&
    (mentionsAnotherSchool ||
      otherSchoolWords.test(outsideQuotes) ||
      /^(?:的)?\s*(?:和|跟|與|以及|、|或|and\b)/i.test(text))
  ) {
    return clarify('請一次指定一所學校，例如「查清大資料庫課程」，或「查暨大資料庫課程」。');
  }
  const unsupported =
    !explicit &&
    (startsWithOtherSchool(text) ||
      text.match(
        /^(?:國立|市立|私立)?[^\s「」『』"']{1,16}(?:科技大學|大學|科大|學院)|^(?:台大|臺大|政大|成大|中興|中山|陽交大|交大|台科大|臺科大|北科大|靜宜|NTU\b|NCKU\b|NCHU\b|NYCU\b|PU\b)/i,
      ));
  if (unsupported && hasCourseWord)
    return clarify(
      '目前可直接查詢清大與暨大的公開開課資料；這所學校尚未接通，請使用該校課程查詢入口。',
    );
  if (
    !explicit &&
    !(hadCommand && hasCourseWord) &&
    !/^(?:公開)?(?:開課|課程)(?:查詢|清單|目錄)/.test(text)
  )
    return null;
  if (!explicit && (mentionsAnotherSchool || otherSchoolWords.test(outsideQuotes)))
    return clarify(
      '請明確指定一所學校，例如「查清大資料庫課程」；目前可直接查詢清大與暨大的公開開課資料。',
    );
  if (/怎麼|如何|為什麼|好不好|好嗎|介紹|評價|排名|比較|推薦/.test(outsideQuotes)) return null;
  if (
    explicit &&
    !hasCourseWord &&
    !/(?:學|概論|系統|設計|資料庫|微積分|統計|物理|化學|英文|日文|會計)\s*[?？!！。]*$/.test(
      outsideQuotes,
    ) &&
    !/^(?:課程名稱|授課老師|關鍵字|課名|課號|教師|老師|系所)/.test(outsideQuotes) &&
    !/^\d[\dA-Z ]{3,79}$/i.test(outsideQuotes)
  )
    return null;
  if (/加入|選課|退選|繳交|上傳|提交|登記|搶課|然後|接著|順便|並且|另外|同時|以及|也幫我|再幫我|並幫我/.test(outsideQuotes)) {
    return clarify('可以先查詢公開開課，再到課程清單核對與帶入課表。' + queryHelp);
  }
  text = text.replace(/^(?:我們學校|我的學校|本校|目前學校|這所學校|這間學校)\s*/, '');
  text = text
    .replace(/^的\s*/, '')
    .replace(command, '')
    .trim();
  text = text.replace(/^(?:目前|本學期|這學期|當期)\s*/, '');
  text = text.replace(/^(?:有沒有|有哪些|有什麼|開了哪些|開設哪些|開設的|是否有)\s*/, '');
  if (/^(?:所有|全部)?(?:公開)?(?:開課|課程)(?:清單|目錄|查詢)?(?:有哪些|有什麼)?$/.test(text))
    text = '';
  text = text.replace(/^(?:公開)?(?:開課查詢|課程查詢|開課清單|課程清單|課程目錄)\s*[:：]?\s*/, '');
  text = text.replace(
    /^(?:課程名稱|授課老師|關鍵字|課名|課號|教師|老師|系所)(?:是|為|叫做)?\s*[:：]?\s*/,
    '',
  );
  text = text.replace(/^(?:courses?\s+(?:for\s+)?)/i, '');
  text = text.replace(/(?:嗎|呢)$/, '').trim();
  // Inspect the complete condition before stripping a trailing course word:
  // removing 課 from 沒課／不上課 would erase a negative requirement.
  const extracted = extractPublicCourseAssistantFilters(text);
  if ('error' in extracted) return clarify(extracted.error);
  text = extracted.text.replace(/(?:的)?(?:公開開課|開課|課程|課|\s+courses?)$/, '').trim();
  if (/^(?:所有|全部|有哪些|有什麼|開設|清單|目錄)$/.test(text)) text = '';
  const quoted = text.match(/^[「『“"]([^「」『』“”"]*)[」』”"]$/);
  if (quoted) text = quoted[1].trim();
  else if (/[「」『』“”"]/.test(text)) return clarify(queryHelp);
  if (
    !quoted &&
    /下學期|上學期|明年|去年|\d{2,4}\s*學年度|\d{2,4}\s*[-/]\s*[123]|星期|禮拜|週|周|學分|必修|選修|不衝堂|不撞課|空堂|幾點|上午|下午|晚上|早上|中午|傍晚/.test(
      text,
    )
  ) {
    return clarify(
      '目前可依課名、課號、系所或老師搜尋，並指定一個上課日與精確學分；尚不能篩選指定學期、鐘點、必選修或不衝堂。' +
        queryHelp,
    );
  }
  const hasControlCharacter = [...text].some((character) => {
    const code = character.codePointAt(0)!;
    return code <= 0x1f || code === 0x7f;
  });
  if (!isPublicCourseOperationQuery(text) || hasControlCharacter)
    return clarify('搜尋內容請限制在 80 字以內，並使用單行課名、課號或老師姓名。');
  const schoolId = explicit?.schoolId ?? resolvePublicCourseOperation(selectedSchoolId)?.schoolId;
  if (!schoolId)
    return clarify(
      '目前可直接查詢清大與暨大的公開開課資料。請在問題中指定學校，例如「查清大的資料庫課程」。',
    );
  return {
    kind: 'search',
    schoolId,
    query: text,
    ...(hasPublicCourseFilters(extracted.filters) ? { filters: extracted.filters } : {}),
  };
}

export function publicCourseAssistantSource(search: PublicCourseAssistantSearch): ReadSource {
  const operation = resolvePublicCourseOperation(search.schoolId);
  const filters = parsePublicCourseFilters(search.filters ?? {});
  if (!operation || !isPublicCourseOperationQuery(search.query) || !filters)
    throw new Error('Invalid public course search');
  const schoolName = schools.find((school) => school.id === search.schoolId)!.name;
  const params = new URLSearchParams({
    schoolId: search.schoolId,
    campus: search.schoolId,
    q: search.query,
  });
  if (filters.weekday !== undefined) params.set('weekday', String(filters.weekday));
  if (filters.credits !== undefined) params.set('credits', String(filters.credits));
  return {
    schoolId: search.schoolId,
    schoolName,
    query: search.query,
    ...(hasPublicCourseFilters(filters) ? { filters } : {}),
    href: '/school-courses?' + params,
    sourceUrl: operation.sourceUrl,
  };
}

export function publicCourseAssistantRead(
  search: PublicCourseAssistantSearch,
  data: unknown,
): PublicCourseAssistantRead {
  if (!isPublicCourseCatalog(data, search.schoolId, search.filters))
    throw new Error('Invalid public course result');
  return {
    ...publicCourseAssistantSource(search),
    status: 'ready',
    ...(data.fetchedAt ? { fetchedAt: data.fetchedAt } : {}),
    matchCount: data.courses.length,
    truncated: data.truncated,
    ...(data.unresolvedCount === undefined ? {} : { unresolvedCount: data.unresolvedCount }),
    courses: data.courses.slice(0, 5).map((course) => ({
      code: course.code,
      section: course.section,
      title: course.title,
      department: course.department,
      teacher: course.teacher,
      time: course.time,
      room: course.room,
      semester: course.semester,
      credits: course.credits,
      ...(course.meetings
        ? { meetings: course.meetings.map(({ time, room }) => ({ time, room })) }
        : {}),
    })),
  };
}

export function formatPublicCourseAssistantRead(read: PublicCourseAssistantRead): string {
  if (read.status === 'unavailable')
    return `暫時無法取得${read.schoolName}公開開課資料，請稍後重新查詢，或前往校方課程目錄。`;
  const query = read.query ? `「${read.query}」` : '';
  const count = read.truncated
    ? `符合${query}的課程超過 ${read.matchCount} 筆`
    : `找到${query}${read.matchCount} 筆開課資料`;
  const lines = [
    read.schoolName + '公開開課查詢',
    count + (read.matchCount > read.courses.length ? `，先列出 ${read.courses.length} 筆。` : '。'),
  ];
  if (hasPublicCourseFilters(read.filters))
    lines.push('篩選條件：' + publicCourseFilterLabel(read.filters));
  if (read.filters?.weekday !== undefined)
    lines.push('有指定星期的上課時段即可符合，課程也可能在其他天上課。');
  if (!read.matchCount) lines.push('這次沒有符合的課程，可改用課號或老師姓名查詢。');
  for (const course of read.courses) {
    lines.push(
      `${course.title}｜課號 ${course.code}｜學期 ${course.semester}${course.teacher ? '｜' + course.teacher : ''}`,
    );
    if (read.filters?.weekday !== undefined) {
      const days = publicCourseWeekdays(course, read.schoolId);
      if (days)
        lines.push('上課日：' + days.map((day) => '星期' + '一二三四五六日'[day - 1]).join('、'));
    }
  }
  if (read.unresolvedCount)
    lines.push(`另有 ${read.unresolvedCount} 筆符合關鍵字的課程資料不足，未列入這次篩選。`);
  if (read.fetchedAt)
    lines.push(
      `校方資料擷取：${formatPublicCatalogFetchedAt(read.fetchedAt)}（台灣時間；非校方更新時間）。`,
    );
  lines.push('這是公開開課資料，不代表個人已選課或已取得學分。');
  return lines.join('\n');
}
