'use strict';

const { fetchAssistantPois } = require('./assistantFetchers');

const text = (value) => typeof value === 'string' ? value.trim() : '';
const normalized = (value) => text(value).toLocaleLowerCase('zh-TW');
const time = (value) => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(text(value)) ? text(value) : null;

function hasCoordinates(poi) {
  return typeof poi.lat === 'number' && Number.isFinite(poi.lat) && Math.abs(poi.lat) <= 90 &&
    typeof poi.lng === 'number' && Number.isFinite(poi.lng) && Math.abs(poi.lng) <= 180;
}

async function readAssistantPois(schoolId) {
  const rows = await fetchAssistantPois(schoolId);
  return rows.map((row) => ({
    id: row.id, schoolId: row.schoolId, name: row.name,
    code: text(row.code), category: text(row.category), floor: text(row.floor),
    description: text(row.description),
    departments: Array.isArray(row.departments) ? row.departments.map(text).filter(Boolean) : [],
    aliases: Array.isArray(row.aliases) ? row.aliases.map(text).filter(Boolean) : [],
    lat: hasCoordinates(row) ? row.lat : null,
    lng: hasCoordinates(row) ? row.lng : null,
    openTime: time(row.openTime), closeTime: time(row.closeTime),
    openNow: null,
    cafeteriaId: text(row.cafeteriaId) || null,
  }));
}

function matchPois(pois, query, category) {
  const needle = normalized(query);
  if (!needle) return [];
  return pois.filter((poi) => !category || poi.category === category).map((poi) => {
    const names = [poi.id, poi.name, poi.code, ...poi.aliases].map(normalized).filter(Boolean);
    const details = [poi.description, ...poi.departments].map(normalized).filter(Boolean);
    const score = names.includes(needle) ? 3
      : names.some((name) => name.includes(needle) || needle.includes(name)) ? 2
        : details.some((detail) => detail.includes(needle)) ? 1 : 0;
    return { poi, score };
  }).filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.poi.name.localeCompare(b.poi.name, 'zh-Hant'))
    .map(({ poi }) => poi);
}

function resolvePoi(pois, id, query) {
  if (id) return { poi: pois.find((poi) => poi.id === id) || null, ambiguous: false };
  const matches = matchPois(pois, query);
  const exact = matches.filter((poi) => [poi.name, poi.code, ...poi.aliases].some((name) => normalized(name) === normalized(query)));
  const candidates = exact.length ? exact : matches;
  return { poi: candidates.length === 1 ? candidates[0] : null, ambiguous: candidates.length > 1 };
}

function walkingDirectionsUrl(from, to) {
  const params = new URLSearchParams({
    api: '1', origin: `${from.lat},${from.lng}`,
    destination: `${to.lat},${to.lng}`, travelmode: 'walking',
  });
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

module.exports = { readAssistantPois, hasCoordinates, matchPois, resolvePoi, walkingDirectionsUrl };
