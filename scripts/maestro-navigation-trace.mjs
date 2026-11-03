#!/usr/bin/env node
// Diagnostic only. This never drives the app or evaluates a Maestro result.
// Usage: node scripts/maestro-navigation-trace.mjs OUTPUT_DIR [DURATION_MS]
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import console from 'node:console';
import { Buffer } from 'node:buffer';
import { URL, pathToFileURL } from 'node:url';
import { clearInterval, clearTimeout, setInterval, setTimeout } from 'node:timers';
import WebSocket from 'ws';

const TARGETS_URL = 'http://127.0.0.1:8081/json/list';
const APP_ID = 'com.campus.app.dev';
const MAX_DURATION_MS = 600_000;
const MAX_ENTRIES = 2000;
const MAX_EVENTS = 200;
const MAX_LIST_BYTES = 64_000;
const MAX_MESSAGE_BYTES = 2_000_000;
const EXPRESSION =
  'JSON.stringify(Array.isArray(globalThis.__e2eNavTrace) ? globalThis.__e2eNavTrace.slice(-2000) : [])';
const ROUTES = new Set([
  'PublicNavigation',
  'LoginLanding',
  'NuniWorkspace',
  'SSOLogin',
  'Map',
  'Library',
  'LibraryCatalog',
  'SchoolInfo',
  'BusSchedule',
  '公告總覽',
  '公告詳情',
  'CourseCatalog',
  'Health',
  'Dormitory',
  'Career',
  'PersonalImport',
  'PersonalTimetable',
  'PersonalCalendar',
]);
const SCROLL_EVENTS = new Set([
  'scroll-begin',
  'scroll-end',
  'momentum-begin',
  'momentum-end',
  'scroll-offset',
]);
const TARGET_NAMES = new Set(['google-heading', 'login-start']);
const TARGET_TRIGGERS = new Set([
  'layout',
  'scroll-begin',
  'scroll-end',
  'momentum-begin',
  'momentum-end',
]);
const EVENTS = new Set([
  'mount',
  'unmount',
  'ready',
  'state',
  'focus',
  'blur',
  'press-in',
  'press-out',
  'press',
  'dispatch-return',
  'auth-loading',
  'auth-pending-logout',
  'auth-error',
  'auth-session',
  'auth-signed-out',
  ...SCROLL_EVENTS,
  'target-measure',
]);

