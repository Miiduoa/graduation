#!/usr/bin/env node
'use strict';

/**
 * 依賴安全政策閘門：讀取已儲存的 pnpm legacy advisories / npm vulnerabilities JSON，
 * 拒絕畸形或錯誤報告、所有 critical，以及未經審查的 high。
 * moderate／low 僅回報，不阻擋初始修復門檻。
 *
 * 例外必須精確綁定 package、GHSA、scope，以及路徑／版本（pnpm）或 nodes／range（npm），
 * 並具備未過期 expiry 與非空白 evidence。禁止萬用字元、套件白名單或無界 ignore。
 */

const fs = require('node:fs');
const path = require('node:path');

const SCOPES = Object.freeze([
  'workspace-all',
  'workspace-prod',
  'functions-prod',
]);

const FORMATS = Object.freeze(['pnpm-legacy', 'npm']);

const SEVERITIES = Object.freeze([
  'info',
  'low',
  'moderate',
  'high',
  'critical',
]);

const GHSA_RE = /^GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/;

const DEFAULT_EXCEPTIONS = path.join(
  __dirname,
  '..',
  'docs',
  'security',
  'dependency-risk-acceptance.json',
);

function usage() {
  return [
    '用法：',
    '  node scripts/dependency-security-gate.cjs \\',
    '    --report <path> --format <pnpm-legacy|npm> --scope <scope> \\',
    '    [--exceptions <path>] [--audit-exit-code <n>]',
    '',
    `允許的 scope：${SCOPES.join(', ')}`,
    '允許的 audit exit：0（乾淨）或 1（有效弱點報告）；其餘一律失敗。',
  ].join('\n');
}

function parseArgs(argv) {
  const out = {
    report: null,
    format: null,
    scope: null,
    exceptions: DEFAULT_EXCEPTIONS,
    auditExitCode: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--help' || arg === '-h') {
      out.help = true;
      return out;
    }
    if (!next || next.startsWith('--')) {
      throw new Error(`缺少參數值：${arg}`);
    }
    if (arg === '--report') out.report = next;
    else if (arg === '--format') out.format = next;
    else if (arg === '--scope') out.scope = next;
    else if (arg === '--exceptions') out.exceptions = next;
    else if (arg === '--audit-exit-code') out.auditExitCode = next;
    else throw new Error(`未知參數：${arg}`);
    i += 1;
  }
  return out;
}

function fail(message, details = []) {
  const err = new Error(message);
  err.details = details;
  throw err;
}

function readJsonFile(filePath, label) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    fail(`無法讀取${label}：${filePath}`, [String(err && err.message)]);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    fail(`${label} 不是合法 JSON：${filePath}`, [String(err && err.message)]);
  }
}

function hasWildcard(value) {
  return typeof value === 'string' && /[*?]/.test(value);
}

function assertExactToken(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    fail(`例外欄位 ${field} 必須為非空白字串`);
  }
  if (hasWildcard(value) || value.trim() !== value) {
    fail(`例外欄位 ${field} 禁止萬用字元或前後空白：${JSON.stringify(value)}`);
  }
  return value;
}

function uniqueSorted(values) {
  return [...new Set(values)].sort();
}

function sameStringSet(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function assertExactStringList(value, field, { allowSemverGlob = false } = {}) {
  if (!Array.isArray(value) || value.length === 0) {
    fail(`例外欄位 ${field} 必須為非空字串陣列（禁止萬用路徑）`);
  }
  const out = [];
  for (const [i, item] of value.entries()) {
    if (typeof item !== 'string' || item.trim() === '') {
      fail(`例外欄位 ${field}[${i}] 必須為非空白字串`);
    }
    if (item.trim() !== item) {
      fail(`例外欄位 ${field}[${i}] 禁止前後空白：${JSON.stringify(item)}`);
    }
    // paths／nodes／versions 禁止 glob；ranges 可含 semver *／x
    if (!allowSemverGlob && hasWildcard(item)) {
      fail(`例外欄位 ${field}[${i}] 禁止萬用字元：${JSON.stringify(item)}`);
    }
    out.push(item);
  }
  return uniqueSorted(out);
}

function parseExpiry(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    fail('例外 expiry 必須為非空白 ISO 日期字串（YYYY-MM-DD 或完整時間）');
  }
  if (hasWildcard(value)) {
    fail(`例外 expiry 禁止萬用字元：${value}`);
  }
  // 僅日期時視為該日 UTC 結束，避免時區把當日誤判為已過期
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? `${value}T23:59:59.999Z`
    : value;
  const ms = Date.parse(normalized);
  if (Number.isNaN(ms)) {
    fail(`例外 expiry 無法解析：${value}`);
  }
  return ms;
}

