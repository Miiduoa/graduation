import { strict as assert } from 'node:assert';
import { it } from 'vitest';
import {
  schoolPortalFor, schoolPortalOrigin, readPortalCapture, schoolPortalCaptureScript,
  PORTAL_CAPTURE_LIMIT,
} from '@campus/shared/src/imports/portalCapture';
const portal = schoolPortalFor('pu')!;
const origin = 'https://alcat.pu.edu.tw';
const request = { id: 'read_12345678', origin };
const html = '<h2>115 學年度第 1 學期</h2><table><tr><th>課程名稱</th><th>學分</th></tr><tr><td>統計學</td><td>3</td></tr></table>';
const payload = (overrides = {}) => JSON.stringify({ version: 1, ...request, html, blockedFrames: 0, ...overrides });
const read = (data = payload()) => readPortalCapture(portal, request, `${origin}/grades`, `${origin}/grades`, data);
it('retains the exact school namespace including canonical aliases', () => {
  assert.equal(schoolPortalFor('tw-nchu')?.schoolId, 'tw-nchu');
  assert.equal(schoolPortalFor('tw-nchu')?.domain, 'nchu.edu.tw');
  assert.equal(schoolPortalFor('nccu')?.url, 'https://i.nccu.edu.tw/');
  assert.equal(schoolPortalFor('ncu')?.url, 'https://portal.ncu.edu.tw/');
  assert.equal(schoolPortalFor('all'), null);
  assert.equal(schoolPortalFor('__proto__'), null);
  assert.equal(schoolPortalFor('unknown'), null);
});
it('allows only HTTPS school hosts and their label-delimited subdomains', () => {
  assert.equal(schoolPortalOrigin(portal, origin + '/grades?view=1'), origin);
  assert.equal(schoolPortalOrigin(portal, 'https://pu.edu.tw/'), 'https://pu.edu.tw');
  assert.equal(schoolPortalOrigin(portal, 'https://ALCAT.PU.EDU.TW:443/'), origin);
});
for (const url of [
  'http://alcat.pu.edu.tw/', 'https://pu.edu.tw.evil.example/', 'https://evilpu.edu.tw/',
  'https://pu.edu.tw@evil.example/', 'https://user:secret@alcat.pu.edu.tw/',
  'https://alcat.pu.edu.tw:8443/', 'javascript:alert(1)', 'file:///private/data',
  'intent://pu.edu.tw/', 'data:text/html,hello', ' https://alcat.pu.edu.tw/',
  'https://alcat.pu.edu.tw/\\evil', 'https://portal.nchu.edu.tw/',
]) it(`rejects out-of-scope navigation ${url}`, () => assert.equal(schoolPortalOrigin(portal, url), null));
it('accepts sanitized table text only during the expected request', () => {
  assert.deepEqual(read(), { status: 'ok', value: { html, origin, blockedFrames: 0 } });
  assert.deepEqual(readPortalCapture(portal, null, origin, origin, payload()), { status: 'ignored' });
});
it('rejects stale nonce, wrong bridge version and mismatched origin', () => {
  for (const patch of [{ id: 'old_12345678' }, { version: 2 }, { origin: 'https://portal.nchu.edu.tw' }])
    assert.equal(read(payload(patch)).status, 'ignored');
});
it('rejects a message sent from or received after a different page origin', () => {
  assert.equal(readPortalCapture(portal, request, 'https://evil.example', origin, payload()).status, 'ignored');
  assert.equal(readPortalCapture(portal, request, origin, 'https://other.pu.edu.tw', payload()).status, 'ignored');
});
it('does not accept injected elements, attributes or unexpected secret fields', () => {
  for (const extra of ['<script>alert(1)</script>', '<input value="secret">', '<img src="https://evil.example">', '<td onclick="alert(1)">x</td>'])
    assert.equal(read(payload({ html: html + extra })).status, 'ignored');
  assert.equal(read(payload({ cookie: 'secret' })).status, 'ignored');
});
it('allows escaped text without interpreting it as an HTML instruction', () => {
  assert.equal(read(payload({ html: html.replace('統計學', '&lt;img onerror=&quot;bad&quot;&gt; &amp; 統計學') })).status, 'ok');
});
it('fails closed on malformed and oversized messages', () => {
  for (const data of ['', '{', 'null', '[]', '1', 'false', '"hello"']) assert.equal(read(data).status, 'ignored');
  assert.equal(read(payload({ html: 'x'.repeat(PORTAL_CAPTURE_LIMIT + 1) })).status, 'ignored');
});
it('accepts only bounded partial-frame metadata', () => {
  assert.equal(read(payload({ blockedFrames: 2 })).status, 'ok');
  for (const blockedFrames of [-1, 51, 0.5, '1', null]) assert.equal(read(payload({ blockedFrames })).status, 'ignored');
});
it('accepts allowlisted errors without rendering an arbitrary website error', () => {
  for (const error of ['too-large', 'no-table', 'unavailable']) assert.equal(read(payload({ error })).status, 'error');
  assert.equal(read(payload({ error: 'password=secret' })).status, 'ignored');
});
it('bounds and escapes script construction instead of interpolating arbitrary executable data', () => {
  assert.throws(() => schoolPortalCaptureScript({ ...request, id: "');alert(1)//" }));
  assert.throws(() => schoolPortalCaptureScript({ ...request, origin: "https://site/';alert(1)//" }));
  assert.match(schoolPortalCaptureScript(request), /window\.top !== window/);
  assert.doesNotMatch(schoolPortalCaptureScript(request), /document\.cookie|localStorage|sessionStorage|fetch\(|XMLHttpRequest|\.value\b/);
});
it('supports quoted cell text and maximum escaped JSON without false size rejection', () => {
  const value = '<table><tr><td>' + '\\'.repeat(100_000) + '</td></tr></table>';
  assert.equal(read(payload({ html: value })).status, 'ok');
});
