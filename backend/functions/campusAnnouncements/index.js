'use strict';

const catalog = require('./catalog');
const { syncSource, syncSchool, visibleAnnouncements, feedStatus } = require('./sync');
const { extractFromHtml } = require('./extract');
const { runParser } = require('./parsers');
const { normalizeAnnouncementUrl } = require('./url');

module.exports = {
  ...catalog,
  syncSource,
  syncSchool,
  visibleAnnouncements,
  feedStatus,
  extractFromHtml,
  runParser,
  normalizeAnnouncementUrl,
};