function scopeFormat(scope) {
  return scope === 'functions-prod' ? 'npm' : 'pnpm-legacy';
}

function loadExceptions(filePath, scope) {
  const doc = readJsonFile(filePath, '例外檔');
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    fail('例外檔根節點必須為物件');
  }
  if (!Object.prototype.hasOwnProperty.call(doc, 'exceptions')) {
    fail('例外檔必須包含 exceptions 陣列');
  }
  if (!Array.isArray(doc.exceptions)) {
    fail('exceptions 必須為陣列');
  }
  for (const key of Object.keys(doc)) {
    if (key !== 'exceptions' && key !== '$schema' && key !== 'comment') {
      fail(`例外檔不允許額外欄位（禁止全域白名單／ignore）：${key}`);
    }
  }

  const now = Date.now();
  const active = [];
  const expectedFormat = scopeFormat(scope);
  for (const [index, entry] of doc.exceptions.entries()) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      fail(`exceptions[${index}] 必須為物件`);
    }
    const pkg = assertExactToken(entry.package, 'package');
    const ghsa = assertExactToken(entry.ghsa, 'ghsa');
    if (!GHSA_RE.test(ghsa)) {
      fail(`exceptions[${index}].ghsa 必須為精確 GHSA ID：${ghsa}`);
    }
    const entryScope = assertExactToken(entry.scope, 'scope');
    if (!SCOPES.includes(entryScope)) {
      fail(`exceptions[${index}].scope 無效：${entryScope}`);
    }
    const reason = assertExactToken(entry.reason, 'reason');
    const evidence = assertExactToken(entry.evidence, 'evidence');
    const expiryMs = parseExpiry(entry.expiry);

    const bindingFormat = scopeFormat(entryScope);
    let paths = null;
    let versions = null;
    let nodes = null;
    let ranges = null;
    if (bindingFormat === 'pnpm-legacy') {
      paths = assertExactStringList(entry.paths, 'paths');
      versions = assertExactStringList(entry.versions, 'versions');
      if (entry.nodes != null || entry.ranges != null) {
        fail(`exceptions[${index}] pnpm scope 不可含 nodes／ranges`);
      }
    } else {
      nodes = assertExactStringList(entry.nodes, 'nodes');
      ranges = assertExactStringList(entry.ranges, 'ranges', { allowSemverGlob: true });
      if (entry.paths != null || entry.versions != null) {
        fail(`exceptions[${index}] npm scope 不可含 paths／versions`);
      }
    }

    if (entryScope !== scope) {
      continue;
    }
    if (expiryMs < now) {
      fail(
        `例外已過期，不可繼續接受風險：${pkg} ${ghsa} scope=${entryScope} expiry=${entry.expiry}`,
      );
    }
    active.push({
      package: pkg,
      ghsa,
      scope: entryScope,
      reason,
      evidence,
      expiry: entry.expiry,
      format: expectedFormat,
      paths,
      versions,
      nodes,
      ranges,
    });
  }
  return active;
}

function isErrorReport(doc) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return true;
  if (Object.prototype.hasOwnProperty.call(doc, 'error') && doc.error) {
    return true;
  }
  if (
    typeof doc.message === 'string' &&
    /ENOAUDIT|EAUDIT|audit/i.test(doc.message) &&
    !doc.advisories &&
    !doc.vulnerabilities
  ) {
    return true;
  }
  return false;
}

function emptySeverityCounts() {
  return {
    info: 0,
    low: 0,
    moderate: 0,
    high: 0,
    critical: 0,
  };
}

