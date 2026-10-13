'use strict';

const { FieldValue, Timestamp } = require('firebase-admin/firestore');
const { schoolConfig, listSources, allSources, SOURCE_DOWN_EMPTY } = require('./catalog');
const { extractFromHtml, countDrop } = require('./extract');
const { politeFetch } = require('./politeFetch');
const { announcementDocId, isLoginPortalUrl } = require('./url');

const UNAVAILABLE = 'unavailable';
const HEALTHY = 'healthy';

function isDryRun(deps) {
  return deps?.dryRun === true;
}

function schoolAnnouncementPath(schoolId, docId) {
  return `schools/${schoolId}/announcements/${docId}`;
}

function assertSchoolScopedWrite(schoolId, ref) {
  const path = String(ref?.path || '');
  const announcementsPrefix = `schools/${schoolId}/announcements`;
  const healthPrefix = `schools/${schoolId}/announcement-sources`;
  if (path === announcementsPrefix || path.startsWith(`${announcementsPrefix}/`)) return;
  if (path === healthPrefix || path.startsWith(`${healthPrefix}/`)) return;
  throw new Error(`Announcement sync refused to write ${path || '(missing path)'}`);
}

function sourceRef(db, source) {
  const ref = db.collection('schools').doc(source.schoolId).collection('announcement-sources').doc(source.sourceId);
  assertSchoolScopedWrite(source.schoolId, ref);
  return ref;
}

function announcementsCol(db, schoolId) {
  return db.collection('schools').doc(schoolId).collection('announcements');
}

function previewItems(source, items) {
  return (items || []).map((item) => ({
    id: announcementDocId(source.schoolId, item.originalUrl),
    schoolId: source.schoolId,
    sourceId: source.sourceId,
    title: item.title,
    summary: item.summary,
    originalUrl: item.originalUrl,
    publishedAt: item.publishedAt || null,
    office: source.office,
    path: schoolAnnouncementPath(source.schoolId, announcementDocId(source.schoolId, item.originalUrl)),
  }));
}

async function hideSourceAnnouncements(db, source, deps = {}) {
  if (isDryRun(deps) || !db) return;
  const snap = await announcementsCol(db, source.schoolId).where('sourceId', '==', source.sourceId).get();
  const batch = db.batch ? db.batch() : null;
  const writes = [];
  for (const doc of snap.docs || []) {
    const data = doc.data();
    if (data.origin !== 'public_scrape') continue;
    assertSchoolScopedWrite(source.schoolId, doc.ref);
    if (batch) batch.delete(doc.ref);
    else writes.push(doc.ref.delete());
  }
  if (batch && (snap.docs || []).length) await batch.commit();
  else await Promise.all(writes);
}

async function writeHealth(db, source, health, deps = {}) {
  const payload = {
    schoolId: source.schoolId,
    sourceId: source.sourceId,
    office: source.office,
    scope: source.scope,
    kind: source.kind,
    listUrl: source.listUrl,
    parsers: source.parsers,
    status: health.status,
    reason: health.reason || '',
    itemCount: health.itemCount || 0,
    parser: health.parser || '',
    fingerprint: health.fingerprint || '',
    lastCheckedAt: FieldValue.serverTimestamp(),
    message: health.status === UNAVAILABLE ? SOURCE_DOWN_EMPTY : '',
  };
  if (health.lastSuccessAt) payload.lastSuccessAt = health.lastSuccessAt;
  if (isDryRun(deps) || !db) return;
  await sourceRef(db, source).set(payload, { merge: true });
}

async function fetchSourceHtml(source, deps) {
  const response = await politeFetch(source.listUrl, {
    fetchImpl: deps.fetchImpl,
    now: deps.now,
    wait: deps.wait,
    rateLimitMs: source.rateLimitMs,
    etag: deps.etag,
    lastModified: deps.lastModified,
  });
  if (response.status === 304) return { notModified: true, response };
  if (!response.ok) {
    const error = new Error(`http_${response.status}`);
    error.code = 'http_error';
    throw error;
  }
  const html = await response.text();
  return { html, response };
}

async function writeAnnouncement(db, source, item, deps = {}) {
  if (isDryRun(deps) || !db) return announcementDocId(source.schoolId, item.originalUrl);
  const id = announcementDocId(source.schoolId, item.originalUrl);
  const ref = announcementsCol(db, source.schoolId).doc(id);
  assertSchoolScopedWrite(source.schoolId, ref);
  await ref.set({
    schoolId: source.schoolId,
    sourceId: source.sourceId,
    origin: 'public_scrape',
    title: item.title,
    body: item.body,
    summary: item.summary,
    originalUrl: item.originalUrl,
    source: source.office,
    office: source.office,
    scope: item.scope,
    category: item.category,
    publishedAt: item.publishedAt ? Timestamp.fromDate(new Date(item.publishedAt)) : Timestamp.now(),
    pinned: false,
    visible: true,
    updatedAt: FieldValue.serverTimestamp(),
  });
  return id;
}

