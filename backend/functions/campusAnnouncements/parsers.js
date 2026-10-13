'use strict';

const xml2js = require('xml2js');
const { decodeHtml, normalizeAnnouncementUrl, parseDate, isLoginPortalUrl } = require('./url');

const TITLE_MIN = 4;
const TITLE_MAX = 180;

function usableTitle(value) {
  const title = decodeHtml(value).replace(/^【.*?】/, '').trim() || decodeHtml(value);
  if (title.length < TITLE_MIN || title.length > TITLE_MAX) return '';
  if (/^https?:/i.test(title)) return '';
  if (/^(home|more|more\.\.\.|下一頁|上一頁|回首頁|English|RSS)$/i.test(title)) return '';
  return title;
}

const IWEB_ARTICLE_HREF = /\/p\/(?:405|406)-\d+-\d+,[cr]\d+/i;
const IWEB_SECTION_HREF = /\/p\/403-\d+(?:-\d+)*/i;
const IWEB_DOC_HREF = /\/p\/(?:404|412|405|406)-\d+/i;
const NAV_CONTEXT_RE =
  /dropdown-menu|\bhdmenu\b|\bnavbar-nav\b|\bcgmenu\b|\bmnavbar\b|\btopnav\b|\bbreadcrumb\b|list-group-item\s+dropdown|\bHln_|\bMenu_|\bCgl_/i;
const NAV_TITLES = new Set([
  '行政單位',
  '教學單位',
  '最新消息',
  '各類通知',
  '教育部公告',
  '單位願景',
  '業務簡介',
  '學務長簡介',
  '歷任學務長',
  '業務執掌',
  '業務職掌',
  '組織架構',
  '組織架構圖',
  '組織沿革',
  '章則辦法',
  '表單下載',
  '校園景緻',
  '校內訊息',
  '校外訊息',
  '交通資訊',
  '校內商店',
  '公益捐贈',
  '來文轉知',
  '校園安全',
  '資安通告',
  '軟體服務',
  '網路服務',
  '電話服務',
  '電腦教室使用',
  '校務行政服務',
  '回首頁',
]);

function looksLikeNavTitle(title) {
  const compact = String(title || '').replace(/\s+/g, '');
  if (NAV_TITLES.has(title) || NAV_TITLES.has(compact)) return true;
  return compact.length <= 12 && /(簡介|願景|架構|沿革|執掌|職掌|成員)$/.test(compact);
}

function contextBefore(html, index, size) {
  return String(html).slice(Math.max(0, index - size), index);
}

