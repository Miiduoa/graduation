import { afterEach, expect, it, vi } from 'vitest';
import {
  careerCalendarUrl,
  careerSoon,
  careerTimeline,
  careerTitleDate,
  emptyCareerFeed,
} from '@campus/shared/src/career';
import {
  CAREER_HTML_SOURCES,
  TAIWANJOBS_URL,
  loadCareerFeed,
  parseCareerHtml,
  parseTaiwanJobs,
} from './adapters';
import { GET } from './route';
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const html = `<div class="d-txt"><div class="mtitle"><i class="mdate before">2026-11-12</i><a href="/p/406-1102-1.php">實習申請2026/12/8截止</a></div></div>`;
it('adapts HTML list metadata only and rejects nonofficial and unsafe links', () => {
  const records = parseCareerHtml(
    html +
      `<div class="d-txt"><a href="https://other.test/p/406-x">外站</a></div><article>不保留正文</article>`,
    CAREER_HTML_SOURCES[0],
  );
  expect(records).toEqual([
    {
      title: '實習申請2026/12/8截止',
      date: '2026-11-12',
      url: 'https://cdif.pu.edu.tw/p/406-1102-1.php',
      source: '職產處',
    },
  ]);
  expect(JSON.stringify(records)).not.toContain('正文');
});
it('never promotes publication dates or ambiguous dates into deadlines', () => {
  expect(careerTitleDate('實習資訊')).toBe('');
  expect(careerTitleDate('11/20 實習截止')).toBe('');
  expect(careerTitleDate('2026/2/30 申請截止')).toBe('');
  expect(careerTitleDate('2026/11/20 至 2026/11/21 徵才')).toBe('');
  expect(careerTitleDate('115年11月20日徵才')).toBe('2026-11-20');
});
it.each(CAREER_HTML_SOURCES)(
  'normalizes $source article URLs before publishing or opening calendars',
  async (source) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-14T04:00:00Z'));
    const article = '/p/406-1102-1.php';
    const linkHtml = (href: string) =>
      `<div class="d-txt"><a href="${href}">2026/12/8 實習申請截止</a></div>`;
    const input = [
      article + '?studentId=TEST-STUDENT-ID&amp;grade=TEST-GRADE#TEST-FRAGMENT',
      source.url + article.slice(1) + '?Lang=zh-tw&amp;unknown=TEST-UNKNOWN',
      '/p/404-1102-2,r28.php?studentId=TEST-STUDENT-ID',
      '/p/406-1102-TEST-STUDENT-ID.php',
      '/p/406-1102-1.php/TEST-GRADE',
      '/p/406-1102-1.php%3FstudentId=TEST-STUDENT-ID',
      '/other/p/406-1102-1.php',
      `https://${new URL(source.url).hostname}:8443${article}`,
    ]
      .map(linkHtml)
      .join('');
    expect(parseCareerHtml(input, source).map((item) => item.url)).toEqual([
      source.url + article.slice(1),
      source.url + 'p/404-1102-2,r28.php',
    ]);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => ({
        ok: true,
        text: async () => (url === TAIWANJOBS_URL ? '<DataList></DataList>' : input),
      })),
    );
    const response = await GET(new Request('https://nuni.tw/career/data?school=pu'));
    const feed = await response.json();
    expect(feed.announcements).toHaveLength(4);
    expect(feed.timeline).toHaveLength(4);
    expect(JSON.stringify(feed)).not.toMatch(/TEST-|studentId|grade|Lang|unknown|[?#]/i);
    for (const item of feed.timeline) {
      const calendar = new URL(careerCalendarUrl(item));
      expect(calendar.searchParams.get('details')).toContain(item.url);
      expect(calendar.searchParams.get('details')).not.toMatch(/TEST-|studentId|grade|[?#]/i);
    }
  },
);
it.each([
  '2026/11/15 公告：實習申請至 12/08 截止',
  '2026/11/20 至 11/21 徵才博覽會',
  '2026年11月20日至21日徵才博覽會',
  '2026/11/20～11/21 徵才博覽會',
  '2026年11月20日至11月21日徵才博覽會',
  '發布：2026/11/15 實習申請資訊',
  '公告日期：2026/11/15 實習申請資訊',
  '2026/11/15 更新：實習申請資訊',
  '2026/12/8、9日徵才博覽會',
  '2026年12月8日及9日徵才博覽會',
  '2026年12月8日與9日徵才博覽會',
  '2026/12/8、12/9徵才博覽會',
  '2026/12/8 講座取消',
  '2026/12/8 講座延期',
  '2026/12/8 講座日期待定',
  '2026/12/8 徵才博覽會停辦',
  '2026/12/8 說明會改期，日期另行通知',
  '2026/12/8 講座延 後',
  '2026/12/8至翌日實習說明會',
  '2026/12/8至月底實習申請',
  '2026/12/8 實習講座至活動結束',
  '2026/12/8 實習講座迄翌日',
  '2026/12/8～翌日實習說明會',
  '2026/12/8 實習講座到活動結束',
  '2026/12/8 起實習申請，月底截止',
  '2026/12/8 徵才講座至隔日',
  '2026/12/8 起至次日實習說明會',
  '2026/12/8 講座到本月底',
  '2026/12/8 實習申請至本學期末',
  '2026/12/8 實習申請截止至另行通知',
])('keeps ambiguous title out of calendar timeline: %s', (title) => {
  expect(careerTitleDate(title)).toBe('');
  expect(
    careerTimeline(
      [
        {
          title,
          date: '2026-11-01',
          url: 'https://cdif.pu.edu.tw/p/406-1102-1.php',
          source: '職產處',
        },
      ],
      '2026-11-01',
    ),
  ).toEqual([]);
});
it.each([
  ['2026/12/8 實習申請截止', '2026-12-08'],
  ['實習申請至2026年12月8日截止', '2026-12-08'],
  ['公告：2026/12/8 校園徵才博覽會', '2026-12-08'],
])('accepts an explicit single event/deadline date: %s', (title, date) => {
  expect(careerTitleDate(title)).toBe(date);
});
it.each(['取消', '延期', '延 後', '停辦', '改期', '取消通知'])(
  'suppresses the exact original event for a separate %s notice, regardless of input order',
  (status) => {
    const original = {
      title: '2026/12/8 實習說明會',
      date: '2026-11-01',
      url: 'https://cdif.pu.edu.tw/p/406-1102-1.php',
      source: '職產處',
    };
    const notice = {
      ...original,
      title:
        status === '取消通知'
          ? `2026/12/8 實習說明會取消`
          : `【${status}通知】2026年12月8日 實習說明會`,
      date: '2026-11-14',
      url: 'https://cdif.pu.edu.tw/p/406-1102-2.php',
    };
    const unrelated = [
      { ...original, source: '系所', url: original.url + '?other-source' },
      { ...original, title: '2026/12/9 實習說明會', url: original.url + '?other-date' },
      { ...original, title: '2026/12/8 海外實習說明會', url: original.url + '?other-event' },
    ];
    for (const records of [
      [original, notice],
      [notice, original],
    ]) {
      const input = [...records, ...unrelated];
      expect(
        careerTimeline(input, '2026-11-14')
          .map((item) => item.url)
          .sort(),
      ).toEqual(unrelated.map((item) => item.url).sort());
      expect(input).toContain(notice);
      expect(input).toHaveLength(5);
    }
  },
);
it('public API excludes sensitive titles from announcements and calendar items for both sources', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-14T04:00:00Z'));
  const sensitiveTitles = [
    '2026/12/8 實習錄取名單 410123456 王測試',
    '2026/12/8 實習評分 王測試 95 分',
    '2026/12/8 實習 410123456 王測試',
    '2026/12/8 實習 A410123456 王測試',
    '2026/12/8 實習 ４１０１２３４５６ 王測試',
    '2026/12/8 實習 410-123-456 王測試',
    '2026/12/8 實習 王測試 95 分',
    '2026/12/8 實習名冊 王測試',
    '2026/12/8 實習甄選榜單',
    '2026/12/8 實習' + '說明'.repeat(160) + '410123456',
    '2026/12/8 實習 学号：TEST-0001',
    '2026/12/8 實習 學 號：TEST-0001',
    '2026/12/8 實習 学・号：TEST-0001',
    '2026/12/8 實習 學\u200b號：TEST-0001',
    '2026/12/8 實習 成 績 為 95 分',
    '2026/12/8 實習 成／绩：95 分',
    '2026/12/8 實習 STUDENT-ID：TEST-0001',
    '2026/12/8 實習 S.t.u.d.e.n.t I.D.：TEST-0001',
    '2026/12/8 實習 student_number：TEST-0001',
    '2026/12/8 實習 g.r.a.d.e／s.c.o.r.e：95',
    '2026/12/8 實習 Ｇ Ｒ Ａ Ｄ Ｅ：95',
    '2026/12/8 實習 成<span>績</span>：95',
    '2026/12/8 實習 学&#x53f7;：TEST-0001',
    '2026/12/8 實習' + '說明'.repeat(160) + '学 号：TEST-0001',
    '2026/12/8 實習錄取 學號：TEST-STUDENT-ID 成績：TEST-GRADE',
    '2026/12/8 實習成績：TEST-GRADE',
    '2026/12/8 實習成績 95 分',
    '2026/12/8 實習申請 成績為 95 分',
    '2026/12/8 實習成績 王測試 95 分',
    '2026/12/8 实习成绩为 95 分',
    '2026/12/8 實習 Score 95',
    '2026/12/8 實習 score for Test Student is 95',
    '2026/12/8 實習 Grades Test Student 95',
    '2026/12/8 實習 ＳＣＯＲＥ 95',
    '2026/12/8 實習' + '說明'.repeat(160) + '成績為 95 分',
    '2026/12/8 實習 Student ID: TEST-STUDENT-ID',
    '2026/12/8 實習 Grade: TEST-GRADE',
    '2026/12/8 實習 Ｓｔｕｄｅｎｔ ＩＤ：TEST-STUDENT-ID',
    '2026/12/8 實習' + '說明'.repeat(160) + '學號：TEST-STUDENT-ID',
  ];
  const sensitiveHtml = sensitiveTitles
    .map((title, i) => `<div class="d-txt"><a href="/p/406-1102-${i + 10}.php">${title}</a></div>`)
    .join('');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => ({
      ok: true,
      text: async () => (url === TAIWANJOBS_URL ? '<DataList></DataList>' : html + sensitiveHtml),
    })),
  );
  const response = await GET(new Request('https://nuni.tw/career/data?school=pu'));
  const feed = await response.json();
  expect(feed.announcements).toHaveLength(2);
  expect(
    feed.announcements.every((item: { title: string }) => item.title === '實習申請2026/12/8截止'),
  ).toBe(true);
  expect(feed.timeline).toHaveLength(2);
  expect(
    feed.timeline.every(
      (item: { title: string; date: string }) =>
        item.title === '實習申請2026/12/8截止' && item.date === '2026-12-08',
    ),
  ).toBe(true);
  expect(feed.announcementsUnavailable).toBe(false);
  expect(JSON.stringify(feed)).not.toMatch(
    /TEST-0001|TEST-STUDENT-ID|TEST-GRADE|成績|成绩|Student|Grades?|Scores?|學號/i,
  );
});
it.each([
  'GPA 3.95',
  'CGPA 3.95',
  'ＧＰＡ：３．９５',
  'G. P. A.：3.95',
  'G<span>P</span>A 3.95',
  'G&#80;A 3.95',
  'grade point average 3.95',
  'academic average 95',
  'weighted average 95',
  'Average: 95',
  '平均 95',
  '平\u200b均：９５',
  '加權平均 95',
  '均分 95',
  '總分 95',
  '總評 A+',
  ...['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D', 'E', 'F'].flatMap((grade) => [
    `等第 ${grade}`,
    `等 第：${grade}`,
    grade,
    `測試同學${grade}`,
  ]),
  'Test Student A+',
  'TestStudent95',
  '等第 Ａ ＋',
  '等&#x7b2c; A+',
  '等<span>第</span> A+',
  '等\u200b第 A+',
  '成 绩 9 5 分',
  '分 数 9 5',
  'Ｇ Ｐ Ａ 3 . 9 5',
  '学 号 TEST-0001',
  '9 5',
  '95.5',
  '95 請確認結果',
  '95.5 請確認結果',
  '95/100',
  '9 5 分',
  '說明'.repeat(160) + '等 第 A+',
  '說明'.repeat(160) + 'GPA 3.95',
])('public API omits the entire academic-result title from both sources: %s', async (result) => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-14T04:00:00Z'));
  const sensitive = `<div class="d-txt"><a href="/p/406-1102-2.php">2026/12/8 實習申請 王測試 ${result}</a></div>`;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => ({
      ok: true,
      text: async () => (url === TAIWANJOBS_URL ? '<DataList></DataList>' : sensitive + html),
    })),
  );
  const response = await GET(new Request('https://nuni.tw/career/data?school=pu'));
  const feed = await response.json();
  expect(feed.announcements.map((item: { title: string }) => item.title)).toEqual([
    '實習申請2026/12/8截止',
    '實習申請2026/12/8截止',
  ]);
  expect(feed.timeline.map((item: { title: string }) => item.title)).toEqual([
    '實習申請2026/12/8截止',
    '實習申請2026/12/8截止',
  ]);
  expect(JSON.stringify(feed)).not.toContain('王測試');
  expect(feed.announcementsUnavailable).toBe(false);
  // The cacheable API body and every calendar export must contain only safe records.
  expect(response.headers.get('Cache-Control')).toContain('public');
  for (const item of feed.timeline) {
    expect(new URL(careerCalendarUrl(item)).searchParams.get('text')).toBe('實習申請2026/12/8截止');
    expect(decodeURIComponent(careerCalendarUrl(item))).not.toContain('王測試');
  }
});
it.each([
  '95 王測試 實習申請',
  '95.5 王測試 實習申請',
  '９５．５ 王測試 實習申請',
  '9 5 王測試 實習申請',
  '95/100 王測試 實習申請',
  '95 Test Student 實習申請',
  '實習申請 王測試 S411A1234',
  ...['.', '．', '/', '・', '_', '\u200b', ' - '].map(
    (separator) => `實習申請 王測試 S411${separator}A1234`,
  ),
  '實習申請 王測試 九十五分',
  '實習申請 王測試 九十五點五分',
  '實習申請 王測試 玖拾伍分',
  '實習申請 王測試 九 五 分',
  '九十五分 王測試 實習申請',
  ...['優', '優等', '甲', '乙等', '丙', '丁等', '及格', '不及格'].map(
    (grade) => `實習申請 王測試 ${grade}`,
  ),
])(
  'withholds reversed results and mixed student identifiers before public caching: %s',
  async (suffix) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-14T04:00:00Z'));
    const title = `2026/12/8 ${suffix}`;
    const sensitiveHtml = `<div class="d-txt"><a href="/p/406-1102-2.php">${title}</a></div>`;
    for (const source of CAREER_HTML_SOURCES) {
      expect(parseCareerHtml(sensitiveHtml, source)).toEqual([]);
    }
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => ({
        ok: true,
        text: async () => (url === TAIWANJOBS_URL ? '<DataList></DataList>' : sensitiveHtml + html),
      })),
    );
    const response = await GET(new Request('https://nuni.tw/career/data?school=pu'));
    const feed = await response.json();
    expect(response.headers.get('Cache-Control')).toContain('public');
    expect(feed.announcements).toHaveLength(2);
    expect(feed.timeline).toHaveLength(2);
    expect(JSON.stringify(feed)).not.toMatch(/王測試|Test Student|S411A1234/);
    for (const item of [...feed.announcements, ...feed.timeline]) {
      expect(item.title).toBe('實習申請2026/12/8截止');
    }
    for (const item of feed.timeline) {
      expect(new URL(careerCalendarUrl(item)).searchParams.get('text')).toBe(
        '實習申請2026/12/8截止',
      );
      expect(decodeURIComponent(careerCalendarUrl(item))).not.toMatch(
        /王測試|Test Student|S411A1234/,
      );
    }
  },
);
it('mixes department, career-office and recruiting entries chronologically, caps at five and highlights seven days without red', () => {
  const records = Array.from({ length: 8 }, (_, i) => ({
    title: `2026/11/${15 + i} ${i === 1 ? '校園徵才' : '實習申請截止'}`,
    date: '2026-11-01',
    url: `https://cdif.pu.edu.tw/p/406-1102-${i}.php`,
    source: i % 2 ? '資管系' : '職產處',
  }));
  const timeline = careerTimeline(records.reverse(), '2026-11-14');
  expect(timeline).toHaveLength(5);
  expect(timeline.map((i) => i.source)).toContain('校園徵才');
  expect(timeline.map((i) => i.source)).toContain('資管系');
  expect(timeline[0].date).toBe('2026-11-15');
  expect(careerSoon('2026-11-21', '2026-11-14')).toBe(true);
  expect(careerSoon('2026-11-22', '2026-11-14')).toBe(false);
  expect(careerSoon('2026-11-13', '2026-11-14')).toBe(false);
  expect(careerCalendarUrl(timeline[0])).toContain('calendar.google.com');
});
it('reads official TaiwanJobs CDATA, rejects injected URLs, excludes bodies', () => {
  const data = `<Data><OCCU_DESC（職務名稱）><![CDATA[開放資料職稱]]></OCCU_DESC（職務名稱）><COMPNAME（公司名稱）><![CDATA[來源公司]]></COMPNAME（公司名稱）><URL_QUERY（職缺資料URL）><![CDATA[https://job.taiwanjobs.gov.tw/Internet/jobwanted/JobDetail.aspx?HIRE_ID=1]]></URL_QUERY（職缺資料URL）><JOB_DETAIL><![CDATA[不要回傳正文]]></JOB_DETAIL></Data>`;
  const jobs = parseTaiwanJobs(
    `<DataList>${data}${data.replace('https://job.taiwanjobs.gov.tw', 'https://evil.test')}</DataList>`,
  );
  expect(jobs).toHaveLength(1);
  expect(jobs[0].source).toBe('台灣就業通');
  expect(JSON.stringify(jobs)).not.toContain('正文');
  expect(() => parseTaiwanJobs('<html>error</html>')).toThrow();
});
it('fails sources independently and queries ZIP 433 without third-party scraping', async () => {
  const fetcher = vi.fn(async (url: string) => {
    if (url === TAIWANJOBS_URL) throw Error('down');
    return { ok: true, text: async () => html };
  });
  vi.stubGlobal('fetch', fetcher);
  const feed = await loadCareerFeed();
  expect(feed.jobsUnavailable).toBe(true);
  expect(feed.announcements.length).toBe(2);
  expect(fetcher.mock.calls.map((c) => c[0])).toEqual(
    expect.arrayContaining(['https://cdif.pu.edu.tw/', 'https://csim.pu.edu.tw/', TAIWANJOBS_URL]),
  );
  expect(TAIWANJOBS_URL).toContain('zipno=433');
});
it('does not fetch a default school when school is missing or unsupported', async () => {
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  const response = await GET(new Request('https://nuni.tw/career/data?school=ntu'));
  expect(await response.json()).toEqual(emptyCareerFeed(false));
  expect(fetcher).not.toHaveBeenCalled();
});

