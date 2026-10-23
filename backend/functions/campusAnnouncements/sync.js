'use strict';

const { FieldValue, Timestamp } = require('firebase-admin/firestore');
const { schoolConfig, listSources, listSyncSchoolIds, SOURCE_UNAVAILABLE } = require('./catalog');
const { extractFromHtml, countDrop } = require('./extract');
const { politeFetch } = require('./politeFetch');
const { announcementDocId, isLoginPortalUrl } = require('./url');
const {
  parseAnnouncementDate,
  selectStudentAnnouncements,
  selectOfficialAnnouncements,
  tallyStudentWallFilter,
} = require('./quality');

const RETENTION_DAYS = 180;

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
    office: item.office || source.office,
    studentFeed: item.studentFeed !== false,
    audience: item.audience || 'student',
    path: schoolAnnouncementPath(source.schoolId, announcementDocId(source.schoolId, item.originalUrl)),
  }));
}

async function hideAnnouncementDoc(schoolId, doc) {
  assertSchoolScopedWrite(schoolId, doc.ref);
  await doc.ref.set(
    {
      studentFeed: false,
      visible: false,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}

function shouldHideLeftoverScrape(data, now = new Date()) {
  if (data.origin !== 'public_scrape') return false;
  const published = parseAnnouncementDate(data.publishedAt);
  if (!published) return false;
  return now.getTime() - new Date(published).getTime() > RETENTION_DAYS * 24 * 60 * 60 * 1000;
}

async function hideSourceAnnouncements(db, source, deps = {}) {
  if (isDryRun(deps) || !db) return;
  const snap = await announcementsCol(db, source.schoolId).where('sourceId', '==', source.sourceId).get();
  for (const doc of snap.docs || []) {
    const data = doc.data();
    if (data.origin !== 'public_scrape') continue;
    await hideAnnouncementDoc(source.schoolId, doc);
  }
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
    message: health.status === UNAVAILABLE ? SOURCE_UNAVAILABLE : '',
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
    source: item.office || source.office,
    office: item.office || source.office,
    scope: item.scope,
    category: item.category,
    publishedAt: item.publishedAt ? Timestamp.fromDate(new Date(item.publishedAt)) : null,
    pinned: false,
    visible: item.visible !== false,
    studentFeed: item.studentFeed !== false,
    audience: item.audience || 'student',
    rank: item.rank || 'normal',
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
    const parsedCount = extracted.parsedCount ?? extracted.items.length;
    const items = previewItems(source, extracted.items);
    if (parsedCount === 0 || countDrop(previous.itemCount, parsedCount)) {
      await writeHealth(db, source, {
        status: UNAVAILABLE,
        reason: parsedCount === 0 ? 'parse_empty' : 'count_drop',
        itemCount: parsedCount,
        parser: extracted.parser,
        fingerprint: extracted.fingerprint,
      }, deps);
      return {
        status: UNAVAILABLE,
        reason: parsedCount === 0 ? 'parse_empty' : 'count_drop',
        itemCount: parsedCount,
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
        if (!keep.has(doc.id) && shouldHideLeftoverScrape(doc.data() || {}, new Date())) {
          await hideAnnouncementDoc(source.schoolId, doc);
        }
      }
    }
    await writeHealth(db, source, {
      status: HEALTHY,
      reason: '',
      itemCount: parsedCount,
      parser: extracted.parser,
      fingerprint: extracted.fingerprint,
      lastSuccessAt: Timestamp.now(),
    }, deps);
    return {
      status: HEALTHY,
      itemCount: parsedCount,
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

function schoolFilterTally(results, now) {
  const items = (results || []).flatMap((item) => item.items || []);
  return tallyStudentWallFilter(items, results, now);
}

async function syncSchool(schoolId, deps = {}) {
  const school = schoolConfig(schoolId);
  if (!school) return { schoolId, status: UNAVAILABLE, sources: [], fetched: 0, written: 0 };
  if (!school.sources.length) {
    return {
      schoolId,
      status: UNAVAILABLE,
      reason: 'no_public_sources',
      sources: [],
      fetched: 0,
      written: 0,
    };
  }
  const results = [];
  for (const source of listSources(schoolId)) {
    try {
      results.push({
        sourceId: source.sourceId,
        office: source.office,
        ...(await syncSource(source, deps)),
      });
    } catch (error) {
      const reason = error.message || 'sync_failed';
      console.error(`Announcement sync skipped ${schoolId}/${source.sourceId}: ${reason}`);
      results.push({
        sourceId: source.sourceId,
        office: source.office,
        status: UNAVAILABLE,
        reason,
        itemCount: 0,
        items: [],
        dryRun: isDryRun(deps),
      });
    }
  }
  const healthy = results.filter((item) => item.status === HEALTHY);
  const items = results.flatMap((item) => item.items || []);
  const fetched = results.reduce((sum, item) => sum + (item.itemCount || 0), 0);
  const written = isDryRun(deps)
    ? 0
    : results.filter((item) => item.status === HEALTHY).reduce((sum, item) => sum + (item.itemCount || 0), 0);
  return {
    schoolId,
    status: healthy.length ? HEALTHY : UNAVAILABLE,
    sources: results,
    fetched,
    written,
    studentWallCount: selectStudentAnnouncements(items, results).length,
    officialCount: selectOfficialAnnouncements(items, results).length,
    filterTally: schoolFilterTally(results),
  };
}

async function syncConfiguredSchools(deps = {}) {
  const schoolIds =
    Array.isArray(deps.schoolIds) && deps.schoolIds.length ? deps.schoolIds : listSyncSchoolIds();
  const results = [];
  for (const schoolId of schoolIds) {
    try {
      results.push(await syncSchool(schoolId, deps));
    } catch (error) {
      const reason = error.message || 'sync_failed';
      console.error(`Announcement sync skipped ${schoolId}: ${reason}`);
      results.push({
        schoolId,
        status: UNAVAILABLE,
        reason,
        sources: [],
        fetched: 0,
        written: 0,
      });
    }
  }
  return results;
}

function visibleAnnouncements(rows, sources, now) {
  return selectStudentAnnouncements(rows, sources, now);
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
  isDryRun,
  schoolAnnouncementPath,
  assertSchoolScopedWrite,
  RETENTION_DAYS,
  previewItems,
  shouldHideLeftoverScrape,
  syncSource,
  syncSchool,
  syncConfiguredSchools,
  hideSourceAnnouncements,
  visibleAnnouncements,
  feedStatus,
};
