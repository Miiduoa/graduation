import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';

const root = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(join(root, 'source.json'), 'utf8'));
const fixture = JSON.parse(readFileSync(join(root, 'fixtures/synthetic-auth.json'), 'utf8'));
const image = manifest.imageTag;
// Colima/Docker Desktop often cannot mount macOS /var/folders into containers.
// Keep owned scratch under the work tree so bind mounts stay readable.
const ownedScratchRoot = resolve(root, '../../../legacy-web-scratch/auth-contract-scratch');

function docker(...args) {
  return spawnSync('docker', args, { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
}

function imageExists() {
  return docker('image', 'inspect', image, '--format', '{{.Id}}').status === 0;
}

function cookiePairs(response) {
  const raw = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [];
  return raw.map((entry) => entry.split(';')[0]);
}

function pickCookie(pairs, name) {
  return pairs.find((pair) => pair.startsWith(`${name}=`)) || null;
}

function assertCookieAttrs(setCookieHeader, name, { maxAge = null, cleared = false } = {}) {
  assert.ok(setCookieHeader, `missing Set-Cookie for ${name}`);
  assert.match(setCookieHeader, new RegExp(`^${name}=`));
  assert.match(setCookieHeader, /HttpOnly/i);
  assert.match(setCookieHeader, /Secure/i);
  assert.match(setCookieHeader, /SameSite=Lax/i);
  assert.match(setCookieHeader, /Path=\//i);
  assert.doesNotMatch(setCookieHeader, /Domain=/i);
  if (cleared || maxAge === 0) {
    assert.match(setCookieHeader, /Max-Age=0/i);
  } else if (typeof maxAge === 'number') {
    assert.match(setCookieHeader, new RegExp(`Max-Age=${maxAge}`, 'i'));
  }
}

async function waitHealthy(origin, attempts = 60) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const live = await fetch(`${origin}/health/live`);
      if (live.ok) return;
    } catch {
      // amd64 emulation cold start
    }
    await delay(500);
  }
  throw new Error('legacy container did not become live');
}

async function readBody(response) {
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: response.status, text, json, headers: response.headers };
}

test('rebuilt image exists for linux/amd64 with Next 16.4.2 and sharp 0.35.5 via next require', async (t) => {
  if (!imageExists()) {
    t.skip(`local image ${image} not built yet — not a pass`);
    return;
  }
  const inspect = docker(
    'image',
    'inspect',
    image,
    '--format',
    '{{.Id}}\t{{.Architecture}}\t{{.Os}}\t{{index .Config.Labels "org.opencontainers.image.revision"}}',
  );
  assert.equal(inspect.status, 0, inspect.stderr);
  const [id, arch, os, revision] = inspect.stdout.trim().split('\t');
  assert.ok(id.startsWith('sha256:'));
  assert.equal(arch, 'amd64');
  assert.equal(os, 'linux');
  assert.equal(revision, manifest.candidateTree);

  const pins = docker(
    'run',
    '--rm',
    '--platform',
    'linux/amd64',
    '--entrypoint',
    'node',
    image,
    '-e',
    `
const {createRequire}=require('node:module');
const fs=require('node:fs');
const path=require('node:path');
const root='/app';
const serverRequire=createRequire('/app/apps/web/server.js');
const next=serverRequire('next/package.json');
const nextRequire=createRequire(serverRequire.resolve('next'));
function ver(req,name){const entry=req.resolve(name); let dir=path.dirname(entry); for(let i=0;i<8;i++){const c=path.join(dir,'package.json'); if(fs.existsSync(c)){const p=JSON.parse(fs.readFileSync(c,'utf8')); if(p.name===name) return p.version;} const parent=path.dirname(dir); if(parent===dir) break; dir=parent;} throw new Error(name);}
function inventory(name){const versions=new Set(); const todo=[path.join(root,'node_modules'),path.join(root,'apps/web/node_modules')]; const seen=new Set(); while(todo.length){const dir=todo.pop(); let real; try{real=fs.realpathSync(dir);}catch{continue} if(!(real===root||real.startsWith(root+'/'))||seen.has(real)) continue; seen.add(real); let ents; try{ents=fs.readdirSync(real,{withFileTypes:true});}catch{continue} for(const e of ents){const full=path.join(real,e.name); if(e.isDirectory()||e.isSymbolicLink()) todo.push(full); else if(e.name==='package.json'){try{const p=JSON.parse(fs.readFileSync(full,'utf8')); if(p.name===name) versions.add(p.version);}catch{}}}} return [...versions].sort();}
const sharp=nextRequire('sharp');
if (typeof sharp !== 'function') throw new Error('sharp missing');
console.log(JSON.stringify({next:next.version,sharp:ver(nextRequire,'sharp'),sharpAll:inventory('sharp'),smAll:inventory('source-map-js')}));
`,
  );
  assert.equal(pins.status, 0, pins.stderr);
  assert.deepEqual(JSON.parse(pins.stdout), {
    next: '16.4.2',
    sharp: '0.35.5',
    sharpAll: ['0.35.5'],
    smAll: ['1.2.2'],
  });
});

