'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');

function ignoreFile(relative) {
  return fs.readFileSync(path.join(root, relative), 'utf8');
}

test('google-services.json and GoogleService-Info.plist are gitignored', () => {
  const rootIgnore = ignoreFile('.gitignore');
  const mobileIgnore = ignoreFile('apps/mobile/.gitignore');
  for (const contents of [rootIgnore, mobileIgnore]) {
    expect(contents).toMatch(/google-services\.json/);
    expect(contents).toMatch(/GoogleService-Info\.plist/);
  }
});

test('no public Google client config is tracked', () => {
  const tracked = execFileSync(
    'git',
    ['ls-files', '*google-services.json', '*GoogleService-Info.plist'],
    { cwd: root, encoding: 'utf8' },
  ).trim();
  expect(tracked).toBe('');
});
