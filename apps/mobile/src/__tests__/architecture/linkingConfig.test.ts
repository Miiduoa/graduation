import fs from 'node:fs';
import path from 'node:path';

function extractLinkingConfigSource(): string {
  const appSource = fs.readFileSync(path.join(process.cwd(), 'App.tsx'), 'utf8');
  const start = appSource.indexOf('const linking');
  const end = appSource.indexOf('const { usingFirebase');

  if (start === -1 || end === -1 || end <= start) {
    throw new Error('Unable to locate App.tsx linking config');
  }

  return appSource.slice(start, end);
}

describe('navigation linking config', () => {
  it('does not reuse the same path for multiple screens', () => {
    const linkingConfigSource = extractLinkingConfigSource();
    const paths = [
      ...linkingConfigSource.matchAll(/([A-Za-z0-9_\u4e00-\u9fff]+):\s*'([^']+)'/g),
    ].map((match) => ({ screen: match[1], path: match[2] }));
    const duplicatePaths = [...new Set(paths.map((entry) => entry.path))]
      .map((pathValue) => ({
        path: pathValue,
        screens: paths.filter((entry) => entry.path === pathValue).map((entry) => entry.screen),
      }))
      .filter((entry) => entry.screens.length > 1);

    expect(duplicatePaths).toEqual([]);
  });
});