function inNewsList(html, index) {
  const source = String(html);
  const marker = Math.max(
    source.lastIndexOf('pageptlist', index),
    source.lastIndexOf('listTB', index),
    source.lastIndexOf('page_mobilercglist', index),
  );
  if (marker >= 0 && index - marker < 200000 && !NAV_CONTEXT_RE.test(source.slice(marker, index))) {
    return true;
  }
  return /class=["'][^"']*\bmdate\b/.test(contextBefore(html, index, 220));
}

function isNavContext(html, index) {
  if (inNewsList(html, index)) return false;
  return NAV_CONTEXT_RE.test(contextBefore(html, index, 480));
}

function takeItem(baseUrl, href, title, dateText, summary, options = {}) {
  const originalUrl = normalizeAnnouncementUrl(href, baseUrl);
  const cleanTitle = usableTitle(title);
  if (!originalUrl || !cleanTitle || isLoginPortalUrl(originalUrl)) return null;
  if (/\.(jpe?g|png|gif|zip|docx?)(?:$|[?#])/i.test(originalUrl)) return null;
  if (/\.pdf(?:$|[?#])/i.test(originalUrl) && !options.allowAttachment) return null;
  return {
    title: cleanTitle,
    originalUrl,
    publishedAt: parseDate(dateText),
    summary: decodeHtml(summary).slice(0, 160),
  };
}

function parseIwebTable(html, baseUrl) {
  const rows = [];
  const tableRows = String(html || '').match(/<tr[\s\S]*?<\/tr>/gi) || [];
  for (const row of tableRows) {
    const link = row.match(
      /<a[^>]+href=["']([^"']+)["'][^>]*(?:title=["']([^"']+)["'])?[^>]*>([\s\S]*?)<\/a>/i,
    );
    if (!link || IWEB_SECTION_HREF.test(link[1])) continue;
    const title = link[2] || link[3].replace(/<[^>]+>/g, ' ');
    if (looksLikeNavTitle(usableTitle(title) || title)) continue;
    const dateMatch = row.match(/20\d{2}[./-]\d{1,2}[./-]\d{1,2}|\d{2,3}[./年]\d{1,2}[./月]\d{1,2}/);
    const item = takeItem(baseUrl, link[1], title, dateMatch?.[0], '', { allowAttachment: true });
    if (item) rows.push(item);
  }
  return dedupe(rows);
}

function parseIwebLinks(html, baseUrl) {
  const rows = [];
  const re =
    /<a[^>]+href=["']([^"']+)["'][^>]*(?:title=["']([^"']+)["'])?[^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = re.exec(html))) {
    const href = match[1];
    if (IWEB_SECTION_HREF.test(href)) continue;
    if (!IWEB_DOC_HREF.test(href) && !/\.pdf(?:$|[?#])/i.test(href)) continue;
    const news = inNewsList(html, match.index);
    if (!news && isNavContext(html, match.index)) continue;
    const title = match[2] || match[3].replace(/<[^>]+>/g, ' ');
    const clean = usableTitle(title);
    if (!clean || (!news && looksLikeNavTitle(clean))) continue;
    const article = IWEB_ARTICLE_HREF.test(href);
    const nearby = String(html).slice(Math.max(0, match.index - 80), match.index + match[0].length + 120);
    const dateMatch = nearby.match(/20\d{2}[./-]\d{1,2}[./-]\d{1,2}/);
    if (!news && !article && !dateMatch) continue;
    const item = takeItem(baseUrl, href, title, dateMatch?.[0], '', { allowAttachment: news });
    if (item) rows.push(item);
  }
  return dedupe(rows);
}

function parseRpageList(html, baseUrl) {
  const rows = [];
  const re =
    /<a[^>]+href=["']([^"']*(?:news|News|bulletin|announce|nid=|news_id=|\/p\/406-)[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = re.exec(html))) {
    const nearby = String(html).slice(Math.max(0, match.index - 60), match.index + match[0].length + 160);
    const dateMatch = nearby.match(/20\d{2}[./-]\d{1,2}[./-]\d{1,2}/);
    const item = takeItem(baseUrl, match[1], match[2].replace(/<[^>]+>/g, ' '), dateMatch?.[0], '');
    if (item) rows.push(item);
  }
  return dedupe(rows);
}

function parseHtmlLinks(html, baseUrl) {
  const rows = [];
  const re = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = re.exec(html))) {
    const href = match[1];
    const title = match[2].replace(/<[^>]+>/g, ' ');
    if (!/news|bulletin|announce|notice|最新|公告|消息|412-|405-|406-/i.test(`${href} ${title}`))
      continue;
    const nearby = String(html).slice(Math.max(0, match.index - 40), match.index + match[0].length + 100);
    const dateMatch = nearby.match(/20\d{2}[./-]\d{1,2}[./-]\d{1,2}/);
    const item = takeItem(baseUrl, href, title, dateMatch?.[0], '');
    if (item) rows.push(item);
  }
  return dedupe(rows);
}

async function parseRss(xml, baseUrl) {
  let parsed;
  try {
    parsed = await xml2js.parseStringPromise(xml, { explicitArray: false, ignoreAttrs: false });
  } catch {
    return [];
  }
  const items = [];
  const rssItems = parsed?.rss?.channel?.item;
  const atomItems = parsed?.feed?.entry;
  const list = [].concat(rssItems || []).concat(atomItems || []).filter(Boolean);
  for (const entry of list) {
    const linkValue = entry.link;
    const link =
      typeof linkValue === 'string'
        ? linkValue
        : linkValue?.$?.href || linkValue?.href || entry.guid?._ || entry.id;
    const item = takeItem(
      baseUrl,
      link,
      entry.title?._ || entry.title,
      entry.pubDate || entry.published || entry.updated,
      entry.description?._ || entry.summary?._ || entry.description || '',
    );
    if (item) items.push(item);
  }
  return dedupe(items);
}

function dedupe(rows) {
  const seen = new Set();
  const result = [];
  for (const row of rows) {
    if (seen.has(row.originalUrl)) continue;
    seen.add(row.originalUrl);
    result.push(row);
  }
  return result;
}

const PARSERS = {
  iwebTable: parseIwebTable,
  iwebLinks: parseIwebLinks,
  rpageList: parseRpageList,
  htmlLinks: parseHtmlLinks,
  rss: parseRss,
};

async function runParser(name, html, baseUrl) {
  const parser = PARSERS[name];
  if (!parser) return [];
  return parser(html, baseUrl);
}

module.exports = {
  PARSERS,
  runParser,
  parseIwebTable,
  parseIwebLinks,
  parseRpageList,
  parseHtmlLinks,
  parseRss,
  looksLikeNavTitle,
};