function debuggerUrl(value) {
  if (
    typeof value !== 'string' ||
    value.length > 700 ||
    !/^ws:\/\/(?:localhost|127\.0\.0\.1):8081\/inspector\/debug\?/.test(value) ||
    /[\s\\#]/.test(value)
  )
    return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (
    url.protocol !== 'ws:' ||
    !['localhost', '127.0.0.1'].includes(url.hostname) ||
    url.port !== '8081' ||
    url.pathname !== '/inspector/debug' ||
    url.username ||
    url.password ||
    url.hash
  )
    return null;
  const entries = [...url.searchParams.entries()];
  if (
    entries.length !== 2 ||
    url.searchParams.getAll('device').length !== 1 ||
    url.searchParams.getAll('page').length !== 1 ||
    !/^[A-Za-z0-9_.:-]{1,200}$/.test(url.searchParams.get('device')) ||
    !/^-?\d{1,10}$/.test(url.searchParams.get('page'))
  )
    return null;
  return url.href;
}

function selectTarget(value) {
  if (!Array.isArray(value) || value.length > 50) return null;
  const targets = value.filter((item) => item && item.appId === APP_ID && item.type === 'node');
  return targets.length === 1 ? debuggerUrl(targets[0].webSocketDebuggerUrl) : null;
}

function allowedEvent(value) {
  if (EVENTS.has(value)) return true;
  if (typeof value !== 'string' || value.length > 100) return false;
  const layout = /^layout-y:(-?\d{1,6}(?:\.\d{1,16})?)-height:(\d{1,6}(?:\.\d{1,16})?)$/.exec(
    value,
  );
  return !!layout && Math.abs(Number(layout[1])) <= 100_000 && Number(layout[2]) <= 100_000;
}

function boundedNumbers(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const clean = {};
  for (const [key, min, max] of fields) {
    const number = value[key];
    if (Number.isFinite(number) && number >= min && number <= max) clean[key] = number;
  }
  return Object.keys(clean).length ? clean : undefined;
}

function sanitizeTrace(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(-MAX_ENTRIES).flatMap((entry) => {
    if (
      !entry ||
      typeof entry !== 'object' ||
      !Number.isSafeInteger(entry.sequence) ||
      entry.sequence < 0 ||
      !Number.isSafeInteger(entry.at) ||
      entry.at < 0 ||
      !allowedEvent(entry.event) ||
      !ROUTES.has(entry.route)
    )
      return [];
    const clean = {
      sequence: entry.sequence,
      event: entry.event,
      route: entry.route,
      at: entry.at,
    };
    if (typeof entry.dispatched === 'boolean') clean.dispatched = entry.dispatched;
    const state = entry.state;
    if (state && typeof state === 'object') {
      clean.state = {};
      if (Number.isInteger(state.index) && state.index >= 0 && state.index < 40)
        clean.state.index = state.index;
      if (Array.isArray(state.routeNames))
        clean.state.routeNames = state.routeNames.slice(0, 40).filter((name) => ROUTES.has(name));
    }
    if (entry.route === 'LoginLanding' && SCROLL_EVENTS.has(entry.event)) {
      const scroll = boundedNumbers(entry.scroll, [
        ['offsetY', -100_000, 100_000],
        ['viewportHeight', 0, 100_000],
        ['contentHeight', 0, 100_000],
        ['nativeTimestamp', 0, Number.MAX_SAFE_INTEGER],
      ]);
      if (scroll) clean.scroll = scroll;
    }
    if (
      entry.route === 'LoginLanding' &&
      entry.event === 'target-measure' &&
      entry.target &&
      !Array.isArray(entry.target) &&
      TARGET_NAMES.has(entry.target.name) &&
      TARGET_TRIGGERS.has(entry.target.trigger)
    ) {
      clean.target = {
        name: entry.target.name,
        trigger: entry.target.trigger,
        ...boundedNumbers(entry.target, [
          ['x', -100_000, 100_000],
          ['y', -100_000, 100_000],
          ['width', 0, 100_000],
          ['height', 0, 100_000],
        ]),
      };
      if (Number.isSafeInteger(entry.target.requestedAt) && entry.target.requestedAt >= 0)
        clean.target.requestedAt = entry.target.requestedAt;
    }
    return [clean];
  });
}

function abortable(work, signal) {
  return new Promise((resolve, reject) => {
    const aborted = () => reject(new Error('stopped'));
    if (signal.aborted) return aborted();
    signal.addEventListener('abort', aborted, { once: true });
    Promise.resolve(work)
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', aborted));
  });
}

async function readTargets(fetchImpl, signal) {
  const response = await abortable(
    fetchImpl(TARGETS_URL, {
      redirect: 'error',
      cache: 'no-store',
      signal,
    }),
    signal,
  );
  if (
    !response.ok ||
    response.redirected ||
    (response.url && response.url !== TARGETS_URL) ||
    !response.body
  )
    throw new Error('target-list-unavailable');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await abortable(reader.read(), signal);
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_LIST_BYTES) throw new Error('target-list-too-large');
      chunks.push(Buffer.from(chunk.value));
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally {
    void reader.cancel().catch(() => {});
  }
}

function delay(ms, signal) {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    signal.addEventListener('abort', finish, { once: true });
  });
}

