'use strict';

const { parseArgs } = require('node:util');
const { schoolConfig, listSources } = require('./catalog');
const { syncSchool } = require('./sync');

function isWriteEnabled(env = process.env) {
  return String(env.CAMPUS_ANNOUNCEMENT_SYNC_ENABLED || '').trim().toLowerCase() === 'true';
}

function parseCli(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      school: { type: 'string' },
      write: { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
    },
    strict: true,
    allowPositionals: false,
  });
  const schoolId = String(values.school || '').trim();
  if (!schoolId) {
    throw new Error('請指定 --school（例如 --school pu）');
  }
  const write = values.write === true && values['dry-run'] !== true;
  return {
    schoolId,
    write,
    dryRun: !write,
  };
}

function summarize(result) {
  return {
    schoolId: result.schoolId,
    status: result.status,
    reason: result.reason || '',
    dryRun: result.sources?.some((item) => item.dryRun) ?? true,
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

async function runCli(argv, deps = {}) {
  const options = parseCli(argv);
  const env = deps.env || process.env;
  const school = schoolConfig(options.schoolId);
  if (!school) {
    throw new Error(`沒有這間學校的公告來源設定：${options.schoolId}`);
  }
  if (!listSources(options.schoolId).length) {
    throw new Error(`${options.schoolId} 沒有可抓的公開公告來源`);
  }
  if (options.write && !isWriteEnabled(env)) {
    throw new Error('寫入已關閉。設 CAMPUS_ANNOUNCEMENT_SYNC_ENABLED=true 才會寫入 schools/{schoolId}/announcements。');
  }
  if (options.write && typeof deps.getDb === 'function') {
    deps.db = deps.db || deps.getDb();
  } else if (options.write && !deps.db) {
    throw new Error('寫入需要 Firestore');
  }
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
