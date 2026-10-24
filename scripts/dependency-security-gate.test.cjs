'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

const {
  evaluate,
  extractFindings,
  loadExceptions,
  DEFAULT_EXCEPTIONS,
  SCOPES,
} = require('./dependency-security-gate.cjs');

const SCRIPT = path.join(__dirname, 'dependency-security-gate.cjs');
const REPO_EXCEPTIONS = DEFAULT_EXCEPTIONS;
const FUNCTIONS_AUDIT_HIGH_FIXTURE = path.join(
  __dirname,
  'fixtures',
  'functions-audit-high.json',
);

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dep-sec-gate-'));
}

function writeJson(dir, name, value) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`);
  return file;
}

function runCli(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf8',
    env: process.env,
  });
}

function severityBucket() {
  return { info: 0, low: 0, moderate: 0, high: 0, critical: 0 };
}

function pnpmReport(advisories, metaOverride) {
  const vulnerabilities = severityBucket();
  for (const advisory of Object.values(advisories)) {
    const sev = advisory.severity;
    const n = Array.isArray(advisory.findings) ? advisory.findings.length : 0;
    vulnerabilities[sev] += n;
  }
  return {
    actions: [],
    advisories,
    muted: [],
    metadata: {
      vulnerabilities: metaOverride || vulnerabilities,
      dependencies: 1,
      totalDependencies: 1,
    },
  };
}

function npmReport(vulnerabilities, metaOverride) {
  const counts = severityBucket();
  for (const entry of Object.values(vulnerabilities)) {
    counts[entry.severity] += 1;
  }
  const vulnerabilitiesMeta = metaOverride || {
    ...counts,
    total: Object.values(counts).reduce((a, b) => a + b, 0),
  };
  return {
    auditReportVersion: 2,
    vulnerabilities,
    metadata: {
      vulnerabilities: vulnerabilitiesMeta,
      dependencies: 1,
      totalDependencies: 1,
    },
  };
}

function emptyExceptions(dir) {
  return writeJson(dir, 'exceptions.json', { exceptions: [] });
}

function highPnpmAdvisory(overrides = {}) {
  return {
    id: 42,
    module_name: 'undici',
    severity: 'high',
    github_advisory_id: 'GHSA-xjj6-f33q-929c',
    title: 'undici DoS',
    url: 'https://github.com/advisories/GHSA-xjj6-f33q-929c',
    findings: [
      {
        version: '5.28.4',
        paths: ['.>firebase-tools>undici'],
      },
    ],
    ...overrides,
  };
}

test('倉庫風險處置必須可驗證且沒有重複告警範圍', () => {
  const doc = JSON.parse(fs.readFileSync(REPO_EXCEPTIONS, 'utf8'));
  assert.ok(Array.isArray(doc.exceptions));
  const keys = doc.exceptions.map((entry) => `${entry.scope}:${entry.package}:${entry.ghsa}`);
  assert.equal(new Set(keys).size, keys.length);
  for (const scope of SCOPES) {
    assert.doesNotThrow(() => loadExceptions(REPO_EXCEPTIONS, scope));
  }
});

test('允許的 scope 僅三種', () => {
  assert.deepEqual([...SCOPES].sort(), [
    'functions-prod',
    'workspace-all',
    'workspace-prod',
  ]);
});

test('拒絕壞 JSON', () => {
  const dir = tempDir();
  const report = writeJson(dir, 'bad.json', '{not-json');
  const exceptions = emptyExceptions(dir);
  assert.throws(
    () =>
      evaluate({
        reportPath: report,
        format: 'pnpm-legacy',
        scope: 'workspace-prod',
        exceptionsPath: exceptions,
        auditExitCode: 1,
      }),
    /不是合法 JSON/,
  );
});

test('拒絕稽核服務錯誤回應（即使 exit code 為 1）', () => {
  const dir = tempDir();
  const report = writeJson(dir, 'error.json', {
    error: {
      code: 'ENOAUDIT',
      summary: 'audit endpoint unavailable',
      detail: 'simulated registry failure',
    },
  });
  const exceptions = emptyExceptions(dir);
  assert.throws(
    () =>
      evaluate({
        reportPath: report,
        format: 'npm',
        scope: 'functions-prod',
        exceptionsPath: exceptions,
        auditExitCode: 1,
      }),
    /稽核服務錯誤/,
  );

  const cli = runCli([
    '--report',
    report,
    '--format',
    'npm',
    '--scope',
    'functions-prod',
    '--exceptions',
    exceptions,
    '--audit-exit-code',
    '1',
  ]);
  assert.notEqual(cli.status, 0);
  assert.match(cli.stderr, /稽核服務錯誤/);
});

test('未預期或超出範圍的 audit exit 必須失敗關閉', () => {
  const dir = tempDir();
  const report = writeJson(dir, 'clean.json', pnpmReport({}));
  const exceptions = emptyExceptions(dir);

  assert.throws(
    () =>
      evaluate({
        reportPath: report,
        format: 'pnpm-legacy',
        scope: 'workspace-all',
        exceptionsPath: exceptions,
        auditExitCode: '137',
      }),
    /未預期的 audit exit code/,
  );
  assert.throws(
    () =>
      evaluate({
        reportPath: report,
        format: 'pnpm-legacy',
        scope: 'workspace-all',
        exceptionsPath: exceptions,
        auditExitCode: '2',
      }),
    /未預期的 audit exit code/,
  );
  assert.throws(
    () =>
      evaluate({
        reportPath: report,
        format: 'pnpm-legacy',
        scope: 'workspace-all',
        exceptionsPath: exceptions,
        auditExitCode: 'nope',
      }),
    /必須為整數/,
  );
});

test('看起來有效的空報告 + 非零 exit 必須失敗', () => {
  const dir = tempDir();
  const report = writeJson(dir, 'empty.json', pnpmReport({}));
  const exceptions = emptyExceptions(dir);
  assert.throws(
    () =>
      evaluate({
        reportPath: report,
        format: 'pnpm-legacy',
        scope: 'workspace-all',
        exceptionsPath: exceptions,
        auditExitCode: 1,
      }),
    /exit 非零但弱點清單為空/,
  );
});

test('metadata 宣稱 critical 但 payload 為空必須失敗', () => {
  const dir = tempDir();
  const report = writeJson(
    dir,
    'meta-crit.json',
    pnpmReport(
      {},
      { info: 0, low: 0, moderate: 0, high: 0, critical: 1 },
    ),
  );
  const exceptions = emptyExceptions(dir);
  assert.throws(
    () =>
      evaluate({
        reportPath: report,
        format: 'pnpm-legacy',
        scope: 'workspace-all',
        exceptionsPath: exceptions,
        auditExitCode: 1,
      }),
    /metadata 與報告結構/,
  );
});

test('metadata 與結構計數不符必須失敗', () => {
  const dir = tempDir();
  const report = writeJson(
    dir,
    'mismatch.json',
    pnpmReport(
      {
        '1': {
          id: 1,
          module_name: 'left-pad',
          severity: 'moderate',
          github_advisory_id: 'GHSA-zzzz-yyyy-xxxx',
          title: 'moderate demo',
          url: 'https://github.com/advisories/GHSA-zzzz-yyyy-xxxx',
          findings: [{ version: '1.0.0', paths: ['.>left-pad'] }],
        },
      },
      { info: 0, low: 0, moderate: 9, high: 0, critical: 0 },
    ),
  );
  const exceptions = emptyExceptions(dir);
  assert.throws(
    () =>
      evaluate({
        reportPath: report,
        format: 'pnpm-legacy',
        scope: 'workspace-all',
        exceptionsPath: exceptions,
        auditExitCode: 1,
      }),
    /metadata 與報告結構/,
  );
});

test('乾淨 exit 0 報告通過', () => {
  const dir = tempDir();
  const report = writeJson(dir, 'clean.json', pnpmReport({}));
  const exceptions = emptyExceptions(dir);
  const result = evaluate({
    reportPath: report,
    format: 'pnpm-legacy',
    scope: 'workspace-all',
    exceptionsPath: exceptions,
    auditExitCode: 0,
  });
  assert.equal(result.ok, true);
  assert.equal(result.findings.length, 0);
});

test('未審查的 high 必須阻擋（pnpm-legacy）', () => {
  const dir = tempDir();
  const report = writeJson(
    dir,
    'high.json',
    pnpmReport({
      '1113080': {
        id: 1113080,
        module_name: '@modelcontextprotocol/sdk',
        severity: 'high',
        github_advisory_id: 'GHSA-345p-7cg4-v4c7',
        title: 'cross-client data leak',
        url: 'https://github.com/advisories/GHSA-345p-7cg4-v4c7',
        findings: [
          {
            version: '1.25.3',
            paths: ['.>firebase-tools>@modelcontextprotocol/sdk'],
          },
        ],
      },
    }),
  );
  const exceptions = emptyExceptions(dir);
  const result = evaluate({
    reportPath: report,
    format: 'pnpm-legacy',
    scope: 'workspace-prod',
    exceptionsPath: exceptions,
    auditExitCode: 1,
  });
  assert.equal(result.ok, false);
  assert.equal(result.counts.high, 1);
  assert.ok(result.blockers.some((b) => b.kind === 'unreviewed-high'));
});

test('critical 一律阻擋，即使有例外檔條目', () => {
  const dir = tempDir();
  const report = writeJson(
    dir,
    'critical.json',
    pnpmReport({
      '999': {
        id: 999,
        module_name: 'evil-pkg',
        severity: 'critical',
        github_advisory_id: 'GHSA-aaaa-bbbb-cccc',
        title: 'critical demo',
        url: 'https://github.com/advisories/GHSA-aaaa-bbbb-cccc',
        findings: [{ version: '1.0.0', paths: ['.>evil-pkg'] }],
      },
    }),
  );
  const exceptions = writeJson(dir, 'exceptions.json', {
    exceptions: [
      {
        package: 'evil-pkg',
        ghsa: 'GHSA-aaaa-bbbb-cccc',
        scope: 'workspace-all',
        reason: 'should-not-matter',
        expiry: '2099-01-01',
        evidence: 'critical must still block',
        paths: ['.>evil-pkg'],
        versions: ['1.0.0'],
      },
    ],
  });
  const result = evaluate({
    reportPath: report,
    format: 'pnpm-legacy',
    scope: 'workspace-all',
    exceptionsPath: exceptions,
    auditExitCode: 1,
  });
  assert.equal(result.ok, false);
  assert.ok(result.blockers.some((b) => b.kind === 'critical'));
});

test('未知嚴重程度必須阻擋', () => {
  const dir = tempDir();
  const report = writeJson(
    dir,
    'unknown.json',
    npmReport({
      weird: {
        name: 'weird',
        severity: 'high',
        via: [
          {
            source: 1,
            name: 'weird',
            title: 'mystery sev',
            url: 'https://github.com/advisories/GHSA-1111-2222-3333',
            severity: 'mystery',
            range: '<1.0.0',
          },
        ],
        effects: [],
        range: '<1.0.0',
        nodes: ['node_modules/weird'],
        fixAvailable: false,
      },
    }),
  );
  const exceptions = emptyExceptions(dir);
  const result = evaluate({
    reportPath: report,
    format: 'npm',
    scope: 'functions-prod',
    exceptionsPath: exceptions,
    auditExitCode: 1,
  });
  assert.equal(result.ok, false);
  assert.ok(result.blockers.some((b) => b.kind === 'unknown-severity'));
});

test('過期例外不可接受 high', () => {
  const dir = tempDir();
  const report = writeJson(
    dir,
    'high.json',
    pnpmReport({
      '42': highPnpmAdvisory(),
    }),
  );
  const exceptions = writeJson(dir, 'exceptions.json', {
    exceptions: [
      {
        package: 'undici',
        ghsa: 'GHSA-xjj6-f33q-929c',
        scope: 'workspace-prod',
        reason: 'build-tool only',
        expiry: '2020-01-01',
        evidence: 'historical review notes',
        paths: ['.>firebase-tools>undici'],
        versions: ['5.28.4'],
      },
    ],
  });
  assert.throws(
    () =>
      evaluate({
        reportPath: report,
        format: 'pnpm-legacy',
        scope: 'workspace-prod',
        exceptionsPath: exceptions,
        auditExitCode: 1,
      }),
    /例外已過期/,
  );
});

test('精確有效例外可接受對應 high；新增路徑或版本變更會打破接受', () => {
  const dir = tempDir();
  const report = writeJson(
    dir,
    'high.json',
    pnpmReport({
      '42': highPnpmAdvisory(),
    }),
  );
  const exceptions = writeJson(dir, 'exceptions.json', {
    exceptions: [
      {
        package: 'undici',
        ghsa: 'GHSA-xjj6-f33q-929c',
        scope: 'workspace-prod',
        reason: '僅 Expo CLI 建置路徑；執行期 App bundle 未載入 undici fetch',
        expiry: '2099-12-31',
        evidence: '靜態依賴圖與 Metro 解析路徑核對：無不可信 URL 進入此程式碼路徑',
        paths: ['.>firebase-tools>undici'],
        versions: ['5.28.4'],
      },
    ],
  });

  const ok = evaluate({
    reportPath: report,
    format: 'pnpm-legacy',
    scope: 'workspace-prod',
    exceptionsPath: exceptions,
    auditExitCode: 1,
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.acceptedHigh.length, 1);

  const wrongScope = evaluate({
    reportPath: report,
    format: 'pnpm-legacy',
    scope: 'workspace-all',
    exceptionsPath: exceptions,
    auditExitCode: 1,
  });
  assert.equal(wrongScope.ok, false);

  const newPathReport = writeJson(
    dir,
    'new-path.json',
    pnpmReport({
      '42': highPnpmAdvisory({
        findings: [
          {
            version: '5.28.4',
            paths: ['.>firebase-tools>undici'],
          },
          {
            version: '5.28.4',
            paths: ['apps__web>undici'],
          },
        ],
      }),
    }),
  );
  const brokenPath = evaluate({
    reportPath: newPathReport,
    format: 'pnpm-legacy',
    scope: 'workspace-prod',
    exceptionsPath: exceptions,
    auditExitCode: 1,
  });
  assert.equal(brokenPath.ok, false);
  assert.ok(brokenPath.blockers.some((b) => b.kind === 'unreviewed-high'));

  const newVerReport = writeJson(
    dir,
    'new-ver.json',
    pnpmReport({
      '42': highPnpmAdvisory({
        findings: [
          {
            version: '5.29.0',
            paths: ['.>firebase-tools>undici'],
          },
        ],
      }),
    }),
  );
  const brokenVer = evaluate({
    reportPath: newVerReport,
    format: 'pnpm-legacy',
    scope: 'workspace-prod',
    exceptionsPath: exceptions,
    auditExitCode: 1,
  });
  assert.equal(brokenVer.ok, false);
});

test('moderate／low 不阻擋；空 advisories + exit 0 可通過', () => {
  const dir = tempDir();
  const report = writeJson(
    dir,
    'mod.json',
    pnpmReport({
      '1': {
        id: 1,
        module_name: 'left-pad',
        severity: 'moderate',
        github_advisory_id: 'GHSA-zzzz-yyyy-xxxx',
        title: 'moderate demo',
        url: 'https://github.com/advisories/GHSA-zzzz-yyyy-xxxx',
        findings: [{ version: '1.0.0', paths: ['.>left-pad'] }],
      },
      '2': {
        id: 2,
        module_name: 'right-pad',
        severity: 'low',
        github_advisory_id: 'GHSA-yyyy-xxxx-wwww',
        title: 'low demo',
        url: 'https://github.com/advisories/GHSA-yyyy-xxxx-wwww',
        findings: [{ version: '2.0.0', paths: ['.>right-pad'] }],
      },
    }),
  );
  const exceptions = emptyExceptions(dir);
  const result = evaluate({
    reportPath: report,
    format: 'pnpm-legacy',
    scope: 'workspace-all',
    exceptionsPath: exceptions,
    auditExitCode: 1,
  });
  assert.equal(result.ok, true);
  assert.equal(result.counts.moderate, 1);
  assert.equal(result.counts.low, 1);
  assert.equal(result.tracked.length, 2);

  const clean = writeJson(dir, 'clean.json', pnpmReport({}));
  const cleanResult = evaluate({
    reportPath: clean,
    format: 'pnpm-legacy',
    scope: 'workspace-all',
    exceptionsPath: exceptions,
    auditExitCode: 0,
  });
  assert.equal(cleanResult.ok, true);
  assert.equal(cleanResult.findings.length, 0);
});

test('禁止例外萬用字元與空白 evidence', () => {
  const dir = tempDir();
  const report = writeJson(dir, 'clean.json', pnpmReport({}));
  const wildcard = writeJson(dir, 'wild.json', {
    exceptions: [
      {
        package: 'undici*',
        ghsa: 'GHSA-xjj6-f33q-929c',
        scope: 'workspace-prod',
        reason: 'no',
        expiry: '2099-01-01',
        evidence: 'x',
        paths: ['.>undici'],
        versions: ['1.0.0'],
      },
    ],
  });
  assert.throws(
    () =>
      evaluate({
        reportPath: report,
        format: 'pnpm-legacy',
        scope: 'workspace-prod',
        exceptionsPath: wildcard,
        auditExitCode: 0,
      }),
    /萬用字元/,
  );

  const blankEvidence = writeJson(dir, 'blank.json', {
    exceptions: [
      {
        package: 'undici',
        ghsa: 'GHSA-xjj6-f33q-929c',
        scope: 'workspace-prod',
        reason: 'reason',
        expiry: '2099-01-01',
        evidence: '   ',
        paths: ['.>undici'],
        versions: ['1.0.0'],
      },
    ],
  });
  assert.throws(
    () =>
      evaluate({
        reportPath: report,
        format: 'pnpm-legacy',
        scope: 'workspace-prod',
        exceptionsPath: blankEvidence,
        auditExitCode: 0,
      }),
    /evidence/,
  );

  const wildPath = writeJson(dir, 'wild-path.json', {
    exceptions: [
      {
        package: 'undici',
        ghsa: 'GHSA-xjj6-f33q-929c',
        scope: 'workspace-prod',
        reason: 'reason',
        expiry: '2099-01-01',
        evidence: 'notes',
        paths: ['.>firebase-tools>*'],
        versions: ['5.28.4'],
      },
    ],
  });
  assert.throws(
    () =>
      evaluate({
        reportPath: report,
        format: 'pnpm-legacy',
        scope: 'workspace-prod',
        exceptionsPath: wildPath,
        auditExitCode: 0,
      }),
    /萬用字元/,
  );
});

test('npm：懸空 high via 字串必須失敗；循環 via 必須失敗', () => {
  const dir = tempDir();
  const exceptions = emptyExceptions(dir);

  const dangling = writeJson(
    dir,
    'dangling.json',
    npmReport({
      parent: {
        name: 'parent',
        severity: 'high',
        via: ['missing-child'],
        effects: [],
        range: '*',
        nodes: ['node_modules/parent'],
        fixAvailable: false,
      },
    }),
  );
  assert.throws(
    () =>
      evaluate({
        reportPath: dangling,
        format: 'npm',
        scope: 'functions-prod',
        exceptionsPath: exceptions,
        auditExitCode: 1,
      }),
    /不存在的套件|懸空/,
  );

  const cyclic = writeJson(
    dir,
    'cyclic.json',
    npmReport({
      a: {
        name: 'a',
        severity: 'high',
        via: ['b'],
        effects: [],
        range: '*',
        nodes: ['node_modules/a'],
        fixAvailable: false,
      },
      b: {
        name: 'b',
        severity: 'high',
        via: ['a'],
        effects: [],
        range: '*',
        nodes: ['node_modules/b'],
        fixAvailable: false,
      },
    }),
  );
  assert.throws(
    () =>
      evaluate({
        reportPath: cyclic,
        format: 'npm',
        scope: 'functions-prod',
        exceptionsPath: exceptions,
        auditExitCode: 1,
      }),
    /循環/,
  );
});

test('npm：critical 父節點不可因下游 object 較低嚴重程度而通過', () => {
  const dir = tempDir();
  const report = writeJson(
    dir,
    'crit-parent.json',
    npmReport({
      parent: {
        name: 'parent',
        severity: 'critical',
        via: ['child'],
        effects: ['child'],
        range: '*',
        nodes: ['node_modules/parent'],
        fixAvailable: false,
      },
      child: {
        name: 'child',
        severity: 'moderate',
        via: [
          {
            source: 1,
            name: 'child',
            title: 'moderate only',
            url: 'https://github.com/advisories/GHSA-1111-2222-3333',
            severity: 'moderate',
            range: '<1.0.0',
          },
        ],
        effects: [],
        range: '<1.0.0',
        nodes: ['node_modules/child'],
        fixAvailable: false,
      },
    }),
  );
  const exceptions = emptyExceptions(dir);
  const result = evaluate({
    reportPath: report,
    format: 'npm',
    scope: 'functions-prod',
    exceptionsPath: exceptions,
    auditExitCode: 1,
  });
  assert.equal(result.ok, false);
  assert.ok(result.counts.critical >= 1);
  assert.ok(result.blockers.some((b) => b.kind === 'critical'));
});

test('真實 Functions npm 報告仍可解析；CLI 對 npm high 以 exit 1 進入政策並擋未審查', () => {
  assert.ok(
    fs.existsSync(FUNCTIONS_AUDIT_HIGH_FIXTURE),
    '缺少 scripts/fixtures/functions-audit-high.json fixture',
  );
  const dir = tempDir();
  const exceptions = emptyExceptions(dir);

  const parsed = extractFindings(
    JSON.parse(fs.readFileSync(FUNCTIONS_AUDIT_HIGH_FIXTURE, 'utf8')),
    'npm',
  );
  assert.ok(parsed.some((f) => f.package === 'zod' && f.severity === 'high'));

  const result = evaluate({
    reportPath: FUNCTIONS_AUDIT_HIGH_FIXTURE,
    format: 'npm',
    scope: 'functions-prod',
    exceptionsPath: exceptions,
    auditExitCode: 1,
  });
  assert.equal(result.ok, false);
  assert.ok(result.counts.high >= 1);
  assert.ok(result.blockers.some((b) => b.kind === 'unreviewed-high'));

  const synthetic = writeJson(
    dir,
    'npm-high.json',
    npmReport({
      lodash: {
        name: 'lodash',
        severity: 'high',
        isDirect: false,
        via: [
          {
            source: 1064854,
            name: 'lodash',
            dependency: 'lodash',
            title: 'Prototype Pollution',
            url: 'https://github.com/advisories/GHSA-p6mc-m468-83gw',
            severity: 'high',
            range: '<4.17.21',
          },
        ],
        effects: [],
        range: '<4.17.21',
        nodes: ['node_modules/lodash'],
        fixAvailable: true,
      },
    }),
  );
  const cli = runCli([
    '--report',
    synthetic,
    '--format',
    'npm',
    '--scope',
    'functions-prod',
    '--exceptions',
    exceptions,
    '--audit-exit-code',
    '1',
  ]);
  assert.equal(cli.status, 1);
  assert.match(cli.stderr, /未審查的 high/);
  assert.match(cli.stdout, /high=1/);
});

test('npm 例外綁定 nodes＋ranges；節點新增會打破接受', () => {
  const dir = tempDir();
  const report = writeJson(
    dir,
    'npm-high.json',
    npmReport({
      lodash: {
        name: 'lodash',
        severity: 'high',
        via: [
          {
            source: 1,
            name: 'lodash',
            title: 'Prototype Pollution',
            url: 'https://github.com/advisories/GHSA-p6mc-m468-83gw',
            severity: 'high',
            range: '<4.17.21',
          },
        ],
        effects: [],
        range: '<4.17.21',
        nodes: ['node_modules/lodash'],
        fixAvailable: true,
      },
    }),
  );
  const exceptions = writeJson(dir, 'exceptions.json', {
    exceptions: [
      {
        package: 'lodash',
        ghsa: 'GHSA-p6mc-m468-83gw',
        scope: 'functions-prod',
        reason: 'test acceptance',
        expiry: '2099-12-31',
        evidence: 'fixture-only nonreachability note',
        nodes: ['node_modules/lodash'],
        ranges: ['<4.17.21'],
      },
    ],
  });
  const ok = evaluate({
    reportPath: report,
    format: 'npm',
    scope: 'functions-prod',
    exceptionsPath: exceptions,
    auditExitCode: 1,
  });
  assert.equal(ok.ok, true);

  const wider = writeJson(
    dir,
    'npm-wider.json',
    npmReport({
      lodash: {
        name: 'lodash',
        severity: 'high',
        via: [
          {
            source: 1,
            name: 'lodash',
            title: 'Prototype Pollution',
            url: 'https://github.com/advisories/GHSA-p6mc-m468-83gw',
            severity: 'high',
            range: '<4.17.21',
          },
        ],
        effects: [],
        range: '<4.17.21',
        nodes: ['node_modules/lodash', 'node_modules/other/node_modules/lodash'],
        fixAvailable: true,
      },
    }),
  );
  const broken = evaluate({
    reportPath: wider,
    format: 'npm',
    scope: 'functions-prod',
    exceptionsPath: exceptions,
    auditExitCode: 1,
  });
  assert.equal(broken.ok, false);
});
