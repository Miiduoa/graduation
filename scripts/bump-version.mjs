#!/usr/bin/env node
/**
 * Version bump script for campus-app.
 *
 * Usage:
 *   node scripts/bump-version.mjs patch   # 1.0.0 → 1.0.1
 *   node scripts/bump-version.mjs minor   # 1.0.0 → 1.1.0
 *   node scripts/bump-version.mjs major   # 1.0.0 → 2.0.0
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const bumpType = process.argv[2];
if (!['patch', 'minor', 'major'].includes(bumpType)) {
  console.error('Usage: node bump-version.mjs <patch|minor|major>');
  process.exit(1);
}

// Read current version from app.json
const appJsonPath = resolve(root, 'apps/mobile/app.json');
const appJson = JSON.parse(readFileSync(appJsonPath, 'utf8'));
const current = appJson.expo.version;
const [major, minor, patch] = current.split('.').map(Number);

let next;
switch (bumpType) {
  case 'major':
    next = `${major + 1}.0.0`;
    break;
  case 'minor':
    next = `${major}.${minor + 1}.0`;
    break;
  case 'patch':
    next = `${major}.${minor}.${patch + 1}`;
    break;
}

// Update app.json
appJson.expo.version = next;
writeFileSync(appJsonPath, JSON.stringify(appJson, null, 2) + '\n');

// Update root package.json
const rootPkgPath = resolve(root, 'package.json');
const rootPkg = JSON.parse(readFileSync(rootPkgPath, 'utf8'));
if (rootPkg.version) {
  rootPkg.version = next;
  writeFileSync(rootPkgPath, JSON.stringify(rootPkg, null, 2) + '\n');
}

// Update mobile package.json
const mobilePkgPath = resolve(root, 'apps/mobile/package.json');
const mobilePkg = JSON.parse(readFileSync(mobilePkgPath, 'utf8'));
mobilePkg.version = next;
writeFileSync(mobilePkgPath, JSON.stringify(mobilePkg, null, 2) + '\n');

console.log(`✅ Version bumped: ${current} → ${next}`);
console.log('Updated files:');
console.log(`  - apps/mobile/app.json`);
console.log(`  - package.json`);
console.log(`  - apps/mobile/package.json`);
