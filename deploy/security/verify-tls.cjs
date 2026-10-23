#!/usr/bin/env node
'use strict';

// Run inside each deployed runtime. This probe sends no credentials or application data.
const https = require('node:https');
const http2 = require('node:http2');
const { createRequire } = require('node:module');
const { existsSync, readFileSync } = require('node:fs');
const { dirname, join, resolve } = require('node:path');
const { pathToFileURL } = require('node:url');

const targets = [
  { kind: 'trusted-control', url: 'https://nodejs.org/dist/index.json' },
  { kind: 'untrusted', url: 'https://dv-g3b-emudhra.we-have-a-problem.com/' },
  { kind: 'untrusted', url: 'https://dv-g3b-aaa-emudhra.we-have-a-problem.com/' },
];
const environmentNames = [
  'NODE_TLS_REJECT_UNAUTHORIZED', 'NODE_OPTIONS', 'NODE_EXTRA_CA_CERTS',
  'NODE_USE_SYSTEM_CA', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'CURL_CA_BUNDLE',
  'REQUESTS_CA_BUNDLE', 'GRPC_DEFAULT_SSL_ROOTS_FILE_PATH',
  'HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY', 'NO_PROXY',
];
const certificateCodes = [
  'CERT_REVOKED', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'UNABLE_TO_GET_ISSUER_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN', 'DEPTH_ZERO_SELF_SIGNED_CERT',
  'CERT_HAS_EXPIRED', 'CERT_NOT_YET_VALID', 'ERR_TLS_CERT_ALTNAME_INVALID',
  'CERT_SIGNATURE_FAILURE', 'INVALID_CA',
];

function options(args) {
  const roots = [];
  let timeout = 10000;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--help') return { help: true };
    if (args[i] === '--app-root' && args[i + 1]) roots.push(resolve(args[++i]));
    else if (args[i] === '--timeout-ms' && args[i + 1]) timeout = Number(args[++i]);
    else throw new Error('invalid-arguments');
  }
  if (!Number.isInteger(timeout) || timeout < 1000 || timeout > 30000) {
    throw new Error('invalid-timeout');
  }
  if (roots.some((root) => !existsSync(join(root, 'package.json')))) {
    throw new Error('app-root-needs-package-json');
  }
  return { roots, timeout };
}

function classify(error) {
  const pending = [error];
  const visited = new Set();
  let text = '';
  while (pending.length && visited.size < 12) {
    const item = pending.shift();
    if (!item || typeof item !== 'object' || visited.has(item)) continue;
    visited.add(item);
    text += ` ${String(item.code || '')} ${String(item.message || '')} ${String(item.details || '')}`;
    pending.push(item.cause);
    if (Array.isArray(item.errors)) pending.push(...item.errors);
  }
  for (const code of certificateCodes) {
    if (text.includes(code)) return { category: 'certificate', code };
  }
  if (/certificate (?:verify|verification) failed|unable to verify (?:the )?first certificate|unable to get (?:local )?issuer certificate|self[- ]signed certificate|certificate (?:has expired|is not yet valid)/i.test(text)) {
    return { category: 'certificate', code: 'CERTIFICATE_VERIFICATION_FAILED' };
  }
  if (/ENOTFOUND|EAI_AGAIN|name resolution/i.test(text)) return { category: 'dns' };
  if (/timeout|timed out|deadline|abort/i.test(text)) return { category: 'timeout' };
  return { category: 'transport-or-client' };
}

function httpsProbe(url, timeout) {
  return new Promise((resolveResult, reject) => {
    const req = https.get(url, { signal: AbortSignal.timeout(timeout) }, (res) => {
      resolveResult({ httpStatus: res.statusCode });
      res.destroy();
    });
    req.once('error', reject);
  });
}

function http2Probe(url, timeout) {
  return new Promise((resolveResult, reject) => {
    const target = new URL(url);
    const session = http2.connect(target.origin);
    let done = false;
    const finish = (error, result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      session.destroy();
      if (error) reject(error); else resolveResult(result);
    };
    const timer = setTimeout(() => finish(new Error('probe-timeout')), timeout);
    session.once('error', (error) => finish(error));
    session.once('connect', () => {
      try {
        const request = session.request({ ':method': 'GET', ':path': `${target.pathname}${target.search}` });
        request.once('response', (headers) => finish(null, { httpStatus: headers[':status'] }));
        request.once('error', (error) => finish(error));
        request.end();
      } catch (error) { finish(error); }
    });
  });
}

function fetchProbe(fetcher) {
  return async (url, timeout) => {
    const response = await fetcher(url, { redirect: 'manual', signal: AbortSignal.timeout(timeout) });
    if (response.body?.cancel) await response.body.cancel();
    else response.body?.destroy?.();
    return { httpStatus: response.status };
  };
}

