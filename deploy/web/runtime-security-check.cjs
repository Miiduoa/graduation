#!/usr/bin/env node
'use strict';

const {
  accessSync,
  constants,
  readdirSync,
  readFileSync,
  realpathSync,
} = require('node:fs');
const { createRequire } = require('node:module');
const { basename, dirname, join, relative, sep } = require('node:path');

const APPROVED_NEXT_VERSION = '16.4.2';
const APPROVED_SHARP_VERSION = '0.35.5';
const APPROVED_SOURCE_MAP_JS_VERSION = '1.2.2';
const APPROVED_PACKAGES = Object.freeze({
  next: APPROVED_NEXT_VERSION,
  sharp: APPROVED_SHARP_VERSION,
  'source-map-js': APPROVED_SOURCE_MAP_JS_VERSION,
});
const REQUIRED_PACKAGES = Object.freeze(['next', 'sharp']);
const TARGET_PACKAGE_NAMES = Object.freeze(['next', 'sharp', 'source-map-js']);
const TARGET_PACKAGE_NAME_SET = new Set(TARGET_PACKAGE_NAMES);
const TRAVERSAL_LIMIT = 50_000;

const DEFAULT_RUNTIME_ROOTS = Object.freeze({
  current: '/app',
  legacy: '/legacy/app',
});

const DEFAULT_SERVER_PATHS = Object.freeze({
  current: join(DEFAULT_RUNTIME_ROOTS.current, 'apps/web/server.js'),
  legacy: join(DEFAULT_RUNTIME_ROOTS.legacy, 'apps/web/server.js'),
});

function emptyTargetMap() {
  return { next: [], sharp: [], 'source-map-js': [] };
}

function isAppsWebLayout(appsWebDir) {
  return basename(appsWebDir) === 'web' && basename(dirname(appsWebDir)) === 'apps';
}

function moduleStartsForRuntimeRoot(runtimeRoot) {
  return [
    join(runtimeRoot, 'node_modules'),
    join(runtimeRoot, 'apps/web/node_modules'),
  ];
}

function contextFromAppsWebRoot(appsWebRoot) {
  if (typeof appsWebRoot !== 'string' || !appsWebRoot) return null;
  if (isAppsWebLayout(appsWebRoot)) {
    const runtimeRoot = dirname(dirname(appsWebRoot));
    return {
      runtimeRoot,
      serverPath: join(appsWebRoot, 'server.js'),
      moduleStarts: moduleStartsForRuntimeRoot(runtimeRoot),
    };
  }
  // Fixture roots are apps/web stand-ins (server.js + node_modules at the root).
  return {
    runtimeRoot: appsWebRoot,
    serverPath: join(appsWebRoot, 'server.js'),
    moduleStarts: [join(appsWebRoot, 'node_modules')],
  };
}

function contextFromServerPath(serverPath) {
  if (typeof serverPath !== 'string' || !serverPath) return null;
  return contextFromAppsWebRoot(dirname(serverPath));
}

function contextFromProductionRoot(runtimeRoot) {
  return {
    runtimeRoot,
    serverPath: join(runtimeRoot, 'apps/web/server.js'),
    moduleStarts: moduleStartsForRuntimeRoot(runtimeRoot),
  };
}

function resolveContexts(options = {}) {
  if (options.roots) {
    return {
      current: contextFromAppsWebRoot(options.roots.current),
      legacy: contextFromAppsWebRoot(options.roots.legacy),
    };
  }
  if (options.paths) {
    return {
      current: contextFromServerPath(options.paths.current),
      legacy: contextFromServerPath(options.paths.legacy),
    };
  }
  return {
    current: contextFromProductionRoot(DEFAULT_RUNTIME_ROOTS.current),
    legacy: contextFromProductionRoot(DEFAULT_RUNTIME_ROOTS.legacy),
  };
}

function resolveServerPaths(options = {}) {
  if (options.paths) return options.paths;
  if (options.roots) {
    return {
      current: join(options.roots.current, 'server.js'),
      legacy: join(options.roots.legacy, 'server.js'),
    };
  }
  return DEFAULT_SERVER_PATHS;
}

