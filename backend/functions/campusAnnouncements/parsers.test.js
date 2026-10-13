'use strict';

const fs = require('node:fs');
const path = require('node:path');
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

test('iWeb links skip navigation and keep news-list articles', () => {
  const html = `
<nav class="hdmenu"><ul class="nav navbar-nav">
  <li class="dropdown"><a class="dropdown-toggle" href="https://www.pu.edu.tw/p/403-1000-195.php">行政單位</a>
    <ul class="dropdown-menu"><li><a href="/p/412-1042-3144.php">教務Q&amp;A</a></li></ul>
  </li>
  <li><a href="/p/403-1042-885.php">最新消息</a></li>
</ul></nav>
<div id="pageptlist">
  <div class="row listBS"><div class="d-item"><div class="mtitle">
    <a href="https://acd.pu.edu.tw/p/406-1042-71089,r885.php" title="【教務】選課公告">【教務】選課公告</a>
  </div></div></div>
  <div class="row listBS"><div class="d-item"><div class="mtitle">
    <a href="/var/file/42/1042/img/notice.pdf" title="[115.09.18]機車通行證抽籤結果">[115.09.18]機車通行證抽籤結果</a>
  </div></div></div>
</div>
<div class="mbox"><div class="mtitle">
  <a href="https://c039.pu.edu.tw/p/406-1072-73284,r13.php">暑修學生進校之收費規定</a>
</div><div class="mdate before">2026-07-01</div></div>
`;
  const titles = parseIwebLinks(html, 'https://acd.pu.edu.tw/p/403-1042-885-1.php').map(
    (row) => row.title,
  );
  expect(titles).toEqual(['選課公告', '[115.09.18]機車通行證抽籤結果', '暑修學生進校之收費規定']);
  expect(titles).not.toContain('行政單位');
  expect(titles).not.toContain('最新消息');
  expect(titles).not.toContain('教務Q&A');
});

test('iWeb links ignore homepage shortcut tiles that reuse mtitle markup', () => {
  const html = `
<div class="d-item d-title col-sm-12"><div class="mbox"><div class="mtitle">
  <a href="https://c030.pu.edu.tw/p/412-1063-5585.php">安心助學</a>
</div></div></div>
<div class="d-item"><div class="mtitle">
  <a href="https://osachc.pu.edu.tw/var/file/67/1067/img/map.pdf">校園無障礙地圖</a>
</div></div>`;
  expect(parseIwebLinks(html, 'https://osa.pu.edu.tw/')).toEqual([]);
});

test('iWeb table keeps dated PDF notices and drops section index links', () => {
  const html = `
<table class="listTB">
<tr><th>標題</th><th>日期</th></tr>
<tr><td><a href="/p/403-1059-719.php">各類通知</a></td><td>2026-10-06</td></tr>
<tr><td><a href="/var/file/59/1059/img/notice.pdf">復學申請時程</a></td><td>2026-10-06</td></tr>
<tr><td><a href="/p/405-1059-72811,c5205.php">彈性轉系事宜</a></td><td>2026-09-02</td></tr>
</table>`;
  const rows = parseIwebTable(html, 'https://dorac.pu.edu.tw/p/403-1059-719-1.php');
  expect(rows.map((row) => row.title)).toEqual(['復學申請時程', '彈性轉系事宜']);
  expect(rows[0].originalUrl).toContain('.pdf');
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
  expect(
    parseHtmlLinks(
      '<a href="https://alcat.pu.edu.tw/index_menu.php">系統通知</a>',
      'https://www.pu.edu.tw/',
    ),
  ).toEqual([]);
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

function fixture(name) {
  return fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
}

test('Providence Student Affairs news snapshot yields titles, dates and links', async () => {
  const html = fixture('pu-osa-news.html');
  const extracted = await extractFromHtml(html, {
    sourceId: 'pu-osa',
    office: '學務處',
    scope: 'office',
    listUrl: 'https://osa.pu.edu.tw/p/422-1111-1039.php',
    parsers: ['iwebTable', 'iwebLinks'],
  });
  expect(extracted.parser).toBe('iwebLinks');
  expect(extracted.items.length).toBeGreaterThanOrEqual(3);
  for (const item of extracted.items) {
    expect(item.title.length).toBeGreaterThan(4);
    expect(item.originalUrl).toMatch(/^https:\/\/osa.+\.pu\.edu\.tw\/p\/404-/);
    expect(item.publishedAt).toMatch(/^2026-/);
  }
  expect(extracted.items.map((item) => item.title)).not.toContain('最新消息');
  expect(extracted.items.map((item) => item.title)).not.toContain('單位願景');
});

test('Providence housing news snapshot yields titles, dates and links', async () => {
  const html = fixture('pu-dorm-news.html');
  const extracted = await extractFromHtml(html, {
    sourceId: 'pu-dorm',
    office: '住宿',
    scope: 'office',
    listUrl: 'https://osadorm.pu.edu.tw/p/403-1065-679-1.php',
    parsers: ['iwebTable', 'iwebLinks'],
  });
  expect(extracted.parser).toBe('iwebLinks');
  expect(extracted.items.length).toBeGreaterThanOrEqual(3);
  expect(extracted.items[0]).toMatchObject({
    title: '115學年度第1學期高教深耕計畫之公共服務學習方案開放申請',
    originalUrl: 'https://osadorm.pu.edu.tw/p/406-1065-75602,r679.php',
  });
  expect(extracted.items[0].publishedAt.startsWith('2026-10-06')).toBe(true);
  expect(extracted.items.map((item) => item.title)).not.toContain('單位願景');
  expect(extracted.items.map((item) => item.title)).not.toContain('校內訊息');
});
