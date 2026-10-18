'use strict';

const { parseArgs } = require('node:util');
const { parseSyncSchoolIds, schoolConfig, listSources } = require('./catalog');
const { syncSchool } = require('./sync');

function parseProbe(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      schools: { type: 'string' },
    },
    strict: true,
    allowPositionals: false,
  });
  const schoolIds = parseSyncSchoolIds(values.schools || 'ncku,ntpu');
  if (!schoolIds.length) throw new Error('請指定 --schools（例如 --schools ncku,ntpu）');
  return { schoolIds };
}

function sourceSeverity(source, result) {
  if (result.status !== 'unavailable') return 'ok';
  if (result.reason === 'parse_empty' && source.fragile === 'spa') return 'warn';
  if (result.reason === 'no_public_sources') return 'error';
  if (String(result.reason || '').startsWith('http_') || result.reason === 'fetch_failed') {
    return 'error';
  }
  if (result.reason === 'parse_empty' || result.reason === 'count_drop') return 'error';
  return 'error';
}

async function probeSchools(schoolIds, deps = {}) {
  const schools = [];
  for (const schoolId of schoolIds) {
    const config = schoolConfig(schoolId);
    if (!config) {
      schools.push({
        schoolId,
        status: 'unavailable',
        reason: 'unknown_school',
        severity: 'error',
        sources: [],
      });
      continue;
    }
    const result = await syncSchool(schoolId, { ...deps, dryRun: true, db: undefined });
    const listed = listSources(schoolId);
    const sources = (result.sources || []).map((item) => {
      const source = listed.find((row) => row.sourceId === item.sourceId) || {};
      const severity = sourceSeverity(source, item);
      return {
        sourceId: item.sourceId,
        office: item.office,
        listUrl: source.listUrl || '',
        fragile: source.fragile || '',
        status: item.status,
        reason: item.reason || '',
        itemCount: item.itemCount || 0,
        severity,
      };
    });
    const severity = sources.some((item) => item.severity === 'error')
      ? 'error'
      : sources.some((item) => item.severity === 'warn')
        ? 'warn'
        : result.status === 'unavailable'
          ? 'error'
          : 'ok';
    schools.push({
      schoolId,
      status: result.status,
      reason: result.reason || '',
      severity,
      sources,
    });
  }
  return {
    dryRun: true,
    wrote: false,
    schools,
    failed: schools.some((item) => item.severity === 'error'),
  };
}

async function runProbe(argv, deps = {}) {
  const options = parseProbe(argv);
  return probeSchools(options.schoolIds, deps);
}

async function main() {
  const summary = await runProbe(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  if (summary.failed) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  });
}

module.exports = {
  parseProbe,
  sourceSeverity,
  probeSchools,
  runProbe,
};
