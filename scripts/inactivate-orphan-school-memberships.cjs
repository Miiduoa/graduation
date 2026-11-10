#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const { parseArgs } = require('node:util');
const {
  loadCampusMembershipRows,
  planOrphanSchoolMembershipCleanup,
  summarizeBindingPlan,
  inactivateOrphanSchoolMemberships,
} = require('../backend/functions/campusStoryAccessBinding');

const USAGE = [
  'node scripts/inactivate-orphan-school-memberships.cjs --project PROJECT_ID [--apply --backup-file PATH]',
  '預設 dry-run，只報 profile 不存在或已刪／停權帳戶的 active 校籍筆數。',
  '補章以 profile createTime <= membership createTime 擋刪帳重建，不必先寫正式資料。',
  '--apply 需 --backup-file，先 fsync 備份再於交易內重驗後標 inactive。',
].join('\n');

function parseCli(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      project: { type: 'string' },
      apply: { type: 'boolean', default: false },
      'backup-file': { type: 'string' },
      help: { type: 'boolean', default: false },
    },
    strict: true,
    allowPositionals: false,
  });
  if (values.help) return { help: true };
  if (typeof values.project !== 'string' || !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(values.project)) {
    throw new Error('An explicit project ID is required');
  }
  if (values.apply && typeof values['backup-file'] !== 'string') {
    throw new Error('--apply requires --backup-file');
  }
  return {
    projectId: values.project,
    apply: values.apply === true,
    backupFile: values['backup-file'],
  };
}

function createDefaultDb(projectId) {
  const { initializeApp, getApps } = require('firebase-admin/app');
  const { getFirestore, FieldValue } = require('firebase-admin/firestore');
  if (!getApps().length) initializeApp({ projectId });
  return { db: getFirestore(), FieldValue };
}

async function writeBackupFile(filePath, payload) {
  const handle = await fs.promises.open(filePath, 'w');
  try {
    await handle.writeFile(`${JSON.stringify(payload)}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function runCli(argv, deps = {}) {
  const options = parseCli(argv);
  if (options.help) return { help: USAGE };
  const { db, FieldValue } = deps.db
    ? { db: deps.db, FieldValue: deps.FieldValue }
    : (deps.createDb || createDefaultDb)(options.projectId);
  const rows = await loadCampusMembershipRows(db);
  const targets = planOrphanSchoolMembershipCleanup(rows);
  const counts = summarizeBindingPlan(targets);
  if (!options.apply) {
    return { projectId: options.projectId, mode: 'dry-run', counts };
  }
  await writeBackupFile(options.backupFile, {
    projectId: options.projectId,
    createdAt: new Date().toISOString(),
    entries: targets.map((row) => ({
      schoolId: row.schoolId,
      uid: row.uid,
      membership: row.membership,
    })),
  });
  const changed = await inactivateOrphanSchoolMemberships({
    db,
    FieldValue: FieldValue || deps.FieldValue,
    entries: targets,
  });
  return {
    projectId: options.projectId,
    mode: 'apply',
    counts,
    inactivated: changed.length,
  };
}

async function main(argv = process.argv.slice(2), deps = {}) {
  const stdout = deps.stdout || process.stdout;
  const stderr = deps.stderr || process.stderr;
  try {
    const result = await runCli(argv, deps);
    stdout.write(`${result.help || JSON.stringify(result, null, 2)}\n`);
    return 0;
  } catch {
    stderr.write(`殘留校籍清理執行失敗。請檢查參數與 Admin 認證。\n${USAGE}\n`);
    return 1;
  }
}

if (require.main === module) {
  main().then((code) => {
    process.exitCode = code;
  });
}

module.exports = { parseCli, runCli, main, USAGE, writeBackupFile };
