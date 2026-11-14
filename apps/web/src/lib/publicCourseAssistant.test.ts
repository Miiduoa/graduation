// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  publicCourseAssistantRead,
  formatPublicCourseAssistantRead,
  resolvePublicCourseAssistantIntent as resolve,
} from '@campus/shared/src/publicCourseAssistant';
import { resolvePublicCourseOperation } from '@campus/shared/src/publicCourseOperations';

describe('public course requests', () => {
  it.each([
    ['幫我找清大的資料庫課程', 'nthu', '資料庫'],
    ['幫我找清大的資料庫課', 'nthu', '資料庫'],
    ['清大有沒有資料庫的課', 'nthu', '資料庫'],
    ['清大有沒有資料庫課程嗎？', 'nthu', '資料庫'],
    ['清華大學課程查詢：作業系統', 'nthu', '作業系統'],
    ['我想找清大的作業系統課程', 'nthu', '作業系統'],
    ['請查暨南國際大學的管理學', 'ncnu', '管理學'],
    ['暨大管理學', 'ncnu', '管理學'],
    ['幫我查國立暨南國際大學課號 005076', 'ncnu', '005076'],
    ['查清大 11510AES 520300 課程', 'nthu', '11510AES 520300'],
    ['查清大老師：王小明', 'nthu', '王小明'],
    ['列出清大本學期開課', 'nthu', ''],
    ['清大本學期有哪些課程', 'nthu', ''],
    ['列出清大所有課程', 'nthu', ''],
    ['清大的開課清單', 'nthu', ''],
    ['清大課程有哪些', 'nthu', ''],
    ['幫我查資料庫課程（清大）', 'nthu', '資料庫'],
    ['幫我查資料庫課程，清大的', 'nthu', '資料庫'],
    ['查清大「大學英文」課程', 'nthu', '大學英文'],
    ['查清大的大學英文課程', 'nthu', '大學英文'],
    ['清大有沒有大學英文的課', 'nthu', '大學英文'],
    ['查清大「清大校史」課程', 'nthu', '清大校史'],
    ['find NTHU database courses', 'nthu', 'database'],
    ['search NCNU courses for Data Science', 'ncnu', 'Data Science'],
  ])(
    'extracts %s while preserving the requested school and keyword',
    (question, schoolId, query) => {
      expect(resolve(question, 'pu')).toEqual({ kind: 'search', schoolId, query });
    },
  );

  it('uses current school only when no other school is named', () => {
    expect(resolve('查詢資料庫課程', 'ncnu')).toEqual({
      kind: 'search',
      schoolId: 'ncnu',
      query: '資料庫',
    });
    expect(resolve('查課 資料庫', 'nthu')).toEqual({
      kind: 'search',
      schoolId: 'nthu',
      query: '資料庫',
    });
    expect(resolve('查我們學校的資料庫課程', 'nthu')).toEqual({
      kind: 'search',
      schoolId: 'nthu',
      query: '資料庫',
    });
    expect(resolve('查我的學校的資料庫課程', 'ncnu')).toEqual({
      kind: 'search',
      schoolId: 'ncnu',
      query: '資料庫',
    });
    expect(resolve('查資料庫課程', 'pu')?.kind).toBe('clarify');
  });

  it.each([
    '幫我查台大資料庫課程',
    '台大有哪些課程',
    '查北京清華大學的資料庫課程',
    '查東海資料庫課程',
    '查中原大學資料庫課程',
    '查廣州暨南大學的管理學課程',
    '查火星科技大學課程',
    '清大和暨大資料庫課程',
    '查清大資料庫課程和暨大管理學',
    '查清大資料庫課程和台大微積分',
    '查資料庫課程（台大）',
    '查資料庫清大課程',
    '清大週二下午的資料庫課程',
    '查清大下學期的資料庫課程',
    '查清大資料庫課程然後直接加入課表',
  ])('does not silently change or drop a requested constraint: %s', (question) => {
    // Personal timetable mutations stay on the normal assistant path.
    expect(resolve(question, 'nthu')?.kind ?? 'normal-assistant').not.toBe('search');
  });

  it.each([
    '我明天有哪些課？',
    '查我的課程',
    '我今天下一堂課在哪裡',
    '幫我看這堂課的作業',
    '請翻譯「幫我查清大資料庫課程」',
    '不要查清大資料庫課程',
    '清大資料庫課程好不好',
    '幫我解釋資料庫課程',
    '查我的成績',
    '找圖書館',
    '清大圖書館在哪裡？',
    '清大有什麼餐廳？',
    '幫我查我的資料庫課程',
    '查資料庫課程作業',
    '查清大資料庫課程的教材',
    '清大什麼時候放假',
    '幫我查我修的課程',
    '查我這學期的課程',
    '幫我查已選的資料庫課程',
    '清大的期中考時間',
    '查清大資料庫課程好不好',
    'find my database course',
    '清大天氣',
    '幫我查清大天氣',
  ])('keeps private or non-lookup requests on the original path: %s', (question) => {
    expect(resolve(question, 'nthu')).toBeNull();
  });

  it('uses Unicode code points and refuses oversized inputs instead of truncating them', () => {
    const query = '𠮷'.repeat(80);
    expect(resolve('查清大「' + query + '」課程')).toEqual({
      kind: 'search',
      schoolId: 'nthu',
      query,
    });
    expect(resolve('查清大「' + query + '𠮷」課程')?.kind).toBe('clarify');
  });

  it.each([
    ['幫我查清大的星期一 3 學分資料庫課程', 'nthu', '資料庫', { weekday: 1, credits: 3 }],
    ['查清大星期三3學分的資料庫課程', 'nthu', '資料庫', { weekday: 3, credits: 3 }],
    ['清大週三有沒有三學分資料庫課程', 'nthu', '資料庫', { weekday: 3, credits: 3 }],
    ['查清大星期三上課的3學分課程', 'nthu', '', { weekday: 3, credits: 3 }],
    ['查暨大資料庫課程 週日 2.5學分', 'ncnu', '資料庫', { weekday: 7, credits: 2.5 }],
    ['幫我找清大三學分資料庫課程', 'nthu', '資料庫', { credits: 3 }],
    ['查清大星期四大學英文課程', 'nthu', '大學英文', { weekday: 4 }],
    ['查清大星期三「大學英文」課程', 'nthu', '大學英文', { weekday: 3 }],
    ['查清大星期天 0 學分的課程', 'nthu', '', { weekday: 7, credits: 0 }],
    ['查暨大兩點五學分管理學課程', 'ncnu', '管理學', { credits: 2.5 }],
    ['查暨大十五學分的課程', 'ncnu', '', { credits: 15 }],
    ['查清大３學分的資料庫課程', 'nthu', '資料庫', { credits: 3 }],
    ['查清大3學分非線性課程', 'nthu', '非線性', { credits: 3 }],
    ['查清大星期三無機化學課程', 'nthu', '無機化學', { weekday: 3 }],
    ['查清大星期三「不排課程」課程', 'nthu', '不排課程', { weekday: 3 }],
    ['查星期五的資料庫課程', 'ncnu', '資料庫', { weekday: 5 }],
  ])('keeps the complete supported conditions for %s', (question, schoolId, query, filters) => {
    expect(resolve(question, 'ncnu')).toEqual({ kind: 'search', schoolId, query, filters });
  });

  it.each([
    '查清大星期一和星期三的課程',
    '查清大週三或四資料庫課程',
    '查清大星期三四資料庫課程',
    '查清大只有星期三上課的課程',
    '查清大非星期三的課程',
    '查清大星期三不上課的課程',
    '查清大星期三不排課的資料庫課程',
    '查清大星期三沒排課的資料庫課程',
    '查清大星期三不能上課的資料庫課程',
    '查清大星期三不想上課的資料庫課程',
    '查清大星期三不安排課程的資料庫課程',
    '查清大星期三無法上課的資料庫課程',
    '查清大星期三沒課的課程',
    '查清大星期三沒課',
    '查清大星期三不上課',
    '查清大星期三無課',
    '查清大星期三無課的課程',
    '查清大非三學分的課程',
    '查清大三學分以外的課程',
    '查清大3學分左右的課程',
    '查清大星期三以前的課程',
    '查清大下週三的課程',
    '查清大下星期三的課程',
    '查清大這禮拜三的課程',
    '查清大11月18日星期三的課程',
    '查清大星期三下午3學分資料庫課程',
    '查清大至少3學分的課程',
    '查清大3到4學分的課程',
    '查清大3或4學分的課程',
    '查清大41學分課程',
    '查清大-3學分課程',
    '查清大2.555學分課程',
    '查清大1e1學分課程',
    '查清大0x3學分課程',
    '查清大星期八課程',
    '查清大星期三台大資料庫課程',
  ])('does not silently reinterpret unsupported conditions: %s', (question) => {
    expect(resolve(question, 'nthu')?.kind).toBe('clarify');
  });

  it('keeps weekday and credit words inside quoted course titles literal', () => {
    expect(resolve('查清大「星期三的三學分」課程')).toEqual({
      kind: 'search',
      schoolId: 'nthu',
      query: '星期三的三學分',
    });
  });
});

