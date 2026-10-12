'use strict';

const {
  parseIwebTable,
  parseIwebLinks,
  parseRpageList,
  parseHtmlLinks,
  parseRss,
  runParser,
} = require('./parsers');
const { extractFromHtml } = require('./extract');
const { normalizeAnnouncementUrl, isLoginPortalUrl } = require('./url');
const { classifyAnnouncement, summarizeAnnouncement } = require('./classify');

const IWEB = `
<table>
<tr><td>1</td><td><a href="/p/412-1042-71089.php?Lang=zh-tw" title="115學年度選課公告">115學年度選課公告</a></td><td>2026-10-01</td></tr>
<tr><td>2</td><td><a href="https://acd.pu.edu.tw/p/412-1042-71090.php">資訊處系統維修</a></td><td>2026/09/30</td></tr>
</table>
<a href="/p/412-1042-999.php">下一頁</a>
`;

const RPAGE = `
<ul class="news-list">
<li><a href="/News/news.aspx?nid=88">全校最新消息一</a><span>2026-10-02</span></li>
<li><a href="/news.php?news_id=9">教務處加退選提醒</a><span>2026-10-01</span></li>
</ul>
`;

const RSS = `<?xml version="1.0"?><rss version="2.0"><channel>
<item><title>教務處公告</title><link>https://aca.example.edu/a/1</link><pubDate>Thu, 01 Oct 2026 00:00:00 GMT</pubDate><description>選課時程</description></item>
</channel></rss>`;

test('iWeb table parser reads title, date and canonical 412 links', () => {
  const rows = parseIwebTable(IWEB, 'https://acd.pu.edu.tw/p/403-1042-885-1.php');
  expect(rows[0]).toMatchObject({
    title: '115學年度選課公告',
    originalUrl: 'https://acd.pu.edu.tw/p/412-1042-71089.php',
  });
  expect(rows[0].publishedAt.startsWith('2026-10-01')).toBe(true);
  expect(rows.map((row) => row.title)).not.toContain('下一頁');
});

test('iWeb link fallback still finds 412 documents when the table is gone', () => {
  const html = '<div><a href="/p/412-1059-5218.php">加退選注意事項</a> 2026-08-20</div>';
  expect(parseIwebLinks(html, 'https://dorac.pu.edu.tw/').map((row) => row.title)).toEqual([
    '加退選注意事項',
  ]);
});

test('RPage parser reads news list links', () => {
  const rows = parseRpageList(RPAGE, 'https://www.ncu.edu.tw/tw/news/index.php');
  expect(rows).toHaveLength(2);
  expect(rows[0].originalUrl).toContain('nid=88');
});

test('RSS parser reads items without keeping login portal URLs', async () => {
  const rows = await parseRss(RSS, 'https://aca.example.edu/rss.xml');
  expect(rows[0].title).toBe('教務處公告');
  expect(isLoginPortalUrl('https://alcat.pu.edu.tw/index_menu.php')).toBe(true);
  expect(parseHtmlLinks('<a href="https://alcat.pu.edu.tw/index_menu.php">系統通知</a>', 'https://www.pu.edu.tw/')).toEqual(
    [],
  );
});

test('dual extract uses the first parser that returns rows', async () => {
  const extracted = await extractFromHtml(IWEB, {
    sourceId: 'pu-acd',
    office: '教務處',
    scope: 'office',
    listUrl: 'https://acd.pu.edu.tw/p/403-1042-885-1.php',
    parsers: ['iwebTable', 'iwebLinks'],
  });
  expect(extracted.parser).toBe('iwebTable');
  expect(extracted.items[0].category).toBe('academic');
  expect(extracted.items[1].category).toBe('system');
  expect(extracted.items[0].body.length).toBeLessThanOrEqual(120);
});

test('URL normalization drops language and tracking query and classifies summaries', () => {
  expect(
    normalizeAnnouncementUrl('http://ACD.pu.edu.tw/p/412-1042-1.php?Lang=zh-tw&utm_source=x#top'),
  ).toBe('https://acd.pu.edu.tw/p/412-1042-1.php');
  expect(classifyAnnouncement('颱風停課通知')).toBe('emergency');
  expect(summarizeAnnouncement('甲'.repeat(200)).endsWith('…')).toBe(true);
});

test('runParser rejects unknown parser names', async () => {
  await expect(runParser('not-a-parser', IWEB, 'https://example.edu/')).resolves.toEqual([]);
});