function readPackageJson(packagePath) {
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(packagePath, 'utf8'));
  } catch {
    const error = new Error('malformed-package');
    error.code = 'malformed-package';
    throw error;
  }
  if (!pkg || typeof pkg !== 'object' || typeof pkg.version !== 'string' || !pkg.version) {
    const error = new Error('malformed-package');
    error.code = 'malformed-package';
    throw error;
  }
  return pkg;
}

function readNextVersion(serverPath) {
  accessSync(serverPath, constants.R_OK);
  const packagePath = createRequire(serverPath).resolve('next/package.json');
  let pkg;
  try {
    pkg = readPackageJson(packagePath);
  } catch (error) {
    if (error?.code === 'malformed-package') {
      const nextError = new Error('malformed-next-package');
      nextError.code = 'malformed-next-package';
      throw nextError;
    }
    throw error;
  }
  if (typeof pkg.name === 'string' && pkg.name !== 'next') {
    const error = new Error('malformed-next-package');
    error.code = 'malformed-next-package';
    throw error;
  }
  return { packagePath, version: pkg.version };
}

function underRoot(realPath, rootReal) {
  return realPath === rootReal || realPath.startsWith(rootReal + sep);
}

function sanitizeInstancePath(runtimeRoot, packageDir) {
  const rel = relative(runtimeRoot, packageDir);
  if (!rel || rel.startsWith('..') || rel.includes(`..${sep}`)) {
    return basename(packageDir);
  }
  return rel.split(sep).join('/');
}

/**
 * Walk module directories only. Read target package.json name/version from disk
 * (not require.resolve — package exports may hide metadata). Never execute package code.
 */