function grpcProbe(grpc) {
  return (url, timeout) => new Promise((resolveResult, reject) => {
    const client = new grpc.Client(new URL(url).host, grpc.credentials.createSsl(), {
      'grpc.enable_retries': 0,
    });
    const timer = setTimeout(() => {
      client.close();
      reject(new Error('probe-timeout'));
    }, timeout + 250);
    client.makeUnaryRequest('/security.probe/Check', () => Buffer.alloc(0), (value) => value,
      null, new grpc.Metadata(), { deadline: Date.now() + timeout }, (error) => {
        clearTimeout(timer);
        client.close();
        if (!error) return resolveResult({ grpcStatus: 0 });
        // An HTTP response proves TLS completed even when the origin does not implement gRPC.
        const status = /Received HTTP status code (\d{3})/.exec(error.details || '');
        if (status) return resolveResult({ httpStatus: Number(status[1]) });
        reject(error);
      });
  });
}

function packageVersion(entry, name) {
  let directory = dirname(entry);
  for (;;) {
    try {
      const metadata = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
      if (metadata.name === name) return metadata.version;
    } catch {}
    const parent = dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}

async function discover(roots, clients, discovery) {
  const seen = new Set();
  for (let index = 0; index < roots.length; index++) {
    const appRequire = createRequire(join(roots[index], 'package.json'));
    for (const name of ['node-fetch', 'gaxios', 'undici', '@grpc/grpc-js']) {
      let entry;
      try { entry = appRequire.resolve(name); }
      catch { discovery.push({ appRoot: index, module: name, status: 'not-installed' }); continue; }
      if (seen.has(entry)) {
        discovery.push({ appRoot: index, module: name, status: 'same-installed-module' });
        continue;
      }
      seen.add(entry);
      const version = packageVersion(entry, name);
      try {
        const imported = await import(pathToFileURL(entry).href);
        const mod = imported.default || imported;
        let probe;
        if (name === 'node-fetch') probe = fetchProbe(mod);
        if (name === 'undici') probe = fetchProbe(mod.fetch);
        if (name === 'gaxios') probe = async (url, timeout) => {
          try {
            const result = await mod.request({ url, method: 'GET', timeout, retry: false,
              maxRedirects: 0, validateStatus: () => true, responseType: 'stream',
              signal: AbortSignal.timeout(timeout) });
            result.data?.destroy?.();
            return { httpStatus: result.status };
          } catch (error) {
            // Some versions throw for redirects even with validateStatus supplied.
            const status = error.response?.status;
            if (Number.isInteger(status) && status >= 100 && status <= 599) {
              error.response.data?.destroy?.();
              return { httpStatus: status };
            }
            throw error;
          }
        };
        if (name === '@grpc/grpc-js') probe = grpcProbe(mod);
        clients.push({ name, version, appRoot: index, probe });
        discovery.push({ appRoot: index, module: name, version, status: 'loaded' });
      } catch {
        discovery.push({ appRoot: index, module: name, version, status: 'load-failed' });
      }
    }
  }
}

async function main() {
  const config = options(process.argv.slice(2));
  if (config.help) {
    console.log('Usage: node verify-tls.cjs [--app-root /absolute/application/root] [--timeout-ms 10000]\nRepeat --app-root for separately installed clients. Run with each actual Node executable inside its container.\nFixed probes: nodejs.org (trusted control) and both Render eMudhra advisory endpoints.\nMissing optional modules are reported, never counted as passing. No credentials, CA changes, or TLS bypass.');
    return;
  }
  const report = {
    checkedAt: new Date().toISOString(),
    runtime: { node: process.version, abi: process.versions.modules, openssl: process.versions.openssl,
      platform: process.platform, arch: process.arch },
    environmentPresent: Object.fromEntries(environmentNames.map((name) => [name, Object.hasOwn(process.env, name)])),
    discovery: [], results: [], passed: false,
  };
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') {
    report.blocked = 'tls-verification-disabled';
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = 1;
    return;
  }
  const clients = [
    { name: 'global-fetch', probe: fetchProbe(globalThis.fetch) },
    { name: 'node:https', probe: httpsProbe },
    { name: 'node:http2', probe: http2Probe },
  ];
  await discover(config.roots, clients, report.discovery);
  for (const { probe, ...client } of clients) {
    const results = await Promise.all(targets.map(async (target) => {
      try {
        const response = await probe(target.url, config.timeout);
        return { client, ...target, ...response, outcome: 'response', passed: target.kind === 'trusted-control' };
      } catch (error) {
        const failure = classify(error);
        return { client, ...target, ...failure,
          outcome: failure.category === 'certificate' ? 'rejected' : 'inconclusive',
          passed: target.kind === 'untrusted' && failure.category === 'certificate' };
      }
    }));
    report.results.push(...results);
  }
  report.passed = report.results.every((result) => result.passed) &&
    report.discovery.every((entry) => entry.status !== 'load-failed');
  console.log(JSON.stringify(report, null, 2));
  if (!report.passed) process.exitCode = 1;
}

main().catch(() => {
  console.log(JSON.stringify({ passed: false, error: 'probe-setup-failed; use --help to check arguments' }));
  process.exitCode = 1;
});
