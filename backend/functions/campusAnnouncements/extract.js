'use strict';

const { runParser } = require('./parsers');
const { htmlFingerprint } = require('./url');
const { classifyAnnouncement, summarizeAnnouncement } = require('./classify');

async function extractFromHtml(html, source) {
  const parsers = Array.isArray(source.parsers) && source.parsers.length ? source.parsers : ['htmlLinks'];
  let items = [];
  let used = '';
  for (const name of parsers) {
    const rows = await runParser(name, html, source.listUrl);
    if (rows.length > 0) {
      items = rows;
      used = name;
      break;
    }
  }
  return {
    items: items.map((item) => ({
      ...item,
      sourceId: source.sourceId,
      office: source.office,
      scope: source.scope,
      category: classifyAnnouncement(item.title, source.office),
      summary: item.summary || summarizeAnnouncement(item.title),
      body: summarizeAnnouncement(item.summary || item.title),
    })),
    parser: used || parsers[0],
    fingerprint: htmlFingerprint(html),
  };
}

function countDrop(previousCount, nextCount) {
  if (!previousCount || previousCount < 4) return false;
  return nextCount < Math.max(1, Math.floor(previousCount * 0.4));
}

module.exports = {
  extractFromHtml,
  countDrop,
};