async function syncSource(source, deps = {}) {
  const db = deps.db;
  const dryRun = isDryRun(deps);
  if (!dryRun && !db) throw new Error('Announcement sync requires Firestore');
  if (isLoginPortalUrl(source.listUrl)) {
    await writeHealth(db, source, { status: UNAVAILABLE, reason: 'login_portal', itemCount: 0 }, deps);
    await hideSourceAnnouncements(db, source, deps);
    return { status: UNAVAILABLE, reason: 'login_portal', itemCount: 0, items: [], dryRun };
  }
  const previous = deps.previousHealth || {};
  try {
    const fetched = await fetchSourceHtml(source, deps);
    if (fetched.notModified && previous.status === HEALTHY) {
      await writeHealth(db, source, {
        status: HEALTHY,
        reason: 'not_modified',
        itemCount: previous.itemCount || 0,
        parser: previous.parser,
        fingerprint: previous.fingerprint,
        lastSuccessAt: previous.lastSuccessAt || Timestamp.now(),
      }, deps);
      return {
        status: HEALTHY,
        reason: 'not_modified',
        itemCount: previous.itemCount || 0,
        items: [],
        dryRun,
      };
    }
    const extracted = await extractFromHtml(fetched.html, source);
    const items = previewItems(source, extracted.items);
    if (
      extracted.items.length === 0 ||
      countDrop(previous.itemCount, extracted.items.length)
    ) {
      await writeHealth(db, source, {
        status: UNAVAILABLE,
        reason: extracted.items.length === 0 ? 'parse_empty' : 'count_drop',
        itemCount: extracted.items.length,
        parser: extracted.parser,
        fingerprint: extracted.fingerprint,
      }, deps);
      return {
        status: UNAVAILABLE,
        reason: extracted.items.length === 0 ? 'parse_empty' : 'count_drop',
        itemCount: extracted.items.length,
        items,
        dryRun,
      };
    }
    const keep = new Set();
    for (const item of extracted.items) {
      keep.add(await writeAnnouncement(db, source, item, deps));
    }
    if (!dryRun) {
      const existing = await announcementsCol(db, source.schoolId)
        .where('sourceId', '==', source.sourceId)
        .get();
      for (const doc of existing.docs || []) {
        if (!keep.has(doc.id) && doc.data().origin === 'public_scrape') {
          assertSchoolScopedWrite(source.schoolId, doc.ref);
          await doc.ref.delete();
        }
      }
    }
    await writeHealth(db, source, {
      status: HEALTHY,
      reason: '',
      itemCount: extracted.items.length,
      parser: extracted.parser,
      fingerprint: extracted.fingerprint,
      lastSuccessAt: Timestamp.now(),
    }, deps);
    return {
      status: HEALTHY,
      itemCount: extracted.items.length,
      parser: extracted.parser,
      items,
      dryRun,
    };
  } catch (error) {
    await writeHealth(db, source, {
      status: UNAVAILABLE,
      reason: error.code || error.message || 'fetch_failed',
      itemCount: 0,
    }, deps);
    return {
      status: UNAVAILABLE,
      reason: error.code || error.message || 'fetch_failed',
      itemCount: 0,
      items: [],
      dryRun,
    };
  }
}

async function syncSchool(schoolId, deps = {}) {
  const school = schoolConfig(schoolId);
  if (!school) return { schoolId, status: UNAVAILABLE, sources: [] };
  if (!school.sources.length) {
    return { schoolId, status: UNAVAILABLE, reason: 'no_public_sources', sources: [] };
  }
  const results = [];
  for (const source of listSources(schoolId)) {
    results.push({ sourceId: source.sourceId, office: source.office, ...(await syncSource(source, deps)) });
  }
  const healthy = results.filter((item) => item.status === HEALTHY);
  return {
    schoolId,
    status: healthy.length ? HEALTHY : UNAVAILABLE,
    sources: results,
  };
}

async function syncConfiguredSchools(deps = {}) {
  const bySchool = new Map();
  for (const source of allSources()) {
    if (!bySchool.has(source.schoolId)) bySchool.set(source.schoolId, []);
    bySchool.get(source.schoolId).push(source);
  }
  const results = [];
  for (const schoolId of bySchool.keys()) {
    results.push(await syncSchool(schoolId, deps));
  }
  return results;
}

function visibleAnnouncements(rows, _sources) {
  return (rows || []).filter((row) => row.visible !== false);
}

function feedStatus(announcements, sources) {
  const listed = sources || [];
  if (listed.length && listed.every((item) => item.status === UNAVAILABLE) && announcements.length === 0) {
    return { status: UNAVAILABLE, message: SOURCE_DOWN_EMPTY };
  }
  return { status: 'ready', message: '' };
}

module.exports = {
  HEALTHY,
  UNAVAILABLE,
  isDryRun,
  schoolAnnouncementPath,
  assertSchoolScopedWrite,
  previewItems,
  syncSource,
  syncSchool,
  syncConfiguredSchools,
  hideSourceAnnouncements,
  visibleAnnouncements,
  feedStatus,
};
