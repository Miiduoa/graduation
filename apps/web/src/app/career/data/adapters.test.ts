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
afterEach(() => vi.unstubAllGlobals());
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
