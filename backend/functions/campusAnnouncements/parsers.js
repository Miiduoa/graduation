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

function takeItem(baseUrl, href, title, dateText, summary) {
  const originalUrl = normalizeAnnouncementUrl(href, baseUrl);
  const cleanTitle = usableTitle(title);
  if (!originalUrl || !cleanTitle || isLoginPortalUrl(originalUrl)) return null;
  if (/\.(pdf|jpe?g|png|gif|zip|docx?)$/i.test(originalUrl)) return null;
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
      /<a[^>]+href=["']([^"']*(?:412-|405-|403-|406-)[^"']*)["'][^>]*>([\s\S]*?)<\/a>/i,
    );
    if (!link) continue;
    const dateMatch = row.match(/20\d{2}[./-]\d{1,2}[./-]\d{1,2}|\d{2,3}[./年]\d{1,2}[./月]\d{1,2}/);
    const item = takeItem(baseUrl, link[1], link[2].replace(/<[^>]+>/g, ' '), dateMatch?.[0], '');
    if (item) rows.push(item);
  }
  return dedupe(rows);
}

function parseIwebLinks(html, baseUrl) {
  const rows = [];
  const re =
    /<a[^>]+href=["']([^"']*(?:\/p\/(?:412|405|403|406)-)[^"']*)["'][^>]*(?:title=["']([^"']+)["'])?[^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = re.exec(html))) {
    const nearby = String(html).slice(Math.max(0, match.index - 80), match.index + match[0].length + 120);
    const dateMatch = nearby.match(/20\d{2}[./-]\d{1,2}[./-]\d{1,2}/);
    const item = takeItem(baseUrl, match[1], match[2] || match[3].replace(/<[^>]+>/g, ' '), dateMatch?.[0], '');
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
};
