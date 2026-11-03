#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { Buffer } from 'node:buffer';
import {
  TARGETS_URL,
  EXPRESSION,
  MAX_ENTRIES,
  MAX_EVENTS,
  debuggerUrl,
  selectTarget,
  sanitizeTrace,
  collect,
  main,
} from './maestro-navigation-trace.mjs';

const URL = 'ws://127.0.0.1:8081/inspector/debug?device=test-device&page=1';
const target = (url = URL) => ({
  appId: 'com.campus.app.dev',
  type: 'node',
  webSocketDebuggerUrl: url,
});
const row = (sequence = 1) => ({ sequence, at: sequence, event: 'press', route: 'NuniWorkspace' });
function output(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-navigation-trace-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
const read = (dir, name) => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));

function fakeSocket(onSend) {
  const instances = [];
  class Socket extends EventEmitter {
    constructor(url, options) {
      super();
      this.url = url;
      this.options = options;
      this.sent = [];
      this.terminated = false;
      instances.push(this);
      globalThis.queueMicrotask(() => this.emit('open'));
    }
    send(text) {
      const message = JSON.parse(text);
      this.sent.push(message);
      onSend(this, message);
    }
    terminate() {
      this.terminated = true;
    }
  }
  return { Socket, instances };
}
const reply = (socket, id, value) =>
  socket.emit(
    'message',
    Buffer.from(
      JSON.stringify({
        id,
        result: { result: { value: JSON.stringify(value) } },
      }),
    ),
    false,
  );

test('accepts only the two loopback hosts, fixed port and Metro debugger query', () => {
  assert.equal(debuggerUrl(URL), URL);
  assert.equal(
    debuggerUrl(URL.replace('127.0.0.1', 'localhost')),
    URL.replace('127.0.0.1', 'localhost'),
  );
  assert.equal(debuggerUrl(URL.replace('page=1', 'page=-1')), URL.replace('page=1', 'page=-1'));
  for (const value of [
    'ws://evil.invalid:8081/inspector/debug?device=test&page=1',
    URL.replace('127.0.0.1', 'localhost.evil.invalid'),
    URL.replace('127.0.0.1', '2130706433'),
    URL.replace('127.0.0.1', '0x7f000001'),
    URL.replace('127.0.0.1', 'user@localhost'),
    URL.replace('127.0.0.1', 'localhost:password@127.0.0.1'),
    URL.replace(':8081', ':8082'),
    URL.replace('ws:', 'wss:'),
    URL.replace('ws:', 'http:'),
    URL.replace('/inspector/debug', '/other'),
    URL.replace('/inspector/debug', '/other/../inspector/debug'),
    `${URL}#secret`,
    `${URL}#`,
    `${URL}&token=secret`,
    `${URL}&page=2`,
    `${URL}&device=second`,
    URL.replace('test-device', 'secret%0Avalue'),
    URL.replace('test-device', 'test-device%0A'),
    URL.replace('page=1', 'page=1%0A'),
    URL.replace('page=1', 'page=secret'),
    URL.replace('test-device', 'a'.repeat(201)),
    URL.replace('127.0.0.1', 'localhost\\@evil.invalid'),
    null,
    {},
    '',
  ])
    assert.equal(debuggerUrl(value), null, String(value));
});

test('refuses other apps, ambiguous targets and external URLs without a sole-target fallback', () => {
  assert.equal(selectTarget([target()]), URL);
  assert.equal(selectTarget([{ ...target(), appId: 'other.app' }]), null);
  assert.equal(selectTarget([{ ...target(), type: 'page' }]), null);
  assert.equal(selectTarget([target(), target()]), null);
  assert.equal(
    selectTarget([target('ws://evil.invalid:8081/inspector/debug?device=x&page=1')]),
    null,
  );
  assert.equal(selectTarget({ webSocketDebuggerUrl: URL }), null);
  assert.equal(selectTarget(Array.from({ length: 51 }, () => target())), null);
});

