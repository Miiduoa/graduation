import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { checkAddedCss, checkGlobalUiFoundation, checkTodayWelcomeFocusStyles, withoutCssComments } from './ui-design-gate.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('the real nuni global stylesheet keeps shared font, focus and motion guarantees', () => {
  const css = readFileSync(resolve(root, 'apps/web/src/app/globals.css'), 'utf8');
  assert.deepEqual(checkGlobalUiFoundation(css), []);
});

test('the diff checker catches new transition: all, including multiline declarations', () => {
  const diff = [
    'diff --git a/apps/web/src/app/new.module.css b/apps/web/src/app/new.module.css',
    '--- /dev/null',
    '+++ b/apps/web/src/app/new.module.css',
    '@@ -0,0 +1,5 @@',
    '+.button {',
    '+  transition:',
    '+    all 200ms ease;',
    '+  opacity: 1;',
    '+}',
  ].join('\n');
  assert.deepEqual(checkAddedCss(diff), [
    'apps/web/src/app/new.module.css:2: new CSS must not use transition: all',
  ]);
});

test('deletions, comments, and unrelated file changes are not failures', () => {
  const diff = [
    'diff --git a/apps/web/src/a.css b/apps/web/src/a.css',
    '--- a/apps/web/src/a.css',
    '+++ b/apps/web/src/a.css',
    '@@ -1 +1,2 @@',
    '-  transition: all 200ms ease;',
    '+/* transition: all is a bad pattern */',
    '+  transition: opacity 200ms ease;',
    'diff --git a/apps/mobile/src/a.tsx b/apps/mobile/src/a.tsx',
    '--- a/apps/mobile/src/a.tsx',
    '+++ b/apps/mobile/src/a.tsx',
    '@@ -1 +1 @@',
    '+const message = "transition: all";',
  ].join('\n');
  assert.deepEqual(checkAddedCss(diff), []);
});

test('a missing keyboard focus ring is reported', () => {
  const good = [
    ':root { --font-ui: sans-serif; }',
    'html, body { overflow-x: clip; }',
    'body { font-family: var(--font-ui); }',
    ':where(button, input, textarea, select, summary, a):focus-visible { outline: 3px solid var(--focus-ring); }',
    '@media (prefers-reduced-motion: reduce) { * { transition-duration: 0.01ms; } }',
  ].join('\n');
  assert.deepEqual(checkGlobalUiFoundation(good), []);
  assert.match(checkGlobalUiFoundation(good.replace(':focus-visible', ':focus'))[0], /focus/i);
});

test('comments cannot satisfy or trigger a stylesheet rule', () => {
  assert.equal(withoutCssComments('/* transition: all */\ntransition: opacity 140ms;').includes('transition: all'), false);
  assert.deepEqual(checkAddedCss('+++ b/apps/web/src/a.css\n@@ -0,0 +1 @@\n+/* transition: all 2s; */'), []);
});

test('first-use homepage focus remains visible in the real component stylesheet', () => {
  const css = readFileSync(
    resolve(root, 'apps/web/src/components/today/TodayWelcome.module.css'),
    'utf8',
  );
  assert.deepEqual(checkTodayWelcomeFocusStyles(css), []);
});

test('the design gate rejects clipped or absent keyboard focus in first-use hero', () => {
  const safe = [
    '.welcome { display: grid; border-radius: 20px; }',
    '.welcome a:focus-visible { outline: 3px solid var(--focus-ring); outline-offset: 3px; }',
  ].join('\n');
  assert.deepEqual(checkTodayWelcomeFocusStyles(safe), []);

  const clipped = safe.replace('border-radius: 20px;', 'overflow: hidden;');
  assert.match(checkTodayWelcomeFocusStyles(clipped)[0], /clip focus/);

  const hiddenRing = safe.replace('3px solid var(--focus-ring)', 'none');
  assert.match(checkTodayWelcomeFocusStyles(hiddenRing)[0], /keyboard focus ring/);
});

test('brand border treatments use the shared theme rather than legacy purple', () => {
  const css = readFileSync(resolve(root, 'apps/web/src/app/globals.css'), 'utf8');
  const selectors = [
    '.pill.brand',
    '.homePulseCard',
    '.announcementsPage .categoryPills button.active',
    '.aiBubble',
    '.contextBanner.class',
  ];
  for (const selector of selectors) {
    const index = css.indexOf(selector + ' {');
    assert.notEqual(index, -1, selector + ' must exist');
    const body = css.slice(css.indexOf('{', index) + 1, css.indexOf('}', index));
    assert.match(body, /var\(--brand\)/, selector + ' must use the theme brand');
    assert.doesNotMatch(body, /rgba\(88,\s*86,\s*214\s*,/i, selector + ' must not use legacy violet');
  }
});