test('synthetic TLS upstream auth contract: start/exchange/session/logout + public routes', async (t) => {
  if (!imageExists()) {
    t.skip(`local image ${image} not built yet — not a pass`);
    return;
  }

  mkdirSync(ownedScratchRoot, { recursive: true });
  const scratch = mkdtempSync(join(ownedScratchRoot, 'run-'));
  const certDir = join(scratch, 'certs');
  const network = `nuni-legacy-auth-${Date.now()}`;
  const sidecar = `nuni-legacy-sidecar-${Date.now()}`;
  const web = `nuni-legacy-web-${Date.now()}`;
  const gen = spawnSync('bash', [join(root, 'scripts/gen-test-certs.sh'), certDir], {
    encoding: 'utf8',
  });
  assert.equal(gen.status, 0, gen.stderr || gen.stdout);
  // Ensure the container (often uid 0) can read keys bind-mounted from macOS.
  spawnSync('chmod', ['-R', 'a+rX', certDir], { encoding: 'utf8' });

  const net = docker('network', 'create', network);
  assert.equal(net.status, 0, net.stderr);

  const side = docker(
    'run',
    '-d',
    '--name',
    sidecar,
    '--network',
    network,
    '--network-alias',
    'campus-api.test',
    '--network-alias',
    'oauth2.googleapis.com',
    '-p',
    '127.0.0.1::9080',
    '-v',
    `${certDir}:/certs:ro`,
    '-v',
    `${join(root, 'scripts')}:/scripts:ro`,
    '-v',
    `${join(root, 'fixtures')}:/fixtures:ro`,
    '-e',
    'SYNTHETIC_CERT_DIR=/certs',
    '-e',
    'SYNTHETIC_FIXTURE=/fixtures/synthetic-auth.json',
    '-e',
    'SYNTHETIC_PORT=443',
    '-e',
    'SYNTHETIC_ADMIN_PORT=9080',
    '--workdir',
    '/scripts',
    'node:24.22.1-alpine@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53',
    'node',
    '/scripts/synthetic-upstream.mjs',
  );
  assert.equal(side.status, 0, side.stderr);

  // Wait for TLS sidecar admin before exercising the web broker.
  {
    let adminReady = false;
    let lastDiag = '';
    for (let i = 0; i < 60; i += 1) {
      const running = docker('inspect', '-f', '{{.State.Running}} {{.State.Status}}', sidecar);
      const execProbe = docker(
        'exec',
        sidecar,
        'node',
        '-e',
        "fetch('http://127.0.0.1:9080/__synthetic__/calls').then(r=>process.exit(r.ok?0:2)).catch(()=>process.exit(1))",
      );
      if (execProbe.status === 0) {
        adminReady = true;
        break;
      }
      const logs = docker('logs', '--tail', '20', sidecar);
      lastDiag = `running=${running.stdout.trim()} exec=${execProbe.status} logs=${logs.stdout || logs.stderr}`;
      await delay(500);
    }
    assert.equal(adminReady, true, `synthetic TLS sidecar admin did not become ready: ${lastDiag}`);
  }

  const run = docker(
    'run',
    '-d',
    '--name',
    web,
    '--network',
    network,
    '--platform',
    'linux/amd64',
    '-p',
    '127.0.0.1::3000',
    '-v',
    `${certDir}/ca.pem:/test-ca/ca.pem:ro`,
    '-e',
    'NODE_ENV=production',
    '-e',
    `WEB_PUBLIC_ORIGIN=${fixture.webPublicOrigin}`,
    '-e',
    'CAMPUS_API_URL=https://campus-api.test',
    '-e',
    'ACCOUNT_LOGIN_TRANSACTION_SECRET=synthetic-account-transaction-secret-at-least-32',
    '-e',
    'BFF_SESSION_SECRET=synthetic-bff-session-secret-at-least-32-characters',
    '-e',
    'NODE_EXTRA_CA_CERTS=/test-ca/ca.pem',
    '-e',
    'PLATFORM_GOOGLE_LOGIN_ENABLED=false',
    '--memory',
    '512m',
    '--user',
    'node',
    image,
  );
  assert.equal(run.status, 0, run.stderr);

  try {
    const webPort = docker('port', web, '3000/tcp');
    assert.equal(webPort.status, 0, webPort.stderr);
    const origin = `http://127.0.0.1:${webPort.stdout.trim().split(':').pop()}`;
    await waitHealthy(origin);

    const who = docker('exec', web, 'id', '-u');
    assert.equal(who.status, 0, who.stderr);
    assert.notEqual(who.stdout.trim(), '0');

    const account = await fetch(`${origin}/auth/account`);
    assert.equal(account.status, 200);
    assert.match(await account.text(), /帳號|登入|account|school/i);

    const tokenGet = await fetch(`${origin}/auth/account/token`, { method: 'GET' });
    assert.equal(tokenGet.status, 405, 'GET /auth/account/token must be 405 (POST-only)');

    const sessionCold = await fetch(`${origin}/auth/session`);
    assert.equal(sessionCold.status, 401);
    assert.deepEqual(await sessionCold.json(), { authenticated: false });

    const crossOrigin = await fetch(`${origin}/auth/account/token`, {
      method: 'POST',
      headers: {
        Origin: 'https://attacker.example',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        grantType: 'start',
        tenantId: fixture.tenantId,
        kind: fixture.kind,
      }),
    });
    assert.equal(crossOrigin.status, 403);

    const startRes = await fetch(`${origin}/auth/account/token`, {
      method: 'POST',
      headers: {
        Origin: fixture.webPublicOrigin,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        grantType: 'start',
        tenantId: fixture.tenantId,
        kind: fixture.kind,
      }),
    });
    const start = await readBody(startRes);
    assert.equal(start.status, 200, start.text);
    assert.equal(start.headers.get('cache-control'), 'no-store');
    assert.equal(start.json.tenantId, fixture.tenantId);
    assert.equal(start.json.kind, fixture.kind);
    assert.equal(start.json.issuer, fixture.issuer);
    assert.equal(start.json.clientId, fixture.clientId);
    assert.equal(start.json.nonce, fixture.nonce);
    const startCookies = start.headers.getSetCookie?.() || [];
    const txSet = startCookies.find((c) => c.startsWith('__Host-campus-account-transaction='));
    assertCookieAttrs(txSet, '__Host-campus-account-transaction', { maxAge: 600 });
    const txPair = pickCookie(cookiePairs(startRes), '__Host-campus-account-transaction');
    assert.ok(txPair);

    const exchangeRes = await fetch(`${origin}/auth/account/token`, {
      method: 'POST',
      headers: {
        Origin: fixture.webPublicOrigin,
        'content-type': 'application/json',
        Cookie: txPair,
      },
      body: JSON.stringify({
        grantType: 'exchange',
        code: fixture.code,
        codeVerifier: fixture.codeVerifier,
      }),
    });
    const exchange = await readBody(exchangeRes);
    assert.equal(exchange.status, 200, exchange.text);
    assert.deepEqual(exchange.json, { authenticated: true, expiresIn: 900 });
    assert.doesNotMatch(
      JSON.stringify(exchange.json),
      /synthetic-provider-id-token|synthetic-campus-access-token|ws_/,
    );
    const exchangeCookies = exchange.headers.getSetCookie?.() || [];
    const bffSet = exchangeCookies.find((c) => c.startsWith('__Host-campus-bff-session='));
    assertCookieAttrs(bffSet, '__Host-campus-bff-session');
    const clearedTx = exchangeCookies.find((c) => c.startsWith('__Host-campus-account-transaction='));
    assertCookieAttrs(clearedTx, '__Host-campus-account-transaction', { cleared: true });
    const clearedRefresh = exchangeCookies.find((c) => c.startsWith('__Host-campus-refresh='));
    assertCookieAttrs(clearedRefresh, '__Host-campus-refresh', { cleared: true });
    const bffPair = pickCookie(cookiePairs(exchangeRes), '__Host-campus-bff-session');
    assert.ok(bffPair);
    const savedBff = bffPair;

    const expectedContext = createHash('sha256')
      .update(`campus-web-view-v1\0campus-account\0${fixture.handle}`)
      .digest('hex');
    const sessionRes = await fetch(`${origin}/auth/session`, {
      headers: { Cookie: bffPair },
    });
    const session = await readBody(sessionRes);
    assert.equal(session.status, 200, session.text);
    assert.equal(session.headers.get('cache-control'), 'no-store');
    assert.deepEqual(session.json, {
      authenticated: true,
      family: 'campus-account',
      expiresIn: 900,
      sessionContext: expectedContext,
    });

    const logoutRes = await fetch(`${origin}/auth/account/token`, {
      method: 'POST',
      headers: {
        Origin: fixture.webPublicOrigin,
        'content-type': 'application/json',
        Cookie: bffPair,
      },
      body: JSON.stringify({ grantType: 'logout' }),
    });
    const logout = await readBody(logoutRes);
    assert.equal(logout.status, 200, logout.text);
    assert.deepEqual(logout.json, { revoked: true });
    const logoutCookies = logout.headers.getSetCookie?.() || [];
    const clearedBff = logoutCookies.find((c) => c.startsWith('__Host-campus-bff-session='));
    assertCookieAttrs(clearedBff, '__Host-campus-bff-session', { cleared: true });

    const staleRes = await fetch(`${origin}/auth/session`, {
      headers: { Cookie: savedBff },
    });
    const stale = await readBody(staleRes);
    assert.equal(stale.status, 401);
    assert.deepEqual(stale.json, { authenticated: false });

    const start2Res = await fetch(`${origin}/auth/account/token`, {
      method: 'POST',
      headers: {
        Origin: fixture.webPublicOrigin,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        grantType: 'start',
        tenantId: fixture.tenantId,
        kind: fixture.kind,
      }),
    });
    const start2 = await readBody(start2Res);
    assert.equal(start2.status, 200, start2.text);
    const tx2 = pickCookie(cookiePairs(start2Res), '__Host-campus-account-transaction');
    const exchange2Res = await fetch(`${origin}/auth/account/token`, {
      method: 'POST',
      headers: {
        Origin: fixture.webPublicOrigin,
        'content-type': 'application/json',
        Cookie: tx2,
      },
      body: JSON.stringify({
        grantType: 'exchange',
        code: fixture.code,
        codeVerifier: fixture.codeVerifier,
      }),
    });
    const exchange2 = await readBody(exchange2Res);
    assert.equal(exchange2.status, 200, exchange2.text);
    const bff2 = pickCookie(cookiePairs(exchange2Res), '__Host-campus-bff-session');

    const alias = await fetch(`${origin}/auth/logout`, {
      method: 'GET',
      redirect: 'manual',
      headers: { Cookie: bff2 },
    });
    assert.equal(alias.status, 303);
    assert.equal(alias.headers.get('location'), '/auth/account');

    const aliasPost = await fetch(`${origin}/auth/logout`, {
      method: 'POST',
      redirect: 'manual',
    });
    assert.equal(aliasPost.status, 303);
    assert.equal(aliasPost.headers.get('location'), '/auth/account');

    for (const path of ['/privacy', '/terms', '/support']) {
      const page = await fetch(`${origin}${path}`);
      assert.equal(page.status, 200, path);
      assert.match(await page.text(), /隱私|條款|支援|support|privacy|terms/i);
    }

    const adminPort = docker('port', sidecar, '9080/tcp');
    assert.equal(adminPort.status, 0, adminPort.stderr);
    const adminOrigin = `http://127.0.0.1:${adminPort.stdout.trim().split(':').pop()}`;
    const callsRaw = await fetch(`${adminOrigin}/__synthetic__/calls`);
    const callsRes = await readBody(callsRaw);
    assert.equal(callsRes.status, 200, callsRes.text);
    const { calls } = callsRes.json;
    const paths = calls.map((c) => `${c.host} ${c.method} ${c.path}`);
    assert.ok(paths.includes('campus-api.test POST /v1/auth/account/login-transactions'));
    assert.ok(paths.includes('oauth2.googleapis.com POST /token'));
    assert.ok(paths.includes('campus-api.test POST /v1/auth/account/sessions'));
    assert.ok(paths.includes('campus-api.test POST /v1/auth/web/sessions'));
    assert.ok(paths.includes('campus-api.test GET /v1/auth/web/sessions/current'));
    assert.ok(paths.includes('campus-api.test POST /v1/auth/account/sessions/logout'));
    assert.ok(paths.includes('campus-api.test POST /v1/auth/web/sessions/logout'));

    const stop = docker('stop', '-t', '10', web);
    assert.equal(stop.status, 0, stop.stderr);
  } finally {
    docker('rm', '-f', web);
    docker('rm', '-f', sidecar);
    docker('network', 'rm', network);
    rmSync(scratch, { recursive: true, force: true });
  }
});
