import https from 'node:https';
import type { ClientRequest, IncomingMessage } from 'node:http';

export type Ipv4RequestOptions = https.RequestOptions;

export type Ipv4RequestFn = (
  options: Ipv4RequestOptions,
  callback?: (response: IncomingMessage) => void,
) => ClientRequest;

function headerRecord(headers?: HeadersInit): Record<string, string> {
  const result: Record<string, string> = {};
  new Headers(headers).forEach((value, key) => {
    result[key] = value;
  });
  return result;
}

function bodyBuffer(body: BodyInit | null | undefined): Buffer | undefined {
  if (body == null) return undefined;
  if (typeof body === 'string' || body instanceof Uint8Array) return Buffer.from(body);
  return Buffer.from(String(body));
}

/**
 * 校園入口預設只走 IPv4。TronClass／身分主機有 AAAA，但雲端來源常在 TCP 連上後
 * 等不到 TLS；Functions 端已用 family: 4，這裡對齊，避免再先踩空的 IPv6。
 */
export function createIpv4PinnedFetch(
  request: Ipv4RequestFn = https.request,
): (url: string, init?: RequestInit) => Promise<Response> {
  return (url, init = {}) =>
    new Promise((resolve, reject) => {
      let target: URL;
      try {
        target = new URL(String(url));
      } catch (error) {
        reject(error);
        return;
      }
      if (target.protocol !== 'https:') {
        reject(new TypeError('只支援 https 校園連線'));
        return;
      }

      const body = bodyBuffer(init.body);
      const headers = headerRecord(init.headers);
      if (body && !Object.keys(headers).some((key) => key.toLowerCase() === 'content-length')) {
        headers['Content-Length'] = String(body.length);
      }

      const options: Ipv4RequestOptions = {
        protocol: 'https:',
        hostname: target.hostname,
        port: target.port ? Number(target.port) : 443,
        path: `${target.pathname}${target.search}`,
        method: init.method || 'GET',
        headers,
        family: 4,
        servername: target.hostname,
      };

      let settled = false;
      const finish = (action: () => void) => {
        if (settled) return;
        settled = true;
        action();
      };

      const req = request(options, (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        response.on('end', () => {
          const out = new Headers();
          for (const [key, value] of Object.entries(response.headers)) {
            if (value == null) continue;
            if (key.toLowerCase() === 'set-cookie') {
              for (const cookie of Array.isArray(value) ? value : [value]) {
                out.append('set-cookie', cookie);
              }
            } else {
              out.set(key, Array.isArray(value) ? value.join(', ') : value);
            }
          }
          finish(() =>
            resolve(
              new Response(Buffer.concat(chunks), {
                status: response.statusCode || 0,
                statusText: response.statusMessage || '',
                headers: out,
              }),
            ),
          );
        });
        response.on('error', (error) => finish(() => reject(error)));
      });

      const abort = () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        req.destroy(error);
      };

      req.on('error', (error) => finish(() => reject(error)));
      if (init.signal?.aborted) {
        abort();
        return;
      }
      init.signal?.addEventListener('abort', abort, { once: true });
      if (body) req.write(body);
      req.end();
    });
}