function assertNonNegativeInt(value, label) {
  if (!Number.isInteger(value) || value < 0) {
    fail(`${label} 必須為非負整數`, [String(value)]);
  }
  return value;
}

function readMetadataCounts(doc, format) {
  if (!doc.metadata || typeof doc.metadata !== 'object' || Array.isArray(doc.metadata)) {
    fail('稽核報告缺少 metadata 物件');
  }
  const vulns = doc.metadata.vulnerabilities;
  if (!vulns || typeof vulns !== 'object' || Array.isArray(vulns)) {
    fail('稽核報告缺少 metadata.vulnerabilities 物件');
  }
  const counts = emptySeverityCounts();
  for (const sev of SEVERITIES) {
    counts[sev] = assertNonNegativeInt(vulns[sev], `metadata.vulnerabilities.${sev}`);
  }
  if (format === 'pnpm-legacy') {
    if (Object.prototype.hasOwnProperty.call(vulns, 'total')) {
      fail('pnpm-legacy metadata.vulnerabilities 不應包含 total');
    }
  } else {
    const total = assertNonNegativeInt(vulns.total, 'metadata.vulnerabilities.total');
    const sum = SEVERITIES.reduce((acc, sev) => acc + counts[sev], 0);
    if (total !== sum) {
      fail('npm metadata.vulnerabilities.total 與嚴重程度加總不符', [
        `total=${total} sum=${sum}`,
      ]);
    }
  }
  return counts;
}

function parseAuditExitCode(auditExitCode) {
  if (auditExitCode == null || auditExitCode === '') {
    return null;
  }
  if (typeof auditExitCode === 'number') {
    if (!Number.isInteger(auditExitCode) || auditExitCode < 0 || auditExitCode > 255) {
      fail(`--audit-exit-code 超出有效範圍或非整數：${auditExitCode}`);
    }
    if (auditExitCode !== 0 && auditExitCode !== 1) {
      fail(`未預期的 audit exit code（僅接受 0 或 1）：${auditExitCode}`);
    }
    return auditExitCode;
  }
  if (typeof auditExitCode !== 'string' || !/^(0|[1-9]\d*)$/.test(auditExitCode)) {
    fail(`--audit-exit-code 必須為整數：${auditExitCode}`);
  }
  const exitCode = Number(auditExitCode);
  if (!Number.isInteger(exitCode) || exitCode < 0 || exitCode > 255) {
    fail(`--audit-exit-code 超出有效範圍：${auditExitCode}`);
  }
  if (exitCode !== 0 && exitCode !== 1) {
    fail(`未預期的 audit exit code（僅接受 0 或 1）：${auditExitCode}`);
  }
  return exitCode;
}

function countPnpmFindingInstances(doc) {
  const counts = emptySeverityCounts();
  for (const advisory of Object.values(doc.advisories)) {
    if (!advisory || typeof advisory !== 'object') {
      fail('advisories 內含非物件項目');
    }
    const severity = normalizeSeverity(advisory.severity);
    if (!Object.prototype.hasOwnProperty.call(counts, severity)) {
      fail(`advisories 含未知嚴重程度：${advisory.severity}`);
    }
    if (!Array.isArray(advisory.findings)) {
      fail('pnpm advisory 缺少 findings 陣列');
    }
    counts[severity] += advisory.findings.length;
  }
  return counts;
}

function countNpmEntrySeverities(doc) {
  const counts = emptySeverityCounts();
  for (const [name, entry] of Object.entries(doc.vulnerabilities)) {
    if (!entry || typeof entry !== 'object') {
      fail(`vulnerabilities[${name}] 必須為物件`);
    }
    const severity = normalizeSeverity(entry.severity);
    if (!Object.prototype.hasOwnProperty.call(counts, severity)) {
      fail(`vulnerabilities[${name}] 含未知嚴重程度：${entry.severity}`);
    }
    counts[severity] += 1;
  }
  return counts;
}

function assertMetadataMatchesStructure(doc, format, meta) {
  const structural =
    format === 'pnpm-legacy'
      ? countPnpmFindingInstances(doc)
      : countNpmEntrySeverities(doc);
  for (const sev of SEVERITIES) {
    if (structural[sev] !== meta[sev]) {
      fail('metadata 與報告結構嚴重程度計數不符', [
        `${sev}: metadata=${meta[sev]} structure=${structural[sev]}`,
      ]);
    }
  }
}

