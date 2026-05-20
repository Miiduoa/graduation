/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';

const DEMO_CRITICAL_SCREENS = [
  'CampusAiFirstScreen.tsx',
  'CafeteriaAiFirstScreen.tsx',
  'MenuDetailAiFirstScreen.tsx',
  'BusAiFirstScreen.tsx',
  'CourseHubAiFirstScreen.tsx',
  'LearnAiFirstScreen.tsx',
  'TeacherCockpitAiFirstScreen.tsx',
];

const srcRoot = path.resolve(__dirname, '..');
const screensRoot = path.join(srcRoot, 'screens');

function readScreen(file: string): string {
  return fs.readFileSync(path.join(screensRoot, file), 'utf8');
}

function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name === '__tests__') continue;
    if (entry.isDirectory()) {
      out.push(...collectSourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function findSelfClosingTags(source: string, tagName: string): string[] {
  return source.match(new RegExp(`<${tagName}\\b[\\s\\S]*?/>`, 'g')) ?? [];
}

function hasExplicitInteractionPolicy(tag: string): boolean {
  return /\bonPress=/.test(tag) || /\bstatic\b/.test(tag) || /\bdisabled\b/.test(tag);
}

describe('AI-first demo interaction coverage', () => {
  it('repo no longer contains empty Pressable onPress handlers', () => {
    const offenders = collectSourceFiles(srcRoot)
      .flatMap((file) => {
        const source = fs.readFileSync(file, 'utf8');
        return source.includes('onPress={() => {}}') ? [path.relative(srcRoot, file)] : [];
      });

    expect(offenders).toEqual([]);
  });

  it.each(DEMO_CRITICAL_SCREENS)('%s has no visible legacy route escape hatch', (file) => {
    expect(readScreen(file)).not.toMatch(/\b[A-Za-z0-9_]+Legacy\b/);
  });

  it.each(DEMO_CRITICAL_SCREENS)('%s AIButton controls have handlers or explicit non-interactive state', (file) => {
    const offenders = findSelfClosingTags(readScreen(file), 'AIButton')
      .filter((tag) => !hasExplicitInteractionPolicy(tag));

    expect(offenders).toEqual([]);
  });

  it.each(DEMO_CRITICAL_SCREENS)('%s AIRow controls have handlers or explicit non-interactive state', (file) => {
    const offenders = findSelfClosingTags(readScreen(file), 'AIRow')
      .filter((tag) => !hasExplicitInteractionPolicy(tag));

    expect(offenders).toEqual([]);
  });
});
