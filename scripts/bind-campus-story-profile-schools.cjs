#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { parseArgs } = require('node:util');
const {
  loadCampusMembershipRows,
  planCampusStoryAccessBinding,
  summarizeBindingPlan,
  applyCampusStoryAccessBinding,
  reverseCampusStoryAccessBinding,
} = require('../backend/functions/campusStoryAccessBinding');

const USAGE = [
  'node scripts/bind-campus-story-profile-schools.cjs --project PROJECT_ID',
  '預設 dry-run，只輸出分類統計，不寫入。',
  '正式寫入需 --apply --backup-file FILE。會先完整寫入並 fsync 備份，再寫資料庫。',
  '還原預設也是 dry-run：--reverse --backup-file FILE；加上 --apply 才會寫回。',
  '只依目前單一學校的 active 校籍綁定；多校或證據不足只列出。',
  '殘留且沒有 canonical profile 的校籍預設只列出；加上 --inactivate-orphans 才會標為 inactive。',
].join('\n');

function parseCli(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      project: { type: 'string' },
      apply: { type: 'boolean', default: false },
      reverse: { type: 'boolean', default: false },
      'inactivate-orphans': { type: 'boolean', default: false },
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
  if ((values.apply || values.reverse) && typeof values['backup-file'] !== 'string') {
    throw new Error('Writing or reversing requires --backup-file');
  }
  return {
    projectId: values.project,
    apply: values.apply,
    reverse: values.reverse,
    inactivateOrphans: values['inactivate-orphans'],
    backupFile: values['backup-file'],
  };
}

function createDefaultDb(projectId) {
  const { initializeApp, getApps } = require('firebase-admin/app');
  const { getFirestore, FieldValue } = require('firebase-admin/firestore');
  if (!getApps().length) initializeApp({ projectId });
  return { db: getFirestore(), FieldValue };
}

function writeBackupAtomic(file, data) {
  const payload = `${JSON.stringify(data, null, 2)}\n`;
  const directory = path.dirname(file);
  fs.mkdirSync(directory, { recursive: true });
  const tmp = `${file}.tmp`;
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeFileSync(fd, payload);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
  const dirFd = fs.openSync(directory, 'r');
  try {
    fs.fsyncSync(dirFd);
  } finally {
    fs.closeSync(dirFd);
  }
}

async function runCli(argv, deps = {}) {
  const options = parseCli(argv);
  if (options.help) return { help: USAGE };
  const { db, FieldValue } = deps.db
    ? { db: deps.db, FieldValue: deps.FieldValue }
    : (deps.createDb || createDefaultDb)(options.projectId);
  const readFile = deps.readFile || ((file) => JSON.parse(fs.readFileSync(file, 'utf8')));
  const writeFile = deps.writeFile || writeBackupAtomic;

  if (options.reverse) {
    const backup = readFile(options.backupFile);
    const result = await reverseCampusStoryAccessBinding({
      db,
      FieldValue,
      backup,
      apply: options.apply,
      projectId: options.projectId,
    });
    return {
      projectId: options.projectId,
      mode: options.apply ? 'reverse' : 'reverse-dry-run',
      restored: result.restored.length,
      skipped: result.skipped.length,
    };
  }

  const rows = await loadCampusMembershipRows(db);
  const plan = planCampusStoryAccessBinding(rows);
  const counts = summarizeBindingPlan(plan);
  const prepared = await applyCampusStoryAccessBinding({
    db,
    plan,
    apply: false,
    inactivateOrphans: options.inactivateOrphans,
  });
  if (options.apply) {
    writeFile(options.backupFile, {
      projectId: options.projectId,
      createdAt: new Date().toISOString(),
      entries: prepared.backup,
    });
  }
  const result = await applyCampusStoryAccessBinding({
    db,
    plan,
    apply: options.apply,
    inactivateOrphans: options.inactivateOrphans,
  });
  return {
    projectId: options.projectId,
    mode: options.apply ? 'apply' : 'dry-run',
    counts,
    applied: result.applied.length,
    planned: prepared.backup.length,
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
    stderr.write(`校別綁定工具執行失敗。請檢查參數與 Admin 認證。\n${USAGE}\n`);
    return 1;
  }
}

if (require.main === module) {
  main().then((code) => {
    process.exitCode = code;
  });
}

module.exports = { parseCli, runCli, main, USAGE, writeBackupAtomic };