function assertValidReport(doc, format) {
  if (isErrorReport(doc)) {
    const detail =
      doc && doc.error
        ? typeof doc.error === 'string'
          ? doc.error
          : JSON.stringify(doc.error)
        : '報告結構顯示為錯誤回應';
    fail('稽核服務錯誤或錯誤回應，不可視為通過', [detail]);
  }
  if (format === 'pnpm-legacy') {
    if (!doc.advisories || typeof doc.advisories !== 'object' || Array.isArray(doc.advisories)) {
      fail('pnpm-legacy 報告缺少 advisories 物件');
    }
  } else if (format === 'npm') {
    if (
      !doc.vulnerabilities ||
      typeof doc.vulnerabilities !== 'object' ||
      Array.isArray(doc.vulnerabilities)
    ) {
      fail('npm 報告缺少 vulnerabilities 物件');
    }
  } else {
    fail(`不支援的 format：${format}`);
  }
  const meta = readMetadataCounts(doc, format);
  assertMetadataMatchesStructure(doc, format, meta);
  return meta;
}

function assertExitConsistentWithReport(exitCode, meta, doc, format) {
  if (exitCode == null) return;
  const payloadEmpty =
    format === 'pnpm-legacy'
      ? Object.keys(doc.advisories).length === 0
      : Object.keys(doc.vulnerabilities).length === 0;
  const metaSum = SEVERITIES.reduce((acc, sev) => acc + meta[sev], 0);
  if (exitCode === 0) {
    if (!payloadEmpty || metaSum !== 0) {
      fail('audit exit 0 但報告仍含弱點／非零 metadata，不可視為通過');
    }
    return;
  }
  // exitCode === 1
  if (payloadEmpty || metaSum === 0) {
    fail('audit exit 非零但弱點清單為空（或 metadata 全為 0），不可視為通過');
  }
}

function normalizeSeverity(value) {
  if (value == null || value === '') return 'unknown';
  if (typeof value !== 'string') return 'unknown';
  return value.trim().toLowerCase();
}

function normalizeGhsa(value) {
  if (typeof value !== 'string') return '';
  const match = value.match(/GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}/i);
  if (!match) return '';
  return `GHSA-${match[0].slice(5).toLowerCase()}`;
}

function extractGhsaFromUrl(url) {
  return normalizeGhsa(url) || null;
}

function collectPnpmPathsVersions(advisory) {
  const paths = [];
  const versions = [];
  for (const finding of advisory.findings || []) {
    if (!finding || typeof finding !== 'object') {
      fail('pnpm findings 內含非物件項目');
    }
    if (typeof finding.version === 'string' && finding.version.trim() !== '') {
      if (hasWildcard(finding.version)) {
        fail(`pnpm finding version 含萬用字元：${finding.version}`);
      }
      versions.push(finding.version);
    }
    if (!Array.isArray(finding.paths)) {
      fail('pnpm finding 缺少 paths 陣列');
    }
    for (const p of finding.paths) {
      if (typeof p !== 'string' || p.trim() === '') {
        fail('pnpm finding path 必須為非空白字串');
      }
      if (hasWildcard(p)) {
        fail(`pnpm finding path 含萬用字元：${p}`);
      }
      paths.push(p);
    }
  }
  return {
    paths: uniqueSorted(paths),
    versions: uniqueSorted(versions),
  };
}

function extractPnpmFindings(doc) {
  const findings = [];
  for (const advisory of Object.values(doc.advisories)) {
    if (!advisory || typeof advisory !== 'object') {
      fail('advisories 內含非物件項目');
    }
    const severity = normalizeSeverity(advisory.severity);
    const pkg = advisory.module_name;
    const ghsa =
      normalizeGhsa(advisory.github_advisory_id) ||
      extractGhsaFromUrl(advisory.url) ||
      extractGhsaFromUrl(advisory.references) ||
      '';
    const { paths, versions } = collectPnpmPathsVersions(advisory);
    findings.push({
      package: typeof pkg === 'string' ? pkg : '',
      ghsa,
      severity,
      source: 'pnpm-legacy',
      id: advisory.id,
      title: advisory.title || '',
      paths,
      versions,
      nodes: null,
      ranges: null,
    });
  }
  return findings;
}