async function collect({
  outputDir,
  durationMs = MAX_DURATION_MS,
  signal,
  fetchImpl = globalThis.fetch,
  WebSocketImpl,
  pollMs = 500,
  retryMs = 1000,
  requestMs = 5000,
}) {
  if (!Number.isInteger(durationMs) || durationMs < 1 || durationMs > MAX_DURATION_MS)
    throw new Error('invalid-duration');
  if (typeof outputDir !== 'string' || !outputDir || typeof fetchImpl !== 'function')
    throw new Error('invalid-configuration');
  for (const interval of [pollMs, retryMs, requestMs])
    if (!Number.isInteger(interval) || interval < 1 || interval > 10_000)
      throw new Error('invalid-interval');
  // The repository already supplies ws; maxPayload bounds frames before JSON parsing.
  const Socket = WebSocketImpl ?? WebSocket;
  const output = path.resolve(outputDir);
  fs.mkdirSync(output, { recursive: true, mode: 0o700 });
  const deadline = new globalThis.AbortController();
  const timer = setTimeout(() => deadline.abort(), durationMs);
  const stopped = signal ? globalThis.AbortSignal.any([signal, deadline.signal]) : deadline.signal;
  const traces = new Map();
  const events = [];
  let nextId = 0;
  const save = () => {
    for (const [name, value] of [
      ['navigation-trace.json', [...traces.values()]],
      ['collector-events.json', events],
    ]) {
      const file = path.join(output, name);
      fs.writeFileSync(`${file}.tmp`, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
      fs.renameSync(`${file}.tmp`, file);
    }
  };
  const event = (kind) => {
    events.push({ at: Date.now(), kind });
    if (events.length > MAX_EVENTS) events.shift();
    save();
  };
  const readSocket = (url) =>
    new Promise((resolve) => {
      let socket;
      let polling;
      let responseTimer;
      let pendingId = null;
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        clearInterval(polling);
        clearTimeout(responseTimer);
        stopped.removeEventListener('abort', finish);
        if (socket) {
          socket.removeAllListeners();
          socket.on('error', () => {});
          socket.terminate();
        }
        resolve();
      };
      if (stopped.aborted) return finish();
      stopped.addEventListener('abort', finish, { once: true });
      try {
        socket = new Socket(url, {
          maxPayload: MAX_MESSAGE_BYTES,
          followRedirects: false,
          handshakeTimeout: requestMs,
        });
        socket.on('error', () => {
          event('socket-error');
          finish();
        });
        socket.on('close', () => {
          event('disconnected');
          finish();
        });
        socket.on('message', (raw, isBinary) => {
          if (finished || isBinary || Buffer.byteLength(raw) > MAX_MESSAGE_BYTES) return;
          let message;
          try {
            message = JSON.parse(raw.toString());
          } catch {
            return;
          }
          // Ignore all notifications, including Runtime.consoleAPICalled, and unsolicited replies.
          if (
            !message ||
            typeof message !== 'object' ||
            Array.isArray(message) ||
            pendingId === null ||
            message.id !== pendingId
          )
            return;
          pendingId = null;
          clearTimeout(responseTimer);
          const value = message.result?.result?.value;
          if (typeof value !== 'string' || Buffer.byteLength(value) > MAX_MESSAGE_BYTES) return;
          let trace;
          try {
            trace = JSON.parse(value);
          } catch {
            return;
          }
          for (const entry of sanitizeTrace(trace)) {
            traces.set(JSON.stringify(entry), entry);
            if (traces.size > MAX_ENTRIES) traces.delete(traces.keys().next().value);
          }
          save();
        });
        socket.on('open', () => {
          if (finished) return;
          event('connected');
          const poll = () => {
            if (finished || pendingId !== null) return;
            pendingId = ++nextId;
            responseTimer = setTimeout(() => {
              event('response-timeout');
              finish();
            }, requestMs);
            try {
              socket.send(
                JSON.stringify({
                  id: pendingId,
                  method: 'Runtime.evaluate',
                  params: { expression: EXPRESSION, returnByValue: true, silent: true },
                }),
              );
            } catch {
              event('socket-error');
              finish();
            }
          };
          poll();
          if (!finished) polling = setInterval(poll, pollMs);
        });
      } catch {
        event('socket-error');
        finish();
      }
    });

  try {
    event('started');
    while (!stopped.aborted) {
      try {
        const timeout = globalThis.AbortSignal.timeout(requestMs);
        const url = selectTarget(
          await readTargets(fetchImpl, globalThis.AbortSignal.any([stopped, timeout])),
        );
        if (stopped.aborted) break;
        if (url) await readSocket(url);
        else event('target-unavailable');
      } catch {
        if (!stopped.aborted) event('target-list-unavailable');
      }
      await delay(retryMs, stopped);
    }
  } finally {
    clearTimeout(timer);
    event(signal?.aborted ? 'stopped-by-signal' : 'duration-complete');
  }
  return { entries: traces.size, stoppedBySignal: !!signal?.aborted };
}

async function main(args, dependencies = {}) {
  const signals = dependencies.signals ?? process;
  const controller = new globalThis.AbortController();
  const stop = () => controller.abort();
  if (args.length < 1 || args.length > 2) throw new Error('invalid-arguments');
  signals.on('SIGTERM', stop);
  signals.on('SIGINT', stop);
  try {
    return await collect({
      ...dependencies,
      outputDir: args[0],
      durationMs: args[1] === undefined ? MAX_DURATION_MS : Number(args[1]),
      signal: controller.signal,
    });
  } finally {
    signals.off('SIGTERM', stop);
    signals.off('SIGINT', stop);
  }
}

export {
  TARGETS_URL,
  EXPRESSION,
  MAX_ENTRIES,
  MAX_EVENTS,
  debuggerUrl,
  selectTarget,
  sanitizeTrace,
  collect,
  main,
};
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main(process.argv.slice(2)).catch(() => {
    console.error(
      'Navigation trace collection failed. Usage: maestro-navigation-trace.mjs OUTPUT_DIR [DURATION_MS]',
    );
    process.exitCode = 1;
  });
}
