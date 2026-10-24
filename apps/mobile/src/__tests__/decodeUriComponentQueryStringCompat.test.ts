/**
 * Proves security-pinned decode-uri-component@0.5.1 stays usable via the
 * patched query-string@7.1.3 runtime interop (not a Jest mapper/shim):
 * - plain Node require of installed query-string
 * - React Navigation path ↔ state under Jest
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { getPathFromState, getStateFromPath } from '@react-navigation/native';

const requireFromMobile = createRequire(__filename);

function resolvePackageRoot(name: string): string {
  // Prefer entry resolve: package.json is often blocked by "exports".
  return path.dirname(requireFromMobile.resolve(name));
}

describe('decode-uri-component + query-string runtime compat', () => {
  test('pins decode-uri-component@0.5.1 and ships patched query-string interop', () => {
    const decodePkg = JSON.parse(
      fs.readFileSync(path.join(resolvePackageRoot('decode-uri-component'), 'package.json'), 'utf8'),
    );
    expect(decodePkg.version).toBe('0.5.1');
    expect(decodePkg.type).toBe('module');

    const queryStringSrc = fs.readFileSync(
      path.join(resolvePackageRoot('query-string'), 'index.js'),
      'utf8',
    );
    expect(queryStringSrc).toContain("require('decode-uri-component')");
    expect(queryStringSrc).toMatch(/typeof .+ === 'function'/);
    expect(queryStringSrc).toContain('.default');
  });

  test('plain Node installed query-string decode/encode/parse (no Jest mapper)', () => {
    // Absolute installed path — not a Jest mapper or invented module alias.
    const queryStringEntry = requireFromMobile.resolve('query-string');
    const script = `
      const qs = require(${JSON.stringify(queryStringEntry)});
      const unicode = qs.parse('foo=st%C3%A5le&bar=%25');
      const malformed = qs.parse('x=%&y=%C2&z=%E0%A4');
      const encoded = qs.stringify({ q: 'ståle 100%', id: 'a b' }, { sort: false });
      const roundTrip = qs.parse(encoded);
      console.log(JSON.stringify({
        unicode,
        malformed,
        encoded,
        roundTrip,
        decode: typeof qs.parse,
        encode: typeof qs.stringify,
        entry: ${JSON.stringify(queryStringEntry)},
      }));
    `;

    const raw = execFileSync(process.execPath, ['-e', script], {
      encoding: 'utf8',
      env: process.env,
    }).trim();

    const result = JSON.parse(raw);
    expect(result.decode).toBe('function');
    expect(result.encode).toBe('function');
    expect(result.entry).toContain('query-string');
    expect(result.unicode).toEqual({ foo: 'ståle', bar: '%' });
    // 0.5.1: invalid % sequences stay bounded (no throw); lone % kept, truncated UTF-8 → U+FFFD
    expect(result.malformed.x).toBe('%');
    expect(result.malformed.y).toBe('\uFFFD');
    expect(typeof result.malformed.z).toBe('string');
    expect(result.roundTrip).toEqual({ q: 'ståle 100%', id: 'a b' });
  });

  test('query-string under Jest uses patched interop for unicode and malformed payloads', () => {
    const queryString = requireFromMobile('query-string') as typeof import('query-string');

    const encoded = queryString.stringify({ q: 'ståle 100%', id: 'a b' }, { sort: false });
    expect(encoded).toMatch(/q=/);
    const parsed = queryString.parse(encoded);
    expect(parsed.q).toBe('ståle 100%');
    expect(parsed.id).toBe('a b');

    const fromUrl = queryString.parse('foo=st%C3%A5le&bar=%25');
    expect(fromUrl.foo).toBe('ståle');
    expect(fromUrl.bar).toBe('%');

    const malformed = queryString.parse('x=%&y=%C2&z=%E0%A4');
    expect(malformed.x).toBe('%');
    expect(malformed.y).toBe('\uFFFD');
    // Truncated multi-byte percent sequence left as literal under 0.5.1
    expect(malformed.z).toBe('%E0%A4');
  });

  test('React Navigation getPathFromState / getStateFromPath preserve query params', () => {
    const config = {
      screens: {
        Home: {
          path: 'home',
          screens: {
            Detail: 'detail',
          },
        },
      },
    };

    const state = {
      routes: [
        {
          name: 'Home',
          state: {
            routes: [
              {
                name: 'Detail',
                params: { q: 'ståle', pct: '%' },
              },
            ],
          },
        },
      ],
    };

    const pathFromState = getPathFromState(state as any, config as any);
    expect(pathFromState).toContain('detail');
    expect(pathFromState).toMatch(/[?&]q=/);
    expect(pathFromState).toMatch(/[?&]pct=/);

    const restored = getStateFromPath(pathFromState, config as any);
    const leaf = restored?.routes?.[0]?.state?.routes?.[0];
    expect(leaf?.name).toBe('Detail');
    expect(leaf?.params).toMatchObject({ q: 'ståle', pct: '%' });
  });
});
