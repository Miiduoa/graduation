#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { parseArgs } = require('node:util');
const {
  loadCampusMembershipRows,
  planCampusStoryAccessBinding,
  summarizeBindingPlan,
  reverseCampusStoryAccessBinding,
} = require('../backend/functions/campusStoryAccessBinding');

const USAGE = [
  'node scripts/bind-campus-story-profile-schools.cjs --project PROJECT_ID',
  '只輸出分類統計，不寫入。歷史帳在下次伺服器端校務登入交易時蓋章。',
  '沒有 --apply。先前備份若要還原：--reverse --backup-file FILE；加上 --apply --applied-file FILE 才會寫回。',
  '還原在交易內比對現值，且不會撤掉之後合法再登入寫入的蓋章世代。',
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
      'applied-file': { type: 'string' },
      help: { type: 'boolean', default: false },
    },
    strict: true,
    allowPositionals: false,
  });
  if (values.help) return { help: true };
  if (typeof values.project !== 'string' || !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(values.project)) {
    throw new Error('An explicit project ID is required');
  }
  if (values.apply && !values.reverse) {
    throw new Error('Binding apply is disabled; historical accounts stamp on next school login');
  }
  if (values.reverse && typeof values['backup-file'] !== 'string') {
    throw new Error('Reversing requires --backup-file');
  }
  if (values.reverse && values.apply && typeof values['applied-file'] !== 'string') {
    throw new Error('Reverse apply requires --applied-file');
  }
  return {
    projectId: values.project,
    apply: values.apply,
    reverse: values.reverse,
    backupFile: values['backup-file'],
    appliedFile: values['applied-file'],
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
    if (options.apply) {
      writeFile(options.appliedFile, {
        projectId: options.projectId,
        createdAt: new Date().toISOString(),
        restored: result.restored,
        skipped: result.skipped,
      });
    }
    return {
      projectId: options.projectId,
      mode: options.apply ? 'reverse' : 'reverse-dry-run',
      restored: result.restored.length,
      skipped: result.skipped.length,
      appliedFile: options.apply ? options.appliedFile : undefined,
    };
  }

  const rows = await loadCampusMembershipRows(db);
  const plan = planCampusStoryAccessBinding(rows);
  return {
    projectId: options.projectId,
    mode: 'dry-run',
    counts: summarizeBindingPlan(plan),
    applied: 0,
    planned: 0,
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
