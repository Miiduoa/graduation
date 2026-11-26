import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const globalStyles = 'apps/web/src/app/globals.css';

export function withoutCssComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '));
}

export function checkGlobalUiFoundation(source) {
  const css = withoutCssComments(source);
  const issues = [];
  if (!/--font-ui\s*:/.test(css) || !/\bfont-family\s*:\s*var\(--font-ui\)\s*;/.test(css)) {
    issues.push(globalStyles + ': the shared UI font must be a design token');
  }
  const focus = css.match(/:where\([^)]*\):focus-visible\s*\{([^}]*)\}/m);
  if (!focus || !/\boutline\s*:\s*3px\s+solid\s+var\(--focus-ring\)/.test(focus[1])) {
    issues.push(globalStyles + ': keyboard focus must retain a visible ring');
  }
  if (!/@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)/.test(css)) {
    issues.push(globalStyles + ': reduced-motion preference must remain supported');
  }
  if (/\btransition\s*:\s*all(?=[\s;,])/i.test(css)) {
    issues.push(globalStyles + ': replace transition: all with explicit properties');
  }
  return issues;
}


const welcomeStyles = 'apps/web/src/components/today/TodayWelcome.module.css';

export function checkTodayWelcomeFocusStyles(source) {
  const css = withoutCssComments(source);
  const issues = [];
  const root = css.match(/(?:^|\})\s*\.welcome\s*\{([^}]*)\}/m);
  if (!root || /\boverflow(?:-x|-y)?\s*:\s*(?:hidden|clip)\b/i.test(root[1])) {
    issues.push(welcomeStyles + ': first-use hero must not clip focus outlines');
  }
  const focus = css.match(/\.welcome\s+a:focus-visible\s*\{([^}]*)\}/m);
  if (!focus || !/\boutline\s*:\s*3px\s+solid\s+var\(--focus-ring\)\s*;/i.test(focus[1])) {
    issues.push(welcomeStyles + ': first-use links must retain a keyboard focus ring');
  }
  return issues;
}

export function checkAddedCss(diff) {
  const issues = [];
  let file = null;
  let nextLine = 0;
  let added = [];

  function flush() {
    if (file && file.startsWith('apps/web/') && file.endsWith('.css') && added.length) {
      const source = withoutCssComments(added.map((entry) => entry.text).join('\n'));
      const forbidden = /\btransition\s*:\s*all(?=[\s;,])/gi;
      for (const match of source.matchAll(forbidden)) {
        const offset = (source.slice(0, match.index).match(/\n/g) || []).length;
        const line = added[Math.min(offset, added.length - 1)].line;
        issues.push(file + ':' + line + ': new CSS must not use transition: all');
      }
    }
    added = [];
  }

  for (const row of diff.split('\n')) {
    if (row.startsWith('+++ ')) {
      flush();
      file = row.startsWith('+++ b/') ? row.slice(6) : null;
    } else if (row.startsWith('@@ ')) {
      flush();
      const match = row.match(/\+(\d+)/);
      nextLine = match ? Number(match[1]) : 0;
    } else if (row.startsWith('+') && !row.startsWith('+++')) {
      added.push({ text: row.slice(1), line: nextLine });
      nextLine += 1;
    } else if (row.startsWith(' ')) {
      flush();
      nextLine += 1;
    } else {
      flush();
    }
  }
  flush();
  return issues;
}

function run() {
  const css = readFileSync(resolve(root, globalStyles), 'utf8');
  const problems = checkGlobalUiFoundation(css);
  const welcome = readFileSync(resolve(root, welcomeStyles), 'utf8');
  problems.push(...checkTodayWelcomeFocusStyles(welcome));
  const baseIndex = process.argv.indexOf('--base');
  if (baseIndex !== -1) {
    const base = process.argv[baseIndex + 1];
    if (!base || base.startsWith('-')) throw new Error('Missing Git base for --base');
    const diff = execFileSync(
      'git',
      ['diff', '--no-ext-diff', '--unified=0', base, 'HEAD', '--', 'apps/web/src'],
      { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
    );
    problems.push(...checkAddedCss(diff));
  }
  if (problems.length) {
    for (const issue of problems) console.error('[nuni UI] ' + issue);
    process.exitCode = 1;
  } else {
    console.log('[nuni UI] Foundation and changed CSS checks passed.');
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run();
}
