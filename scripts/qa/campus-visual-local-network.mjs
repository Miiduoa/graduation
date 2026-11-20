// Test-process-only network guard. Never imported by the application.
// Browser routing cannot intercept requests made by the Next server itself.
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import process from 'node:process';
import { URL } from 'node:url';
import { syncBuiltinESMExports } from 'node:module';

const localPorts = new Set([1, 3137]);
const blocked = () => new Error('Browser QA server cannot connect outside its local fixtures');
function checkDestination(host, port) {
  if (host !== '127.0.0.1' || !localPorts.has(Number(port))) throw blocked();
}
function checkUrl(input) {
  const url = new URL(input);
  if (!['http:', 'https:'].includes(url.protocol)) throw blocked();
  checkDestination(url.hostname, url.port || (url.protocol === 'https:' ? 443 : 80));
}

// Validate before invoking fetch. Runtime-provided fetch implementations may
// not use the dispatcher installed by a separately imported Undici package.
const fetch = globalThis.fetch;
globalThis.fetch = async function guardedFetch(input, init) {
  checkUrl(typeof input === 'string' || input instanceof URL ? input : input.url);
  // Runtime fetch may follow redirects without passing through Node's sockets.
  return Reflect.apply(fetch, this, [input, { ...init, redirect: 'error' }]);
};

for (const transport of [http, https]) {
  for (const method of ['get', 'request']) {
    const original = transport[method];
    transport[method] = function guardedRequest(input, ...args) {
      if (typeof input === 'string' || input instanceof URL) checkUrl(input);
      const options = input && typeof input === 'object' && !(input instanceof URL)
        ? input
        : args[0] && typeof args[0] === 'object' ? args[0] : {};
      if (options.socketPath) throw blocked();
      if (options.hostname || options.host || options.port) {
        const url = typeof input === 'string' || input instanceof URL ? new URL(input) : null;
        checkDestination(
          options.hostname || options.host || url?.hostname,
          options.port || url?.port || (transport === https ? 443 : 80),
        );
      }
      return Reflect.apply(original, this, [input, ...args]);
    };
  }
}

// Also reject non-fetch HTTP/TLS clients before a TCP connection can be made.
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function guardedConnect(...args) {
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];
  const options = first && typeof first === 'object'
    ? first
    : typeof first === 'number'
      ? { host: typeof args[1] === 'string' ? args[1] : 'localhost', port: first }
      : typeof first === 'string'
        ? { path: first }
        : null;
  if (!options || options.path) throw blocked();
  checkDestination(options.host, options.port);
  return Reflect.apply(connect, this, args);
};

// Readiness must identify this process, never another server on the same port.
const runId = process.env.NUNI_QA_RUN_ID;
if (!runId || !/^[a-zA-Z0-9-]{8,80}$/.test(runId)) {
  throw new Error('NUNI_QA_RUN_ID is required by the browser QA guard');
}
const emit = http.Server.prototype.emit;
http.Server.prototype.emit = function guardedEmit(event, ...args) {
  if (event === 'request') args[1].setHeader('X-Nuni-QA-Run', runId);
  return Reflect.apply(emit, this, [event, ...args]);
};
syncBuiltinESMExports();