it('keeps cancellation notices readable without offering a calendar event', async () => {
  const title = '2026/12/8 實習講座延期';
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => ({
      ok: true,
      text: async () =>
        url === TAIWANJOBS_URL
          ? '<DataList></DataList>'
          : html.replace('實習申請2026/12/8截止', title),
    })),
  );
  const response = await GET(new Request('https://nuni.tw/career/data?school=pu'));
  const feed = await response.json();
  expect(feed.announcements).toHaveLength(2);
  expect(feed.announcements[0].title).toBe(title);
  expect(feed.timeline).toEqual([]);
});
it('retains ordinary dated career announcements and event durations', () => {
  for (const title of [
    '2026/11/20 徵才講座',
    '115年11月20日實習申請截止',
    '2026/12/8 履歷講座 30 分鐘',
    '2026/12/8 履歷講座 104人力銀行',
    '2026/12/8 實習說明會 教室B201',
    '2026/12/8 實習講座 報名費500元',
    '2026/12/8 履歷講座 九十分鐘',
    '2026/12/8 優良企業徵才講座',
    '2026/12/8 甲公司實習說明會',
  ]) {
    expect(
      parseCareerHtml(html.replace('實習申請2026/12/8截止', title), CAREER_HTML_SOURCES[0])[0]
        .title,
    ).toBe(title);
  }
});

it.each(['2026/12/8至翌日實習說明會', '2026/12/8至月底實習申請'])(
  'keeps an undetermined text range in public announcements without calendar items: %s',
  async (title) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-14T04:00:00Z'));
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => ({
        ok: true,
        text: async () =>
          url === TAIWANJOBS_URL
            ? '<DataList></DataList>'
            : html.replace('實習申請2026/12/8截止', title),
      })),
    );
    const response = await GET(new Request('https://nuni.tw/career/data?school=pu'));
    const feed = await response.json();
    expect(feed.announcements.map((a: { title: string }) => a.title)).toEqual([title, title]);
    expect(feed.timeline).toEqual([]);
  },
);
