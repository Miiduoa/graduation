'use strict';

const catalog = require('./catalog');
const { syncSource, syncSchool, visibleAnnouncements, feedStatus } = require('./sync');
const { extractFromHtml } = require('./extract');
const { runParser } = require('./parsers');
const { normalizeAnnouncementUrl } = require('./url');
const { parseCli, runCli } = require('./cli');

module.exports = {
  ...catalog,
  syncSource,
  syncSchool,
  visibleAnnouncements,
  feedStatus,
  extractFromHtml,
  runParser,
  normalizeAnnouncementUrl,
  parseCli,
  runCli,
};
