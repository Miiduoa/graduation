'use strict';

const CATEGORIES = ['general', 'academic', 'event', 'emergency', 'system'];

function classifyAnnouncement(title, office = '') {
  const text = `${title} ${office}`;
  if (/停課|颱風|地震|緊急|疏散|警報|災/.test(text)) return 'emergency';
  if (/維修|資訊處|網路|系統中斷|資安/.test(text)) return 'system';
  if (/選課|加退選|成績|教務|招生|抵免|期末考|期中考/.test(text)) return 'academic';
  if (/活動|講座|迎新|畢典|社團|工作坊/.test(text)) return 'event';
  return 'general';
}

function summarizeAnnouncement(text, max = 110) {
  const compact = String(text || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!compact) return '';
  return compact.length <= max ? compact : `${compact.slice(0, max).trim()}…`;
}

module.exports = {
  CATEGORIES,
  classifyAnnouncement,
  summarizeAnnouncement,
};