describe('grounded course previews', () => {
  const search = { kind: 'search', schoolId: 'nthu', query: '資料庫 & AI' } as const;
  const course = {
    code: '11510AES 520300',
    section: '00',
    title: '資料庫',
    department: '資工',
    teacher: '王小明',
    time: 'M3',
    room: 'R1',
    semester: '1151',
    credits: '3',
    meetings: [{ time: 'M3', room: 'R1' }],
  };
  const data = () => ({
    schoolId: 'nthu',
    sourceUrl: resolvePublicCourseOperation('nthu')!.sourceUrl,
    fetchedAt: '2026-11-07T11:53:52.366Z',
    courses: Array.from({ length: 7 }, () => ({ ...course, token: 'private-extra' })),
    truncated: false,
  });

  it('previews five original records, keeps exact codes, and encodes a same-school handoff', () => {
    const read = publicCourseAssistantRead(search, data());
    expect(read.status).toBe('ready');
    if (read.status !== 'ready') return;
    expect(read.courses).toHaveLength(5);
    expect(read.matchCount).toBe(7);
    expect(read.courses[0]).toEqual(course);
    const href = new URL(read.href, 'https://nuni.tw');
    expect(href.pathname).toBe('/school-courses');
    expect(Object.fromEntries(href.searchParams)).toEqual({
      schoolId: 'nthu',
      campus: 'nthu',
      q: search.query,
    });
    expect(formatPublicCourseAssistantRead(read)).toContain('先列出 5 筆');
    expect(formatPublicCourseAssistantRead(read)).toContain('2026-11-07 19:53');
  });

  it('preserves empty, truncated, and legacy responses without inventing fetch times', () => {
    const empty = publicCourseAssistantRead(search, {
      ...data(),
      courses: [],
      fetchedAt: undefined,
    });
    expect(empty.status === 'ready' && empty.fetchedAt).toBeUndefined();
    expect(formatPublicCourseAssistantRead(empty)).toContain('沒有符合');
    const truncated = publicCourseAssistantRead(search, { ...data(), truncated: true });
    expect(formatPublicCourseAssistantRead(truncated)).toContain('超過 7 筆');
  });

  it.each([
    { schoolId: 'ncnu' },
    { sourceUrl: 'https://example.test' },
    {
      operation: {
        id: 'nthu.courses.search',
        version: 2,
        responseSchemaVersion: 1,
        access: 'anonymous-public',
      },
    },
  ])('rejects incompatible source data %j', (patch) => {
    expect(() => publicCourseAssistantRead(search, { ...data(), ...patch })).toThrow();
  });
});