test('keeps only known events, routes, scalar fields and minimal state', () => {
  const clean = sanitizeTrace([
    {
      ...row(),
      dispatched: true,
      session: 'secret-session',
      token: 'secret-token',
      params: { email: 'secret@example.invalid' },
      state: {
        index: 1,
        routeNames: ['LoginLanding', 'NuniWorkspace', 'secret-route'],
        routes: [{ name: 'NuniWorkspace', params: { token: 'secret-token' } }],
        history: 'secret-history',
      },
    },
  ]);
  assert.deepEqual(clean, [
    {
      ...row(),
      dispatched: true,
      state: { index: 1, routeNames: ['LoginLanding', 'NuniWorkspace'] },
    },
  ]);
  assert.equal(JSON.stringify(clean).includes('secret'), false);
  assert.deepEqual(
    sanitizeTrace([
      { ...row(), event: 'secret-event' },
      { ...row(), route: 'secret-route' },
      { ...row(), sequence: Infinity },
      { ...row(), at: NaN },
      { ...row(), sequence: -1 },
      { ...row(), sequence: '1' },
      null,
    ]),
    [],
  );
});

test('accepts numeric layout records but rejects arbitrary event text and invalid state values', () => {
  const event = 'layout-y:123.3333282470703-height:50';
  assert.equal(sanitizeTrace([{ ...row(), event }])[0].event, event);
  assert.deepEqual(sanitizeTrace([{ ...row(), event: `${event}\n` }]), []);
  assert.deepEqual(sanitizeTrace([{ ...row(), event: 'layout-y:secret-height:50' }]), []);
  assert.deepEqual(sanitizeTrace([{ ...row(), event: 'layout-y:999999-height:50' }]), []);
  assert.deepEqual(
    sanitizeTrace([
      { ...row(), dispatched: 'secret', state: { index: NaN, routeNames: ['secret'] } },
    ]),
    [{ ...row(), state: { routeNames: [] } }],
  );
  const entries = sanitizeTrace(Array.from({ length: MAX_ENTRIES + 20 }, (_, i) => row(i)));
  assert.equal(entries.length, MAX_ENTRIES);
  assert.equal(entries[0].sequence, 20);
});

test('SIGTERM preserves sanitized trace and ignores arbitrary console and unsolicited replies', async (t) => {
  const dir = output(t);
  const signals = new EventEmitter();
  const requests = [];
  const { Socket, instances } = fakeSocket((socket, command) => {
    socket.emit(
      'message',
      Buffer.from(
        JSON.stringify({
          method: 'Runtime.consoleAPICalled',
          params: { args: [{ value: 'secret-console' }] },
        }),
      ),
      false,
    );
    reply(socket, command.id + 1, [{ ...row(), params: 'secret-unsolicited' }]);
    reply(socket, command.id, [{ ...row(), params: 'secret-params' }]);
    globalThis.queueMicrotask(() => signals.emit('SIGTERM'));
  });
  const result = await main([dir, '1000'], {
    signals,
    WebSocketImpl: Socket,
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return new globalThis.Response(JSON.stringify([target()]));
    },
  });
  assert.deepEqual(result, { entries: 1, stoppedBySignal: true });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, TARGETS_URL);
  assert.equal(requests[0].options.redirect, 'error');
  assert.equal(instances[0].url, URL);
  assert.equal(instances[0].options.followRedirects, false);
  assert.equal(instances[0].options.maxPayload, 2_000_000);
  assert.deepEqual(instances[0].sent, [
    {
      id: 1,
      method: 'Runtime.evaluate',
      params: { expression: EXPRESSION, returnByValue: true, silent: true },
    },
  ]);
  assert.equal(instances[0].terminated, true);
  assert.deepEqual(read(dir, 'navigation-trace.json'), [row()]);
  assert.equal(read(dir, 'collector-events.json').at(-1).kind, 'stopped-by-signal');
  assert.equal(signals.listenerCount('SIGTERM'), 0);
  assert.equal(signals.listenerCount('SIGINT'), 0);
  assert.equal(
    fs.readdirSync(dir).some((name) => name.includes('console')),
    false,
  );
  assert.equal(
    fs.readFileSync(path.join(dir, 'navigation-trace.json'), 'utf8').includes('secret'),
    false,
  );
});

