#!/usr/bin/env node
'use strict';

const { spawn } = require('node:child_process');
const { accessSync, constants, statSync } = require('node:fs');
const { isAbsolute, join, resolve } = require('node:path');

function integerSetting(name, fallback, maximum) {
  const value = process.env[name] ?? String(fallback);
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > maximum) {
    throw new Error(`${name} must be an integer between 1 and ${maximum}.`);
  }
  return Number(value);
}

function serverRoot(name, fallback) {
  const root = process.env[name] ?? fallback;
  if (!root || !isAbsolute(root)) throw new Error(`${name} must be an absolute directory.`);
  try {
    if (statSync(join(root, 'server.js')).isFile()) return root;
  } catch {
    // Report the missing entrypoint without printing environment values.
  }
  throw new Error(`${name} must contain a standalone server.js.`);
}

function nodeExecutable(name, fallback) {
  const executable = process.env[name] ?? fallback;
  if (!isAbsolute(executable)) throw new Error(`${name} must be an absolute executable path.`);
  try {
    if (statSync(executable).isFile()) {
      accessSync(executable, constants.X_OK);
      return executable;
    }
  } catch {
    // Do not launch either server if the requested runtime is unavailable.
  }
  throw new Error(`${name} must be an executable file.`);
}

function main() {
  const port = integerSetting('PORT', 8080, 65535);
  const timeout = integerSetting('WEB_SHUTDOWN_TIMEOUT_MS', 10_000, 60_000);
  const servers = [
    {
      name: 'current',
      root: serverRoot('CURRENT_WEB_ROOT', resolve(__dirname, '../../apps/web')),
      port,
      hostname: '0.0.0.0',
      executable: process.execPath,
    },
  ];
  if (process.env.LEGACY_WEB_ROOT) {
    const legacyPort = integerSetting('LEGACY_WEB_PORT', 3001, 65535);
    if (legacyPort === port) throw new Error('Current and legacy web ports must be different.');
    servers.push({
      name: 'legacy',
      root: serverRoot('LEGACY_WEB_ROOT'),
      port: legacyPort,
      hostname: '127.0.0.1',
      executable: nodeExecutable('LEGACY_NODE_EXECUTABLE', process.execPath),
    });
  }

  const children = new Set();
  let stopping = false;
  let exitCode = 0;
  let shutdownTimer;
  let forceExitTimer;

  function finishIfStopped() {
    if (!stopping || children.size !== 0) return;
    clearTimeout(shutdownTimer);
    clearTimeout(forceExitTimer);
    process.exit(exitCode);
  }

  function signalChildren(signal) {
    for (const child of children) {
      try {
        child.kill(signal);
      } catch {
        exitCode = 1;
      }
    }
  }

  function stop(code, signal = 'SIGTERM') {
    if (code !== 0) exitCode = 1;
    if (stopping) return;
    stopping = true;
    signalChildren(signal);
    shutdownTimer = setTimeout(() => {
      exitCode = 1;
      console.error('Web shutdown deadline exceeded; terminating remaining servers.');
      signalChildren('SIGKILL');
      // Exit even if a child cannot deliver its exit notification.
      forceExitTimer = setTimeout(() => process.exit(1), 1000);
      finishIfStopped();
    }, timeout);
    finishIfStopped();
  }

  process.on('SIGTERM', () => stop(0, 'SIGTERM'));
  process.on('SIGINT', () => stop(0, 'SIGINT'));

  for (const server of servers) {
    const child = spawn(server.executable, ['server.js'], {
      cwd: server.root,
      stdio: 'inherit',
      // Keep credentials and WEB_PUBLIC_ORIGIN intact. Only the bind address changes.
      env: { ...process.env, PORT: String(server.port), HOSTNAME: server.hostname },
    });
    children.add(child);
    child.once('error', (error) => {
      console.error(`Unable to start ${server.name} web server (${error.code ?? 'spawn error'}).`);
      children.delete(child);
      stop(1);
      finishIfStopped();
    });
    child.once('exit', (code, signal) => {
      children.delete(child);
      if (!stopping) {
        console.error(`${server.name} web server exited unexpectedly (${signal ?? code}).`);
        stop(1);
      } else if (
        (code !== null && code !== 0) ||
        (signal && !['SIGTERM', 'SIGINT'].includes(signal))
      ) {
        exitCode = 1;
      }
      finishIfStopped();
    });
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Unable to start web servers.');
  process.exitCode = 1;
}
