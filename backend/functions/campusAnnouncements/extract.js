'use strict';

const { runParser } = require('./parsers');
const { htmlFingerprint } = require('./url');
const { classifyAnnouncement, summarizeAnnouncement } = require('./classify');
const { announcementQualityFlags } = require('./quality');

async function extractFromHtml(html, source, now = new Date()) {
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
    parsedCount: items.length,
    items: items.map((item) => {
      const flags = announcementQualityFlags(
        {
          title: item.rawTitle || item.title,
          publishedAt: item.publishedAt,
          office: item.office,
          schoolId: source.schoolId,
          sourceOffice: source.office,
        },
        now,
      );
      const office = flags.office;
      return {
        ...item,
        title: flags.title || item.title,
        publishedAt: flags.publishedAt || '',
        sourceId: source.sourceId,
        office,
        scope: source.scope,
        category: classifyAnnouncement(flags.title || item.title, office),
        summary: item.summary || summarizeAnnouncement(flags.title || item.title),
        body: summarizeAnnouncement(item.summary || flags.title || item.title),
        audience: flags.audience,
        studentFeed: flags.studentFeed,
        rank: flags.rank,
        visible: flags.visible,
      };
    }),
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