function severityRank(sev) {
  const order = { info: 1, low: 2, moderate: 3, high: 4, critical: 5 };
  return order[sev] || 0;
}

function validateNpmViaGraph(vulnerabilities) {
  for (const [name, entry] of Object.entries(vulnerabilities)) {
    if (!entry || typeof entry !== 'object') {
      fail(`vulnerabilities[${name}] 必須為物件`);
    }
    const via = entry.via;
    if (!Array.isArray(via)) {
      fail(`vulnerabilities[${name}].via 必須為陣列`);
    }
    for (const [i, item] of via.entries()) {
      if (typeof item === 'string') {
        if (item.trim() === '' || hasWildcard(item)) {
          fail(`vulnerabilities[${name}].via[${i}] 字串參照無效`);
        }
        if (!Object.prototype.hasOwnProperty.call(vulnerabilities, item)) {
          fail(`vulnerabilities[${name}] via 參照不存在的套件：${item}`);
        }
        continue;
      }
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        fail(`vulnerabilities[${name}].via[${i}] 格式錯誤`);
      }
    }

    // 偵測字串參照環：僅沿 string edges；用遞迴堆疊區分回邊與鑽石依賴
    const visiting = new Set();
    const visited = new Set();
    const walk = (pkg, stack) => {
      if (visiting.has(pkg)) {
        fail(`vulnerabilities via 圖出現循環：${[...stack, pkg].join(' -> ')}`);
      }
      if (visited.has(pkg)) return false;
      visiting.add(pkg);
      const node = vulnerabilities[pkg];
      let reachedAdvisory = false;
      for (const item of node.via || []) {
        if (typeof item === 'string') {
          if (!Object.prototype.hasOwnProperty.call(vulnerabilities, item)) {
            fail(`vulnerabilities[${pkg}] via 參照不存在的套件：${item}`);
          }
          if (walk(item, [...stack, pkg])) reachedAdvisory = true;
        } else if (item && typeof item === 'object') {
          reachedAdvisory = true;
        } else {
          fail(`vulnerabilities[${pkg}] via 含畸形項目`);
        }
      }
      visiting.delete(pkg);
      visited.add(pkg);
      return reachedAdvisory;
    };

    const reached = walk(name, []);
    if (!reached && via.length === 0) {
      // 無 via：允許，稍後以 entry severity 產出 finding
      continue;
    }
    if (!reached) {
      fail(`vulnerabilities[${name}] via 圖無法到達任何 advisory 物件（懸空圖）`);
    }
  }
}

function collectNpmNodesRanges(entry) {
  const nodes = [];
  if (Array.isArray(entry.nodes)) {
    for (const n of entry.nodes) {
      if (typeof n !== 'string' || n.trim() === '') {
        fail('npm vulnerability nodes 必須為非空白字串');
      }
      if (hasWildcard(n)) {
        fail(`npm vulnerability node 含萬用字元：${n}`);
      }
      nodes.push(n);
    }
  }
  const ranges = [];
  if (typeof entry.range === 'string' && entry.range.trim() !== '') {
    // semver range 可含 *（例如 *、1.x）；此處不做 glob 拒絕，改由例外精確字串集合比對
    ranges.push(entry.range);
  }
  return {
    nodes: uniqueSorted(nodes),
    ranges: uniqueSorted(ranges),
  };
}