test('ignores malformed, binary and oversized messages without losing a valid reply', async (t) => {
  const dir = output(t);
  const stop = new globalThis.AbortController();
  const { Socket } = fakeSocket((socket, command) => {
    for (const value of ['null', '[]', '12', '"secret"', '{'])
      socket.emit('message', Buffer.from(value), false);
    socket.emit('message', Buffer.alloc(2_000_001, 'x'), false);
    socket.emit('message', Buffer.from('secret binary data'), true);
    reply(socket, command.id, [row()]);
    globalThis.queueMicrotask(() => stop.abort());
  });
  await collect({
    outputDir: dir,
    durationMs: 1000,
    signal: stop.signal,
    WebSocketImpl: Socket,
    fetchImpl: async () => new globalThis.Response(JSON.stringify([target()])),
  });
  assert.deepEqual(read(dir, 'navigation-trace.json'), [row()]);
});

test('does not connect when the target list returns a redirect or an external debugger', async (t) => {
  for (const response of [
    { ok: false, status: 302, body: null },
    { ok: true, redirected: true, body: null },
    { ok: true, url: 'https://evil.invalid/list', body: null },
    new globalThis.Response(
      JSON.stringify([target('ws://evil.invalid:8081/inspector/debug?device=x&page=1')]),
    ),
  ]) {
    const dir = output(t);
    let connections = 0;
    await collect({
      outputDir: dir,
      durationMs: 15,
      retryMs: 1000,
      fetchImpl: async () => response,
      WebSocketImpl: class {
        constructor() {
          connections++;
        }
      },
    });
    assert.equal(connections, 0);
    assert.deepEqual(read(dir, 'navigation-trace.json'), []);
  }
});

test('bounds HTTP data and stops even when an injected fetch never settles', async (t) => {
  for (const fetchImpl of [
    async () => new globalThis.Response('x'.repeat(64_001)),
    () => new Promise(() => {}),
  ]) {
    const dir = output(t);
    const started = Date.now();
    const result = await collect({
      outputDir: dir,
      durationMs: 20,
      retryMs: 1000,
      fetchImpl,
      WebSocketImpl: class {},
    });
    assert.equal(result.entries, 0);
    assert.ok(Date.now() - started < 1000);
    assert.equal(read(dir, 'collector-events.json').at(-1).kind, 'duration-complete');
  }
});

test('keeps at most one pending evaluation and closes an unresponsive debugger', async (t) => {
  const dir = output(t);
  const { Socket, instances } = fakeSocket(() => {});
  await collect({
    outputDir: dir,
    durationMs: 35,
    requestMs: 10,
    pollMs: 1,
    retryMs: 1000,
    fetchImpl: async () => new globalThis.Response(JSON.stringify([target()])),
    WebSocketImpl: Socket,
  });
  assert.equal(instances.length, 1);
  assert.equal(instances[0].sent.length, 1);
  assert.equal(instances[0].terminated, true);
  assert.ok(read(dir, 'collector-events.json').some((entry) => entry.kind === 'response-timeout'));
});

test('deduplicates repeated snapshots and caps the persisted trace buffer', async (t) => {
  const dir = output(t);
  const stop = new globalThis.AbortController();
  let count = 0;
  const { Socket } = fakeSocket((socket, command) => {
    count++;
    reply(
      socket,
      command.id,
      Array.from({ length: MAX_ENTRIES }, (_, i) => row(i + (count === 1 ? 0 : 100))),
    );
    if (count === 3) globalThis.queueMicrotask(() => stop.abort());
  });
  await collect({
    outputDir: dir,
    durationMs: 1000,
    pollMs: 1,
    signal: stop.signal,
    WebSocketImpl: Socket,
    fetchImpl: async () => new globalThis.Response(JSON.stringify([target()])),
  });
  const saved = read(dir, 'navigation-trace.json');
  assert.equal(saved.length, MAX_ENTRIES);
  assert.equal(saved[0].sequence, 100);
  assert.equal(saved.at(-1).sequence, 2099);
  assert.ok(read(dir, 'collector-events.json').length <= MAX_EVENTS);
});

test('validates the maximum duration before starting network activity', async (t) => {
  const dir = output(t);
  let requests = 0;
  for (const durationMs of [0, -1, 600_001, Infinity, '100']) {
    await assert.rejects(
      collect({
        outputDir: dir,
        durationMs,
        fetchImpl: async () => {
          requests++;
        },
      }),
      /invalid-duration/,
    );
  }
  assert.equal(requests, 0);
});
