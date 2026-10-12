'use strict';

const { FieldValue, Timestamp } = require('firebase-admin/firestore');
const { schoolConfig, listSources, allSources, SOURCE_UNAVAILABLE } = require('./catalog');
const { extractFromHtml, countDrop } = require('./extract');
const { politeFetch } = require('./politeFetch');
const { announcementDocId, isLoginPortalUrl } = require('./url');

const UNAVAILABLE = 'unavailable';
const HEALTHY = 'healthy';

function sourceRef(db, source) {
  return db.collection('schools').doc(source.schoolId).collection('announcement-sources').doc(source.sourceId);
}

function announcementsCol(db, schoolId) {
  return db.collection('schools').doc(schoolId).collection('announcements');
}

async function hideSourceAnnouncements(db, source) {
  const snap = await announcementsCol(db, source.schoolId).where('sourceId', '==', source.sourceId).get();
  const batch = db.batch ? db.batch() : null;
  const writes = [];
  for (const doc of snap.docs || []) {
    const data = doc.data();
    if (data.origin !== 'public_scrape') continue;
    if (batch) batch.delete(doc.ref);
    else writes.push(doc.ref.delete());
  }
  if (batch && (snap.docs || []).length) await batch.commit();
  else await Promise.all(writes);
}

async function writeHealth(db, source, health) {
  await sourceRef(db, source).set(
    {
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
      lastSuccessAt: health.lastSuccessAt || null,
      lastCheckedAt: FieldValue.serverTimestamp(),
      message: health.status === UNAVAILABLE ? SOURCE_UNAVAILABLE : '',
    },
    { merge: true },
  );
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

async function syncSource(source, deps = {}) {
  const db = deps.db;
  if (!db) throw new Error('Announcement sync requires Firestore');
  if (isLoginPortalUrl(source.listUrl)) {
    await writeHealth(db, source, { status: UNAVAILABLE, reason: 'login_portal', itemCount: 0 });
    await hideSourceAnnouncements(db, source);
    return { status: UNAVAILABLE, reason: 'login_portal', itemCount: 0 };
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
      });
      return { status: HEALTHY, reason: 'not_modified', itemCount: previous.itemCount || 0 };
    }
    const extracted = await extractFromHtml(fetched.html, source);
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
      });
      await hideSourceAnnouncements(db, source);
      return {
        status: UNAVAILABLE,
        reason: extracted.items.length === 0 ? 'parse_empty' : 'count_drop',
        itemCount: extracted.items.length,
      };
    }
    const keep = new Set();
    for (const item of extracted.items) {
      const id = announcementDocId(source.schoolId, item.originalUrl);
      keep.add(id);
      await announcementsCol(db, source.schoolId)
        .doc(id)
        .set({
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
    }
    const existing = await announcementsCol(db, source.schoolId)
      .where('sourceId', '==', source.sourceId)
      .get();
    for (const doc of existing.docs || []) {
      if (!keep.has(doc.id) && doc.data().origin === 'public_scrape') await doc.ref.delete();
    }
    await writeHealth(db, source, {
      status: HEALTHY,
      reason: '',
      itemCount: extracted.items.length,
      parser: extracted.parser,
      fingerprint: extracted.fingerprint,
      lastSuccessAt: Timestamp.now(),
    });
    return { status: HEALTHY, itemCount: extracted.items.length, parser: extracted.parser };
  } catch (error) {
    await writeHealth(db, source, {
      status: UNAVAILABLE,
      reason: error.code || error.message || 'fetch_failed',
      itemCount: 0,
    });
    await hideSourceAnnouncements(db, source);
    return { status: UNAVAILABLE, reason: error.code || error.message || 'fetch_failed', itemCount: 0 };
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

function visibleAnnouncements(rows, sources) {
  const hidden = new Set(
    (sources || []).filter((item) => item.status === UNAVAILABLE).map((item) => item.sourceId),
  );
  return (rows || []).filter((row) => {
    if (row.visible === false) return false;
    if (row.origin === 'public_scrape' && row.sourceId && hidden.has(row.sourceId)) return false;
    return true;
  });
}

function feedStatus(announcements, sources) {
  const listed = sources || [];
  if (listed.length && listed.every((item) => item.status === UNAVAILABLE) && announcements.length === 0) {
    return { status: UNAVAILABLE, message: SOURCE_UNAVAILABLE };
  }
  return { status: 'ready', message: '' };
}

module.exports = {
  HEALTHY,
  UNAVAILABLE,
  syncSource,
  syncSchool,
  syncConfiguredSchools,
  hideSourceAnnouncements,
  visibleAnnouncements,
  feedStatus,
};