function extractNpmFindings(doc) {
  validateNpmViaGraph(doc.vulnerabilities);
  const findings = [];

  for (const [name, entry] of Object.entries(doc.vulnerabilities)) {
    const via = Array.isArray(entry.via) ? entry.via : [];
    const { nodes, ranges } = collectNpmNodesRanges(entry);
    const entrySeverity = normalizeSeverity(entry.severity);
    let maxViaObjectSeverity = 0;
    let sawAdvisory = false;

    for (const item of via) {
      if (typeof item === 'string') continue;
      if (!item || typeof item !== 'object') {
        fail(`vulnerabilities[${name}] via 含畸形項目`);
      }
      sawAdvisory = true;
      const itemSeverity = normalizeSeverity(item.severity || entry.severity);
      maxViaObjectSeverity = Math.max(maxViaObjectSeverity, severityRank(itemSeverity));
      const ghsa =
        extractGhsaFromUrl(item.url) ||
        normalizeGhsa(item.ghsa) ||
        '';
      const itemRange =
        typeof item.range === 'string' && item.range.trim() !== ''
          ? uniqueSorted([item.range])
          : ranges;
      findings.push({
        package: typeof item.name === 'string' ? item.name : name,
        ghsa,
        severity: itemSeverity,
        source: 'npm',
        id: item.source,
        title: item.title || '',
        paths: null,
        versions: null,
        nodes,
        ranges: itemRange,
      });
    }

    // critical／high 父節點不可因下游 object 較低嚴重程度而消失
    if (
      (entrySeverity === 'critical' || entrySeverity === 'high') &&
      severityRank(entrySeverity) > maxViaObjectSeverity
    ) {
      findings.push({
        package: typeof entry.name === 'string' ? entry.name : name,
        ghsa: '',
        severity: entrySeverity,
        source: 'npm',
        id: null,
        title: '',
        paths: null,
        versions: null,
        nodes,
        ranges,
      });
    } else if (!sawAdvisory && via.length === 0) {
      findings.push({
        package: typeof entry.name === 'string' ? entry.name : name,
        ghsa: '',
        severity: entrySeverity,
        source: 'npm',
        id: null,
        title: '',
        paths: null,
        versions: null,
        nodes,
        ranges,
      });
    }
  }

  return findings;
}

function extractFindings(doc, format) {
  return format === 'pnpm-legacy' ? extractPnpmFindings(doc) : extractNpmFindings(doc);
}

function assertHighCriticalNotLost(meta, findings) {
  const parsed = emptySeverityCounts();
  for (const f of findings) {
    if (Object.prototype.hasOwnProperty.call(parsed, f.severity)) {
      parsed[f.severity] += 1;
    }
  }
  for (const sev of ['high', 'critical']) {
    if (meta[sev] > 0 && parsed[sev] === 0) {
      fail(`metadata 宣稱 ${sev}=${meta[sev]} 但解析後 findings 為 0`, [
        'high／critical 不可從解析結果消失',
      ]);
    }
  }
}

function exceptionMatches(exceptions, finding, scope) {
  return exceptions.find((ex) => {
    if (ex.scope !== scope || ex.package !== finding.package || ex.ghsa !== finding.ghsa) {
      return false;
    }
    if (finding.source === 'pnpm-legacy') {
      return (
        sameStringSet(ex.paths, finding.paths) &&
        sameStringSet(ex.versions, finding.versions)
      );
    }
    return (
      sameStringSet(ex.nodes, finding.nodes) &&
      sameStringSet(ex.ranges, finding.ranges)
    );
  });
}

function summarizeBySeverity(findings) {
  const counts = {
    critical: 0,
    high: 0,
    moderate: 0,
    low: 0,
    info: 0,
    unknown: 0,
  };
  for (const f of findings) {
    if (Object.prototype.hasOwnProperty.call(counts, f.severity)) {
      counts[f.severity] += 1;
    } else {
      counts.unknown += 1;
    }
  }
  return counts;
}

