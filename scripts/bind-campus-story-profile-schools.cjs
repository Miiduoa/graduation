#!/usr/bin/env node
'use strict';

const { parseArgs } = require('node:util');
const {
  loadCampusMembershipRows,
  planCampusStoryAccessBinding,
  summarizeBindingPlan,
} = require('../backend/functions/campusStoryAccessBinding');

const USAGE = [
  'node scripts/bind-campus-story-profile-schools.cjs --project PROJECT_ID',
  '只輸出分類統計，不寫入。沒有 --apply 或 --reverse。',
  '歷史帳在下次伺服器端校務登入交易時蓋章。',
].join('\n');

function parseCli(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      project: { type: 'string' },
      help: { type: 'boolean', default: false },
    },
    strict: true,
    allowPositionals: false,
  });
  if (values.help) return { help: true };
  if (typeof values.project !== 'string' || !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(values.project)) {
    throw new Error('An explicit project ID is required');
  }
  return { projectId: values.project };
}

function createDefaultDb(projectId) {
  const { initializeApp, getApps } = require('firebase-admin/app');
  const { getFirestore, FieldValue } = require('firebase-admin/firestore');
  if (!getApps().length) initializeApp({ projectId });
  return { db: getFirestore(), FieldValue };
}

async function runCli(argv, deps = {}) {
  const options = parseCli(argv);
  if (options.help) return { help: USAGE };
  const { db } = deps.db
    ? { db: deps.db }
    : (deps.createDb || createDefaultDb)(options.projectId);
  const rows = await loadCampusMembershipRows(db);
  const plan = planCampusStoryAccessBinding(rows);
  return {
    projectId: options.projectId,
    mode: 'dry-run',
    counts: summarizeBindingPlan(plan),
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

module.exports = { parseCli, runCli, main, USAGE };
