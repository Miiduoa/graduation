'use strict';

const { parseArgs } = require('node:util');
const { schoolConfig, listSources, listSyncSchoolIds } = require('./catalog');
const { syncSchool, syncConfiguredSchools } = require('./sync');
const { STUDENT_WALL_DROP_REASON_LABELS } = require('./quality');

function isWriteEnabled(env = process.env) {
  return String(env.CAMPUS_ANNOUNCEMENT_SYNC_ENABLED || '').trim().toLowerCase() === 'true';
}

function parseCli(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      school: { type: 'string' },
      all: { type: 'boolean', default: false },
      write: { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
    },
    strict: true,
    allowPositionals: false,
  });
  const schoolId = String(values.school || '').trim();
  const all = values.all === true;
  if (!all && !schoolId) {
    throw new Error('請指定 --school（例如 --school pu）或 --all');
  }
  const write = values.write === true && values['dry-run'] !== true;
  return {
    schoolId,
    all,
    write,
    dryRun: !write,
  };
}

function labeledTally(tally) {
  if (!tally) return null;
  const dropped = {};
  for (const [reason, label] of Object.entries(STUDENT_WALL_DROP_REASON_LABELS)) {
    dropped[label] = tally[reason] || 0;
  }
  return {
    input: tally.input || 0,
    kept: tally.kept || 0,
    dropped,
  };
}

function latestStudentItem(sourceRows) {
  const items = (sourceRows || []).flatMap((item) => item.items || []);
  const dated = items
    .filter((row) => row.studentFeed !== false && row.publishedAt)
    .sort((left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt));
  const first = dated[0];
  return first ? { title: first.title, publishedAt: first.publishedAt } : null;
}

function summarize(result) {
  const latest = latestStudentItem(result.sources);
  return {
    school: result.schoolId,
    schoolId: result.schoolId,
    status: result.status,
    reason: result.reason || '',
    dryRun: result.sources?.some((item) => item.dryRun) ?? true,
    fetched: result.fetched ?? (result.sources || []).reduce((sum, item) => sum + (item.itemCount || 0), 0),
    written: result.written ?? 0,
    studentWallCount: result.studentWallCount ?? 0,
    officialCount: result.officialCount ?? 0,
    latestTitle: latest?.title || '',
    latestDate: latest?.publishedAt || '',
    skipReason: result.reason || '',
    filterTally: labeledTally(result.filterTally),
    sources: (result.sources || []).map((item) => ({
      sourceId: item.sourceId,
      office: item.office,
      status: item.status,
      reason: item.reason || '',
      itemCount: item.itemCount || 0,
      parser: item.parser || '',
      items: (item.items || []).map((row) => ({
        id: row.id,
        title: row.title,
        originalUrl: row.originalUrl,
        publishedAt: row.publishedAt,
        office: row.office,
        studentFeed: row.studentFeed,
        path: row.path,
      })),
    })),
  };
}

function assertCanWrite(options, deps) {
  const env = deps.env || process.env;
  if (options.write && !isWriteEnabled(env)) {
    throw new Error('寫入已關閉。設 CAMPUS_ANNOUNCEMENT_SYNC_ENABLED=true 才會寫入 schools/{schoolId}/announcements。');
  }
  if (options.write && typeof deps.getDb === 'function') {
    deps.db = deps.db || deps.getDb();
  } else if (options.write && !deps.db) {
    throw new Error('寫入需要 Firestore');
  }
}

async function runCli(argv, deps = {}) {
  const options = parseCli(argv);
  if (options.all) {
    assertCanWrite(options, deps);
    const results = await syncConfiguredSchools({
      ...deps,
      dryRun: options.dryRun,
      db: options.dryRun ? undefined : deps.db,
      schoolIds: listSyncSchoolIds(),
    });
    return results.map((result) => summarize(result));
  }
  const school = schoolConfig(options.schoolId);
  if (!school) {
    throw new Error(`沒有這間學校的公告來源設定：${options.schoolId}`);
  }
  if (!listSources(options.schoolId).length) {
    throw new Error(`${options.schoolId} 沒有可抓的公開公告來源`);
  }
  assertCanWrite(options, deps);
  const result = await syncSchool(options.schoolId, {
    ...deps,
    dryRun: options.dryRun,
    db: options.dryRun ? undefined : deps.db,
  });
  return summarize({ ...result, schoolId: options.schoolId });
}

function getAdminDb() {
  const { initializeApp, getApps, applicationDefault } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  const app =
    getApps()[0] ||
    initializeApp({
      credential: applicationDefault(),
      projectId: process.env.FIREBASE_PROJECT_ID || 'campus-one-tw',
    });
  return getFirestore(app);
}

async function main() {
  const summary = await runCli(process.argv.slice(2), { getDb: getAdminDb });
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  });
}

module.exports = {
  isWriteEnabled,
  parseCli,
  runCli,
  summarize,
};