function evaluate(options) {
  const {
    reportPath,
    format,
    scope,
    exceptionsPath,
    auditExitCode,
  } = options;

  if (!reportPath) fail('必須提供 --report');
  if (!FORMATS.includes(format)) fail(`--format 必須為 ${FORMATS.join('|')}`);
  if (!SCOPES.includes(scope)) fail(`--scope 必須為 ${SCOPES.join(', ')}`);

  const exitCode = parseAuditExitCode(auditExitCode);
  const doc = readJsonFile(reportPath, '稽核報告');
  const meta = assertValidReport(doc, format);
  assertExitConsistentWithReport(exitCode, meta, doc, format);

  const exceptions = loadExceptions(exceptionsPath, scope);
  const findings = extractFindings(doc, format);
  assertHighCriticalNotLost(meta, findings);
  const counts = summarizeBySeverity(findings);

  const blockers = [];
  const acceptedHigh = [];
  const tracked = [];

  for (const finding of findings) {
    if (finding.severity === 'critical') {
      blockers.push({
        kind: 'critical',
        finding,
        message: `禁止 critical：${finding.package || '(unknown-package)'} ${finding.ghsa || '(missing-ghsa)'}`,
      });
      continue;
    }
    if (
      finding.severity === 'unknown' ||
      !['high', 'moderate', 'low', 'info'].includes(finding.severity)
    ) {
      blockers.push({
        kind: 'unknown-severity',
        finding,
        message: `未知或無法辨識的嚴重程度「${finding.severity}」：${finding.package || '(unknown-package)'} ${finding.ghsa || '(missing-ghsa)'}`,
      });
      continue;
    }
    if (finding.severity === 'high') {
      if (!finding.package || !finding.ghsa || !GHSA_RE.test(finding.ghsa)) {
        blockers.push({
          kind: 'high-incomplete',
          finding,
          message: `high 項目缺少精確 package／GHSA，無法接受例外：package=${JSON.stringify(finding.package)} ghsa=${JSON.stringify(finding.ghsa)}`,
        });
        continue;
      }
      const matched = exceptionMatches(exceptions, finding, scope);
      if (!matched) {
        blockers.push({
          kind: 'unreviewed-high',
          finding,
          message: `未審查的 high：${finding.package} ${finding.ghsa}`,
        });
      } else {
        acceptedHigh.push({ finding, exception: matched });
      }
      continue;
    }
    tracked.push(finding);
  }

  return {
    ok: blockers.length === 0,
    counts,
    findings,
    blockers,
    acceptedHigh,
    tracked,
    scope,
    format,
    reportPath,
    exceptionsPath,
    auditExitCode: exitCode,
    metadata: meta,
  };
}

function printReport(result) {
  const { counts, blockers, acceptedHigh, tracked, scope, format } = result;
  console.log(
    `[dependency-security-gate] format=${format} scope=${scope} ` +
      `critical=${counts.critical} high=${counts.high} moderate=${counts.moderate} ` +
      `low=${counts.low} info=${counts.info} unknown=${counts.unknown}`,
  );
  if (tracked.length > 0) {
    console.log(
      `[dependency-security-gate] 追蹤中（不阻擋）：moderate/low/info 共 ${tracked.length} 筆`,
    );
  }
  for (const item of acceptedHigh) {
    console.log(
      `[dependency-security-gate] 已接受 high（具例外）：${item.finding.package} ${item.finding.ghsa} ` +
        `expiry=${item.exception.expiry}`,
    );
  }
  for (const blocker of blockers) {
    console.error(`[dependency-security-gate] BLOCK ${blocker.message}`);
  }
  if (!result.ok) {
    console.error(
      `[dependency-security-gate] 失敗：${blockers.length} 個阻擋項（critical／未審查 high／未知嚴重程度／不完整 high）`,
    );
  } else {
    console.log('[dependency-security-gate] 通過政策閘門（未宣稱零弱點）');
  }
}

function main(argv = process.argv.slice(2)) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    console.error(String(err.message || err));
    console.error(usage());
    process.exitCode = 2;
    return;
  }
  if (args.help) {
    console.log(usage());
    return;
  }

  let result;
  try {
    result = evaluate({
      reportPath: args.report,
      format: args.format,
      scope: args.scope,
      exceptionsPath: args.exceptions,
      auditExitCode: args.auditExitCode,
    });
  } catch (err) {
    console.error(`[dependency-security-gate] ${err.message}`);
    if (Array.isArray(err.details)) {
      for (const line of err.details) console.error(`  ${line}`);
    }
    process.exitCode = 1;
    return;
  }

  printReport(result);
  process.exitCode = result.ok ? 0 : 1;
}

if (require.main === module) {
  main();
}

module.exports = {
  SCOPES,
  FORMATS,
  DEFAULT_EXCEPTIONS,
  parseArgs,
  evaluate,
  loadExceptions,
  extractFindings,
  assertValidReport,
  isErrorReport,
  main,
};