function scanTargetPackages(runtimeRoot, moduleStarts) {
  const found = emptyTargetMap();
  let rootReal;
  try {
    rootReal = realpathSync(runtimeRoot);
  } catch {
    const error = new Error('absent-runtime-root');
    error.code = 'absent-runtime-root';
    throw error;
  }

  const todo = [...moduleStarts];
  const seen = new Set();

  while (todo.length) {
    const dir = todo.pop();
    let real;
    try {
      real = realpathSync(dir);
    } catch {
      continue;
    }
    if (!underRoot(real, rootReal) || seen.has(real)) continue;
    seen.add(real);
    if (seen.size > TRAVERSAL_LIMIT) {
      const error = new Error('traversal-limit');
      error.code = 'traversal-limit';
      throw error;
    }

    let entries;
    try {
      entries = readdirSync(real, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const full = join(real, entry.name);
      if (entry.isDirectory() || entry.isSymbolicLink()) {
        todo.push(full);
        continue;
      }
      if (entry.name !== 'package.json') continue;

      const dirName = basename(real);
      if (!TARGET_PACKAGE_NAME_SET.has(dirName)) continue;

      let pkg;
      try {
        pkg = readPackageJson(full);
      } catch (error) {
        if (error?.code === 'malformed-package') {
          if (dirName === 'next') {
            const nextError = new Error('malformed-next-package');
            nextError.code = 'malformed-next-package';
            throw nextError;
          }
          throw error;
        }
        throw error;
      }
      if (pkg.name !== dirName) {
        const error = new Error(dirName === 'next' ? 'malformed-next-package' : 'malformed-package');
        error.code = error.message;
        throw error;
      }

      found[dirName].push({
        version: pkg.version,
        path: sanitizeInstancePath(runtimeRoot, real),
      });
    }
  }

  return found;
}

function classifyFailure(error) {
  if (
    error?.code === 'malformed-next-package' ||
    error?.code === 'ERR_INVALID_PACKAGE_CONFIG'
  ) {
    return 'malformed-next-package';
  }
  if (error?.code === 'malformed-package') return 'malformed-package';
  if (error?.code === 'absent-required-package') return 'absent-required-package';
  if (error?.code === 'absent-runtime-root') return 'absent-next-runtime';
  if (error?.code === 'ENOENT' || error?.code === 'MODULE_NOT_FOUND') return 'absent-next-runtime';
  if (error?.code === 'traversal-limit') return 'runtime-security-check-failed';
  return 'runtime-security-check-failed';
}

function validateScannedPackages(packages, approved) {
  for (const name of REQUIRED_PACKAGES) {
    const instances = packages[name];
    if (!instances || instances.length === 0) {
      return name === 'next' ? 'absent-next-runtime' : 'absent-required-package';
    }
    for (const instance of instances) {
      if (instance.version !== approved[name]) return 'version-mismatch';
    }
  }
  for (const instance of packages['source-map-js'] || []) {
    if (instance.version !== approved['source-map-js']) return 'version-mismatch';
  }
  return null;
}

/** Inspect current + legacy Next/sharp/source-map-js pins without executing package code. */
function checkRuntimeSecurity(options = {}) {
  const expectedVersion = options.expectedVersion || APPROVED_NEXT_VERSION;
  const expectedPackages = {
    next: expectedVersion,
    sharp: options.expectedSharpVersion || APPROVED_SHARP_VERSION,
    'source-map-js': options.expectedSourceMapJsVersion || APPROVED_SOURCE_MAP_JS_VERSION,
  };
  const contexts = resolveContexts(options);
  const runtimes = {};
  const report = {
    ok: false,
    expectedVersion,
    expectedPackages,
    runtimes,
  };

  let firstError = null;

  for (const name of ['current', 'legacy']) {
    const context = contexts[name];
    if (!context || typeof context.serverPath !== 'string' || !context.serverPath) {
      runtimes[name] = { serverPath: context?.serverPath || null, version: null, packages: emptyTargetMap() };
      if (!firstError) firstError = 'absent-next-runtime';
      continue;
    }

    const serverPath = context.serverPath;
    let packagePath = null;
    let version = null;
    let packages = emptyTargetMap();

    try {
      // Runnable server + Next resolution (createRequire), independent per root.
      ({ packagePath, version } = readNextVersion(serverPath));
    } catch (error) {
      runtimes[name] = { serverPath, version: null, packages };
      if (!firstError) firstError = classifyFailure(error);
      continue;
    }

    try {
      // Directory scan explains every installed target instance (incl. nested copies).
      packages = scanTargetPackages(context.runtimeRoot, context.moduleStarts);
    } catch (error) {
      runtimes[name] = { serverPath, packagePath, version, packages };
      if (!firstError) firstError = classifyFailure(error);
      continue;
    }

    runtimes[name] = { serverPath, packagePath, version, packages };

    if (version !== expectedPackages.next) {
      if (!firstError) firstError = 'version-mismatch';
      continue;
    }

    const scanError = validateScannedPackages(packages, expectedPackages);
    if (scanError && !firstError) firstError = scanError;
  }

  if (firstError) {
    report.error = firstError;
    return report;
  }

  report.ok = true;
  return report;
}

function main(argv = process.argv.slice(2)) {
  const expectedVersion = argv[0] || APPROVED_NEXT_VERSION;
  if (!/^\d+\.\d+\.\d+$/.test(expectedVersion)) {
    console.log(JSON.stringify({ ok: false, error: 'invalid-expected-version' }));
    process.exitCode = 1;
    return;
  }
  const report = checkRuntimeSecurity({ expectedVersion });
  console.log(JSON.stringify(report));
  if (!report.ok) process.exitCode = 1;
}

// `node - < script` sets argv[1] to "-" and does not set require.main === module.
const ranDirectly =
  require.main === module || process.argv[1] === '-' || module.id === '[stdin]';
if (ranDirectly) {
  try {
    main();
  } catch {
    console.log(JSON.stringify({ ok: false, error: 'runtime-security-check-failed' }));
    process.exitCode = 1;
  }
}

module.exports = {
  APPROVED_NEXT_VERSION,
  APPROVED_SHARP_VERSION,
  APPROVED_SOURCE_MAP_JS_VERSION,
  APPROVED_PACKAGES,
  DEFAULT_SERVER_PATHS,
  DEFAULT_RUNTIME_ROOTS,
  TARGET_PACKAGE_NAMES,
  checkRuntimeSecurity,
  readNextVersion,
  scanTargetPackages,
  main,
};
