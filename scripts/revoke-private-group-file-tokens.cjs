#!/usr/bin/env node
'use strict';

const { parseArgs } = require('node:util');
const { getAdminBucket, revokePrivateGroupFileTokens } = require('../backend/functions/privateGroupFilesMigration');

const USAGE = [
  'node scripts/revoke-private-group-file-tokens.cjs --project PROJECT_ID --bucket BUCKET_NAME [--apply]',
  '預設 dry-run。部署私有檔案入口及 Storage 規則後，加上 --apply 移除舊下載 token。',
  '使用 Firebase Admin Application Default Credentials，輸出只有處理統計。',
].join('\n');

function parseCli(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      project: { type: 'string' },
      bucket: { type: 'string' },
      apply: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
    strict: true,
    allowPositionals: false,
  });
  if (values.help) return { help: true };
  if (typeof values.project !== 'string' || !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(values.project)
    || typeof values.bucket !== 'string' || !/^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/.test(values.bucket)) {
    throw new Error('An explicit project ID and bucket name are required');
  }
  return { projectId: values.project, bucketName: values.bucket, apply: values.apply };
}

async function runCli(argv, { getBucket = getAdminBucket } = {}) {
  const options = parseCli(argv);
  if (options.help) return { help: USAGE };
  const bucket = await getBucket(options);
  const summary = await revokePrivateGroupFileTokens({ bucket, apply: options.apply });
  return { projectId: options.projectId, bucketName: options.bucketName, ...summary };
}

async function main(argv = process.argv.slice(2), deps = {}) {
  const stdout = deps.stdout || process.stdout;
  const stderr = deps.stderr || process.stderr;
  try {
    const result = await runCli(argv, deps);
    stdout.write(`${result.help || JSON.stringify(result, null, 2)}\n`);
    return result.conflicts || result.failures ? 1 : 0;
  } catch {
    // Never print raw SDK errors, request URLs, credentials or supplied token values.
    stderr.write(`清理工具執行失敗。請檢查參數、Admin 認證與目標存取權限。\n${USAGE}\n`);
    return 1;
  }
}

if (require.main === module) {
  main().then((code) => { process.exitCode = code; });
}

module.exports = { parseCli, getAdminBucket, runCli, main };
